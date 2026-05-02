const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION ---
const OWNER_NUMBER = "2347051768946"; 
const BOT_NAME = "JARVIS AI";
const POWERED_BY = "Flexi Digital Academy";

// --- IN-MEMORY DATABASE & CACHE ---
const warns = {}; 
const floodTracker = {}; 
const groupCache = new Map(); 
let sock; 

async function startJARVIS() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        // RUGGED CONNECTION FIXES
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000, 
        emitOwnEvents: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Connection lost. Restarting engine...");
                startJARVIS();
            }
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is active for ${POWERED_BY}`);
            // Heartbeat to keep Render and WhatsApp synchronized
            setInterval(() => {
                if (sock.user) {
                    sock.sendPresenceUpdate('available');
                    console.log("💓 JARVIS Heartbeat: Active");
                }
            }, 60000); // Every minute
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        if (!jid.endsWith('@g.us')) return; 

        const sender = m.key.participant || m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim().toLowerCase();
        const command = text.split(/ +/)[0];
        const args = text.split(/ +/).slice(1);

        // --- TAG REACTION ---
        const botNumber = sock.user.id.split(':')[0];
        const mentions = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentions.some(v => v.includes(botNumber)) || text.includes("jarvis")) {
            await sock.sendMessage(jid, { react: { key: m.key, text: "🤖" } });
        }

        let metadata = groupCache.get(jid);
        if (!metadata || (Date.now() - metadata.lastFetch > 600000)) { 
            try {
                metadata = await sock.groupMetadata(jid);
                metadata.lastFetch = Date.now();
                groupCache.set(jid, metadata);
            } catch (e) { return; }
        }

        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
        const isOwner = sender.includes(OWNER_NUMBER);
        const isStaff = isOwner || admins.includes(sender);

        // --- STAFF COMMANDS ---
        if (isStaff) {
            // 1. ADD MEMBER (STABILIZED VERSION)
            if (command === "!add") {
                if (!args[0]) return sock.sendMessage(jid, { text: "Oya, provide the number! Example: !add 2348000000000" });
                let target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                try {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const response = await sock.groupParticipantsUpdate(jid, [target], "add");
                    const status = response[0]?.status;

                    if (status === "200") {
                        return sock.sendMessage(jid, { text: "✅ Student added successfully." });
                    } else if (status === "403" || status === "408" || status === "409") {
                        const code = await sock.groupInviteCode(jid);
                        const inviteLink = `https://chat.whatsapp.com/${code}`;
                        return sock.sendMessage(jid, { 
                            text: `⚠️ *Notice!* \nI can't add @${target.split('@')[0]} directly (Privacy/Status). \n\n*Please use this link to join:* \n${inviteLink}`,
                            mentions: [target]
                        });
                    } else {
                        return sock.sendMessage(jid, { text: `❌ Failed. Status: ${status || 'Unknown'}` });
                    }
                } catch (e) { 
                    console.error("ADD_ERROR:", e);
                    return sock.sendMessage(jid, { text: "❌ Error: Ensure I am an Admin and the number is correct." }); 
                }
            }

            // 2. KICK MEMBER (STABILIZED VERSION)
            if (command === "!kick") {
                let target;
                if (m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]) {
                    target = m.message.extendedTextMessage.contextInfo.mentionedJid[0];
                } else if (m.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                    target = m.message.extendedTextMessage.contextInfo.participant;
                } else if (args[0]) {
                    target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                }
                if (!target) return sock.sendMessage(jid, { text: "Tag someone or reply to them with !kick" });
                if (target.includes(OWNER_NUMBER)) return sock.sendMessage(jid, { text: "❌ Cannot kick the Boss." });

                try {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const response = await sock.groupParticipantsUpdate(jid, [target], "remove");
                    const status = response[0]?.status;

                    if (status === "200") {
                        return sock.sendMessage(jid, { text: "🚫 Removed by Staff." });
                    } else {
                        return sock.sendMessage(jid, { text: `❌ Failed. Status: ${status || 'Unknown'}` });
                    }
                } catch (e) { 
                    console.error("KICK_ERROR:", e);
                    return sock.sendMessage(jid, { text: "❌ Error: Failed to kick. Check Admin status." }); 
                }
            }

            // 3. GINFO (STABILIZED VERSION)
            if (command === "!ginfo") {
                try {
                    // Fresh fetch to avoid using empty cache
                    let infoMetadata = await sock.groupMetadata(jid);
                    
                    if (!infoMetadata) {
                        return sock.sendMessage(jid, { text: "❌ Metadata not ready. Please try again." });
                    }

                    let groupName = infoMetadata.subject || "Unknown Group";
                    let memberCount = infoMetadata.participants?.length || 0;
                    let adminCount = infoMetadata.participants?.filter(p => p.admin).length || 0;

                    let info = `*📂 ${BOT_NAME} REPORT*\n\n` +
                               `*Group:* ${groupName}\n` +
                               `*Members:* ${memberCount}\n` +
                               `*Admins:* ${adminCount}\n` +
                               `*Status:* Active 🟢`;

                    return sock.sendMessage(jid, { text: info });
                } catch (e) {
                    console.error("GINFO_ERROR:", e);
                    return sock.sendMessage(jid, { text: "❌ Error fetching group info. Ensure I am in the group." });
                }
            }
            return; 
        }

        // --- RULES FOR MEMBERS ---
        const punish = async (reason) => {
            warns[sender] = (warns[sender] || 0) + 1;
            if (warns[sender] >= 3) {
                await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} removed for violations.`, mentions: [sender] });
                await sock.groupParticipantsUpdate(jid, [sender], "remove");
                delete warns[sender];
            } else {
                await sock.sendMessage(jid, { text: `⚠️ *STRIKE ${warns[sender]}/3*\n@${sender.split('@')[0]}\n*Reason:* ${reason}`, mentions: [sender] });
            }
        };

        const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish"];
        if (badWords.some(word => text.includes(word))) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Abusive language");
        }

        const hasLink = /https?:\/\/\S+|www\.\S+|wa\.me\/\S+/.test(text);
        if (hasLink || (text.includes("status") && (text.includes("view") || text.includes("check")))) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Unauthorized links/ads");
        }
    });
}

// --- WEB DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${BOT_NAME}</title><style>body{background:#0f172a;color:white;text-align:center;padding:50px;font-family:sans-serif;}.card{background:#1e293b;padding:40px;border-radius:20px;border:1px solid #38bdf8;display:inline-block;max-width:400px;width:100%;}h1{color:#38bdf8;}input{padding:15px;margin:10px;width:80%;border-radius:10px;border:none;}button{background:#38bdf8;padding:15px;width:85%;border-radius:10px;font-weight:bold;cursor:pointer;}</style></head><body><div class="card"><h1>🤖 ${BOT_NAME}</h1><p>${POWERED_BY}</p><form action="/pair" method="POST"><input name="number" placeholder="234..." required /><button type="submit">Get Code</button></form></div></body></html>`);
});

app.post('/pair', async (req, res) => {
    const number = req.body.number.replace(/[^0-9]/g, '');
    try {
        const code = await sock.requestPairingCode(number);
        res.send(`<body style="background:#0f172a;color:white;text-align:center;padding:100px;"><h1>CODE: ${code}</h1></body>`);
    } catch (e) { res.send("<h1>Error - Session Busy</h1>"); }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`🌐 Dashboard online on port ${port}`);
    startJARVIS();
});
                
