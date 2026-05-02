const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));

// --- SYSTEM GUARDS ---
process.on('uncaughtException', (err) => console.log('⚠️ System Error:', err.message));
process.on('unhandledRejection', (err) => console.log('⚠️ Rejection Guard:', err.message));

// --- CONFIG ---
const OWNER_NUMBER = "2347051768946"; 
const BOT_NAME = "JARVIS AI";
const POWERED_BY = "Flexi Digital Academy";
const MONGO_URI = "mongodb+srv://JarvisAI:flexisystems2000@cluster0.7g5odvt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// --- DATABASE ---
const WarnSchema = new mongoose.Schema({ userId: String, count: Number });
const Warn = mongoose.model('Warn', WarnSchema);

const QueueSchema = new mongoose.Schema({ 
    jid: String, 
    target: String, 
    status: { type: String, default: 'pending' },
    retries: { type: Number, default: 0 }
});
const Queue = mongoose.model('Queue', QueueSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

const groupCache = new Map();
let sock;
let isProcessing = false;

// --- RUGGED QUEUE (WITH HUMAN EMULATION) ---
async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        let task = await Queue.findOne({ status: 'pending' });
        while (task) {
            if (!sock?.user) break;
            try {
                let code = await sock.groupInviteCode(task.jid);
                const inviteLink = `https://chat.whatsapp.com/${code}`;

                // HUMAN EMULATION - Prevents "WhatsApp Web" Logouts
                await sock.presenceSubscribe(task.target);
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendPresenceUpdate('composing', task.target);
                await new Promise(r => setTimeout(r, 1500));

                await sock.sendMessage(task.target, {
                    text: `Hello! JARVIS here. You were invited to join a group, but your privacy blocked the add.\n\n*Join here:*\n${inviteLink}`
                });

                await sock.sendMessage(task.jid, { text: `📥 Invite link dropped in DM for ${task.target.split('@')[0]}` });
                await Queue.deleteOne({ _id: task._id });
            } catch (e) {
                console.log("DM Blocked:", e.message);
                await Queue.updateOne({ _id: task._id }, { status: 'failed' });
            }
            task = await Queue.findOne({ status: 'pending' });
            await new Promise(r => setTimeout(r, 2000)); 
        }
    } finally { isProcessing = false; }
}

async function startJARVIS() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version, auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startJARVIS, 3000);
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Online`);
            processQueue();
            setInterval(processQueue, 15000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase();
        
        // DM Filter - Owner can use DM, others ignored
        if (!jid.endsWith('@g.us') && !sender.includes(OWNER_NUMBER)) return;

        // --- REACT LOGIC ---
        const botNumber = sock.user.id.split(':')[0];
        const mentions = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentions.some(v => v.includes(botNumber)) || text.includes("jarvis")) {
            await sock.sendMessage(jid, { react: { key: m.key, text: "🤖" } });
        }

        if (!jid.endsWith('@g.us')) return;

        // --- METADATA FETCH ---
        let metadata;
        try {
            metadata = groupCache.get(jid);
            if (!metadata || Date.now() - (metadata.lastFetch || 0) > 600000) {
                metadata = await sock.groupMetadata(jid);
                metadata.lastFetch = Date.now();
                groupCache.set(jid, metadata);
            }
        } catch { metadata = { subject: "Group", participants: [] }; }

        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
        const isStaff = sender.includes(OWNER_NUMBER) || admins.includes(sender);
        const command = text.split(" ")[0];
        const args = text.split(" ").slice(1);

        // --- WATCHDOG: ABUSIVE WORDS & LINKS ---
        const punish = async (reason) => {
            let userWarn = await Warn.findOne({ userId: sender });
            if (!userWarn) userWarn = await Warn.create({ userId: sender, count: 0 });
            userWarn.count += 1;
            await userWarn.save();

            if (userWarn.count >= 3) {
                await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} kicked (3/3 strikes).`, mentions: [sender] });
                await sock.groupParticipantsUpdate(jid, [sender], "remove").catch(() => {});
                await Warn.deleteOne({ userId: sender });
            } else {
                await sock.sendMessage(jid, { text: `⚠️ *STRIKE ${userWarn.count}/3*\n@${sender.split('@')[0]}\n*Reason:* ${reason}`, mentions: [sender] });
            }
        };

        const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish"];
        if (badWords.some(word => text.includes(word))) {
            await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
            return punish("Abusive language");
        }

        const hasLink = /https?:\/\/\S+|www\.\S+|wa\.me\/\S+/.test(text);
        if (hasLink || (text.includes("status") && text.includes("view"))) {
            if (!isStaff) { // Staff can post links
                await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
                return punish("Unauthorized links/ads");
            }
        }

        // --- COMMANDS ---
        if (isStaff) {
            if (command === "!add") {
                let num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return;
                let jidTarget = num + "@s.whatsapp.net";
                try {
                    const resp = await sock.groupParticipantsUpdate(jid, [jidTarget], "add").catch(() => null);
                    if (!resp || !resp[0] || ["403","408","409","417"].includes(resp[0]?.status?.toString())) {
                        await sock.sendMessage(jid, { text: `📨 Privacy block for ${num}. Invite link sent.` });
                        await Queue.findOneAndUpdate({ target: jidTarget, jid: jid }, { target: jidTarget, jid: jid, status: 'pending' }, { upsert: true });
                        processQueue().catch(() => {});
                        return;
                    }
                    if (resp[0]?.status?.toString() === "200") return sock.sendMessage(jid, { text: `✅ Added ${num}.` });
                } catch { return sock.sendMessage(jid, { text: "❌ Connection skip." }); }
            }

            if (command === "!ginfo") {
                return sock.sendMessage(jid, { text: `*📊 ${BOT_NAME} REPORT*\n\nGroup: ${metadata.subject}\nMembers: ${metadata.participants.length}` });
            }
        }
    });
}

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${BOT_NAME}</title><style>body{background:#020617;color:white;text-align:center;padding:30px;font-family:sans-serif;}.card{background:#1e293b;padding:25px;border-radius:15px;border:1px solid #38bdf8;max-width:500px;margin:auto;}h1{color:#38bdf8;}input{padding:12px;margin:10px;width:80%;border-radius:8px;border:none;}button{background:#38bdf8;padding:12px;width:85%;border-radius:8px;font-weight:bold;cursor:pointer;}</style></head><body><div class="card"><h1>🤖 ${BOT_NAME}</h1><p>${POWERED_BY}</p><form method="POST" action="/pair"><input name="number" placeholder="234..." required /><button type="submit">Get Code</button></form></div></body></html>`);
});

app.post('/pair', async (req, res) => {
    const number = req.body.number.replace(/[^0-9]/g, '');
    try {
        const code = await sock.requestPairingCode(number);
        res.send(`<body style="background:#020617;color:white;text-align:center;padding-top:100px;"><h1>CODE: ${code}</h1></body>`);
    } catch { res.send("<h1>Error - Bot Busy</h1>"); }
});

app.listen(port, () => startJARVIS());
                    
