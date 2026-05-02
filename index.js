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

// --- CRASH GUARDS ---
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
    status: { type: String, default: 'pending' }
});
const Queue = mongoose.model('Queue', QueueSchema);

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connected"));

const groupCache = new Map();
let sock;
let isProcessing = false;

// --- RUGGED QUEUE (PREVENTS LOGOUTS) ---
async function processQueue() {
    if (isProcessing || !sock?.user) return;
    isProcessing = true;
    try {
        let task = await Queue.findOne({ status: 'pending' });
        while (task) {
            try {
                const groupMeta = await sock.groupMetadata(task.jid);
                const code = await sock.groupInviteCode(task.jid);

                await sock.presenceSubscribe(task.target);
                await new Promise(r => setTimeout(r, 2000));
                await sock.sendPresenceUpdate('composing', task.target);
                await new Promise(r => setTimeout(r, 3000));

                await sock.sendMessage(task.target, {
                    groupInviteMessage: {
                        groupJid: task.jid,
                        groupName: groupMeta.subject,
                        inviteCode: code,
                        caption: `Hello! JARVIS here. Your privacy blocked the group add. Join via the button below:`
                    }
                });

                await sock.sendMessage(task.jid, { text: `📥 Invite sent to DM for @${task.target.split('@')[0]}`, mentions: [task.target] });
                await Queue.deleteOne({ _id: task._id });
            } catch (e) {
                await Queue.updateOne({ _id: task._id }, { status: 'failed' });
            }
            await new Promise(r => setTimeout(r, 15000)); // 15s Safety Delay
            task = await Queue.findOne({ status: 'pending' });
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

    // --- AUTO-GREETING (NEW STUDENT) ---
    sock.ev.on('group-participants.update', async (anu) => {
        if (anu.action === 'add') {
            for (let num of anu.participants) {
                const welcomeMsg = `👋 *Welcome to the group, @${num.split('@')[0]}!* 🎓\n\n` +
                    `I am *${BOT_NAME}*. Please follow these rules:\n\n` +
                    `📍 *GROUP RULES:*\n` +
                    `- Posting links is strictly prohibited\n` +
                    `- Avoid using stickers during lessons\n` +
                    `- Stay on topic — no off-topic discussions during classes\n` +
                    `- Do not tag this group in your status\n` +
                    `- Engage actively; inactive members may be removed\n` +
                    `- Feel free to invite friends preparing for SSCE or UTME\n\n` +
                    `📢 *Official Channel:*\nhttps://whatsapp.com`;

                await sock.sendMessage(anu.id, { text: welcomeMsg, mentions: [num] });
            }
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(startJARVIS, 5000);
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Online`);
            setInterval(processQueue, 30000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "";
        const text = body.toLowerCase().trim();
        const isOwner = sender.includes(OWNER_NUMBER);

        if (text.includes("jarvis")) await sock.sendMessage(jid, { react: { key: m.key, text: "🤖" } });
        if (!jid.endsWith('@g.us') && !isOwner) return;

        let metadata = jid.endsWith('@g.us') ? (groupCache.get(jid) || await sock.groupMetadata(jid)) : {};
        if (jid.endsWith('@g.us')) groupCache.set(jid, metadata);

        const admins = (metadata?.participants || []).filter(p => p.admin).map(p => p.id);
        const isStaff = isOwner || admins.includes(sender);
        const command = text.split(/ +/)[0];
        const args = body.trim().split(/ +/).slice(1);

        // --- WATCHDOG ---
        if (jid.endsWith('@g.us') && !isStaff) {
            const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish"];
            if (badWords.some(word => text.includes(word)) || /https?:\/\/\S+/.test(text)) {
                await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
                let userWarn = await Warn.findOneAndUpdate({ userId: sender }, { $inc: { count: 1 } }, { upsert: true, new: true });
                if (userWarn.count >= 3) {
                    await sock.groupParticipantsUpdate(jid, [sender], "remove");
                    await Warn.deleteOne({ userId: sender });
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ Strike ${userWarn.count}/3 for @${sender.split('@')[0]}`, mentions: [sender] });
                }
                return;
            }
        }

        // --- COMMANDS ---
        if (isStaff) {
            if (command === "!add") {
                let num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(jid, { text: "Oya, type the number." });
                let jidTarget = num + "@s.whatsapp.net";
                
                const [exists] = await sock.onWhatsApp(jidTarget);
                if (!exists) return sock.sendMessage(jid, { text: "❌ Not on WhatsApp." });

                const resp = await sock.groupParticipantsUpdate(jid, [jidTarget], "add").catch(() => null);
                if (!resp || resp[0]?.status === "403" || resp[0]?.status === "408") {
                    await Queue.create({ jid, target: jidTarget });
                    return sock.sendMessage(jid, { text: `📨 Privacy detected. Sending invite to DM.` });
                }
                return sock.sendMessage(jid, { text: `✅ Added ${num}.` });
            }

            if (command === "!kick" || command === "!promote") {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || m.message.extendedTextMessage?.contextInfo?.participant;
                if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                if (!target || target.includes(OWNER_NUMBER)) return;
                const action = command === "!kick" ? "remove" : "promote";
                await sock.groupParticipantsUpdate(jid, [target], action).catch(() => {});
                return sock.sendMessage(jid, { text: `✅ ${action.toUpperCase()} done.` });
            }
        }
    });
}

// --- UI ---
app.get('/', (req, res) => {
    res.send(`
        <html><head><title>${BOT_NAME}</title><style>
        body { font-family: sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 12px; text-align: center; width: 350px; box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
        input { width: 100%; padding: 12px; margin: 15px 0; border-radius: 6px; border: none; background: #334155; color: white; text-align: center; }
        button { width: 100%; padding: 12px; border: none; border-radius: 6px; background: #3b82f6; color: white; font-weight: bold; cursor: pointer; }
        h1 { color: #3b82f6; }
        </style></head><body><div class="card"><h1>🤖 ${BOT_NAME}</h1><p>Pairing Panel</p>
        <form method="POST" action="/pair"><input name="number" placeholder="234..." required /><button>GET CODE</button></form></div></body></html>
    `);
});

app.post('/pair', async (req, res) => {
    try {
        const code = await sock.requestPairingCode(req.body.number.replace(/[^0-9]/g, ''));
        res.send(`<body style="background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><div style="text-align:center;"><h1>CODE: <span style="color:#3b82f6;">${code}</span></h1><a href="/" style="color:gray;">Back</a></div></body>`);
    } catch { res.send("Error. Ensure bot is not already connected."); }
});

app.listen(port, () => startJARVIS());
                                       
