const fs = require('node:fs');
const path = require('node:path');

function findPackageRoot(entryPath) {
    let current = path.dirname(entryPath);
    while (current !== path.dirname(current)) {
        const packageJson = path.join(current, 'package.json');
        if (fs.existsSync(packageJson)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
                if (parsed.name === '@flexisystems/baileys') return current;
            } catch {}
        }
        current = path.dirname(current);
    }
    throw new Error('Could not locate @flexisystems/baileys package root');
}

const entry = require.resolve('@flexisystems/baileys');
const packageRoot = findPackageRoot(entry);
const target = path.join(packageRoot, 'lib', 'Signal', 'libsignal.js');
let source = fs.readFileSync(target, 'utf8');

const senderKeyDiagnosticsPresent = source.includes('group sender-key lookup diagnostics');
if (senderKeyDiagnosticsPresent) {
    console.info('[BAILEYS PATCH] Sender-key diagnostics already present');
}
else {
const oldDecrypt = `        decryptGroupMessage({ group, authorJid, msg }) {
            const senderName = jidToSignalSenderKeyName(group, authorJid);
            const cipher = new GroupCipher(storage, senderName);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                return cipher.decrypt(msg);
            }, group);
        },`;

const newDecrypt = `        async decryptGroupMessage({ group, authorJid, msg }) {
            const senderName = jidToSignalSenderKeyName(group, authorJid);
            const senderNameStr = senderName.toString();
            const { [senderNameStr]: directRecord } = await auth.keys.get('sender-key', [senderNameStr]);
            const directStates = directRecord
                ? SenderKeyRecord.deserialize(directRecord).senderKeyStates.map(state => state.getKeyId())
                : [];
            let mappedPn;
            let mappedPnStates = [];
            if (isLidUser(authorJid) || isHostedLidUser(authorJid)) {
                mappedPn = await lidMapping.getPNForLID(authorJid);
                if (mappedPn) {
                    const mappedName = jidToSignalSenderKeyName(group, mappedPn).toString();
                    const { [mappedName]: mappedRecord } = await auth.keys.get('sender-key', [mappedName]);
                    if (mappedRecord) {
                        mappedPnStates = SenderKeyRecord.deserialize(mappedRecord).senderKeyStates.map(state => state.getKeyId());
                    }
                }
            }
            logger.info({
                group,
                authorDomain: authorJid.split('@').pop() || null,
                hasDirectSenderKeyRecord: !!directRecord,
                directSenderKeyIds: directStates,
                hasMappedPn: !!mappedPn,
                hasMappedPnSenderKeyRecord: mappedPnStates.length > 0,
                mappedPnSenderKeyIds: mappedPnStates
            }, 'group sender-key lookup diagnostics');
            const cipher = new GroupCipher(storage, senderName);
            return parsedKeys.transaction(async () => {
                return cipher.decrypt(msg);
            }, group);
        },`;

const oldDistribution = `            const senderName = jidToSignalSenderKeyName(item.groupId, authorJid);
            const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage);
            const senderNameStr = senderName.toString();`;

const newDistribution = `            const senderName = jidToSignalSenderKeyName(item.groupId, authorJid);
            const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage);
            const senderNameStr = senderName.toString();
            logger.info({
                group: item.groupId,
                authorDomain: authorJid.split('@').pop() || null,
                senderKeyId: senderMsg.getId(),
                iteration: senderMsg.getIteration()
            }, 'received group sender-key distribution');`;

if (!source.includes(oldDecrypt) || !source.includes(oldDistribution)) {
    throw new Error('Installed Baileys source does not match the expected 0.5.11 layout; no patch applied');
}

source = source.replace(oldDecrypt, newDecrypt).replace(oldDistribution, newDistribution);
fs.writeFileSync(target, source, 'utf8');
console.info('[BAILEYS PATCH] Applied sender-key diagnostics without changing the package version');
}

