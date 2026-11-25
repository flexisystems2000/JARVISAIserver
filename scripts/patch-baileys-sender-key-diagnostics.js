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

if (source.includes('group sender-key lookup diagnostics')) {
    console.info('[BAILEYS PATCH] Sender-key diagnostics already present');
    process.exit(0);
}

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