function replaceOnce(source, before, after, label) {
    const count = source.split(before).length - 1;
    if (count === 0 && source.includes(after)) return source;
    if (count !== 1) throw new Error('Expected one ' + label + ' patch point, found ' + count);
    return source.replace(before, after);
}
function patchFile(relativePath, transform) {
    const file = path.join(packageRoot, relativePath);
    const current = fs.readFileSync(file, 'utf8');
    const next = transform(current);
    if (next !== current) fs.writeFileSync(file, next, 'utf8');
}
patchFile(path.join('lib', 'Socket', 'messages-send.js'), source =>
    replaceOnce(source, '            messageRetryManager.flushAll();',
        '            messageRetryManager.clear();', 'message retry manager cleanup')
);
patchFile(path.join('lib', 'Socket', 'messages-recv.js'), source => {
    source = replaceOnce(source,
        '    const retryMutex = makeMutex();',
        '    const retryMutex = makeMutex();\n' +
        '    // Group Status can arrive before the sender-key distribution needed to decrypt it.\n' +
        '    const pendingGroupStatuses = new Map();\n' +
        '    const PENDING_GROUP_STATUS_TTL_MS = 2 * 60 * 1000;\n' +
        '    const MAX_PENDING_GROUP_STATUSES = 50;\n' +
        '    const MAX_STATUS_RETRIES_PER_DRAIN = 10;\n' +
        '    let retryingPendingGroupStatuses = false;\n' +
        '    const groupStatusRetryKey = node => (node?.attrs?.from || "") + "::" + (node?.attrs?.id || "");\n' +
        '    const queueGroupStatusRetry = node => {\n' +
        '        const key = groupStatusRetryKey(node);\n' +
        '        if (key === "::") return;\n' +
        '        const existing = pendingGroupStatuses.get(key);\n' +
        '        if (!existing && pendingGroupStatuses.size >= MAX_PENDING_GROUP_STATUSES) {\n' +
        '            const oldestKey = pendingGroupStatuses.keys().next().value;\n' +
        '            if (oldestKey) pendingGroupStatuses.delete(oldestKey);\n' +
        '        }\n' +
        '        pendingGroupStatuses.set(key, existing || { node, createdAt: Date.now(), attempts: 0 });\n' +
        '    };\n' +
        '    const retryPendingGroupStatuses = async () => {\n' +
        '        if (retryingPendingGroupStatuses || !pendingGroupStatuses.size) return;\n' +
        '        retryingPendingGroupStatuses = true;\n' +
        '        try {\n' +
        '            const now = Date.now();\n' +
        '            const candidates = Array.from(pendingGroupStatuses.entries()).slice(0, MAX_STATUS_RETRIES_PER_DRAIN);\n' +
        '            for (const [key, entry] of candidates) {\n' +
        '                if (!pendingGroupStatuses.has(key)) continue;\n' +
        '                if (now - entry.createdAt > PENDING_GROUP_STATUS_TTL_MS || entry.attempts >= 3) {\n' +
        '                    pendingGroupStatuses.delete(key);\n' +
        '                    continue;\n' +
        '                }\n' +
        '                entry.attempts += 1;\n' +
        '                await processNode("message", entry.node, "retrying pending group status", handleMessage);\n' +
        '                if (entry.attempts >= 3 && pendingGroupStatuses.has(key)) pendingGroupStatuses.delete(key);\n' +
        '            }\n' +
        '        } finally { retryingPendingGroupStatuses = false; }\n' +
        '    };',
        'pending Group Status retry queue'
    );
    source = replaceOnce(source,
        '        let acked = false;\n        try {',
        '        let acked = false;\n        let processed = false;\n        try {',
        'message processing success flag'
    );
    source = replaceOnce(source,
        '                    if (msg?.messageStubParameters?.[0] === MISSING_KEYS_ERROR_TEXT) {\n                        acked = true;',
        '                    if (msg?.messageStubParameters?.[0] === MISSING_KEYS_ERROR_TEXT) {\n' +
        '                        if (node.tag === "status" && isJidGroup(node?.attrs?.from)) queueGroupStatusRetry(node);\n' +
        '                        acked = true;',
        'queue Group Status when sender key is missing'
    );
    source = replaceOnce(source,
        '                await upsertMessage(msg, isOfflineNode(node) ? \'append\' : \'notify\');\n            });\n        }\n        catch (error) {',
        '            await upsertMessage(msg, isOfflineNode(node) ? \'append\' : \'notify\');\n' +
        '                processed = true;\n' +
        '                if (node.tag === "status") pendingGroupStatuses.delete(groupStatusRetryKey(node));\n' +
        '            });\n' +
        '            if (processed && node.tag !== "status") await retryPendingGroupStatuses();\n' +
        '        }\n        catch (error) {',
        'retry queued statuses after a successfully processed message'
    );
    return source;
});
console.info('[BAILEYS PATCH] Applied Group Status retry and retry-manager cleanup patches');
