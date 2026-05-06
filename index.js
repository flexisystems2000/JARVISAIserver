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
const axios = require('axios');

require('dotenv').config();

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
const ConfigSchema = new mongoose.Schema({ keyName: String, keyValue: String });
const Warn = mongoose.model('Warn', WarnSchema);
const Config = mongoose.model('Config', ConfigSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

// --- AI FUNCTION ---
async function askAI(prompt) {
    try {
        const dbConfig = await Config.findOne({ keyName: 'GEMINI_API_KEY' });
        const apiKey = dbConfig ? dbConfig.keyValue : process.env.GEMINI_API_KEY;
        if (!apiKey) return "🤖 API Key missing. Update it in the dashboard!";

        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );
        return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "🤖 I couldn't process that.";
    } catch (err) {
        return "⚠️ AI service unavailable. Check your API key.";
    }
}

const groupCache = new Map();
const activityTracker = new Map();
let sock;

async function startJARVIS() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version, 
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Mac OS", "Chrome", "125.0.0"],
        keepAliveIntervalMs: 30000, 
        connectTimeoutMs: 60000,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startJARVIS();
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Online & Synced`);
        }
    });

    // --- WELCOME & GOODBYE ---
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const metadata = await sock.groupMetadata(anu.id).catch(() => null);
            const groupName = metadata?.subject || "this group";
            for (const num of anu.participants) {
                const userTag = num.split('@')[0];
                if (anu.action === 'add' || anu.action === 'invite') {
                    await sock.sendMessage(anu.id, {
                        text: `👋 @${userTag}\n\n🤖 *Welcome to ${groupName}*\n\nPlease follow the rules:\n• No links 🚫\n• No insults 🚫\n• Stay on topic 📚\n\nEnjoy your learning with *JARVIS AI* 🚀 from *${groupName}*`,
                        mentions: [num]
                    });
                } else if (anu.action === 'remove' || anu.action === 'leave') {
                    await sock.sendMessage(anu.id, {
                        text: `👋 Goodbye @${userTag}\n\nWe are sorry to see you leave *${groupName}*. Best of luck in your studies! 🎓`,
                        mentions: [num]
                    });
                }
            }
        } catch (err) { console.log("Group Event Error:", err); }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        activityTracker.set(sender, Date.now()); // Track activity

        const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "";
        const text = body.toLowerCase().trim();
        const isOwner = sender.includes(OWNER_NUMBER);

        if (text.includes("jarvis") && !text.startsWith("!")) {
            await sock.sendMessage(jid, { react: { key: m.key, text: "🤖" } });
        }

        let metadata;
        let isStaff = isOwner;
        if (jid.endsWith('@g.us')) {
            try {
                metadata = groupCache.get(jid);
                if (!metadata || Date.now() - (metadata.lastFetch || 0) > 300000) {
                    metadata = await sock.groupMetadata(jid);
                    metadata.lastFetch = Date.now();
                    groupCache.set(jid, metadata);
                }
                const admins = (metadata.participants || []).filter(p => p.admin !== null).map(p => p.id);
                isStaff = isOwner || admins.includes(sender);
            } catch { isStaff = isOwner; }
        }

        // --- WATCHDOG ---
        if (jid.endsWith('@g.us') && !isStaff) {
            const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish", "stupid", "bastard"];
            const isLink = text.includes("http") || text.includes(".com") || text.includes("chat.whatsapp");
            const isBadWord = badWords.some(word => text.includes(word));

            if (isLink || isBadWord) {
                await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
                let userWarn = await Warn.findOneAndUpdate({ userId: sender }, { $inc: { count: 1 } }, { upsert: true, new: true });
                if (userWarn.count >= 3) {
                    await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} removed (3 Strikes).`, mentions: [sender] });
                    await sock.groupParticipantsUpdate(jid, [sender], "remove");
                    await Warn.deleteOne({ userId: sender });
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ *Watchdog*\n@${sender.split('@')[0]}, violation detected (${userWarn.count}/3).`, mentions: [sender] });
                }
                return;
            }
        }

        const command = text.split(/ +/)[0];
        const args = body.trim().split(/ +/).slice(1);

        if (isStaff) {
            if (command === "!ai") {
                const prompt = args.join(" ");
                if (!prompt) return sock.sendMessage(jid, { text: "Oya, what is your question?" });
                await sock.sendPresenceUpdate('composing', jid);
                const aiReply = await askAI(prompt);
                return sock.sendMessage(jid, { text: `🤖 *JARVIS AI*\n\n${aiReply}` });
            }

            if (command === "!listonline") {
                if (!metadata) return;
                const activeThreshold = 30 * 60 * 1000;
                let activeCount = 0;
                metadata.participants.forEach(p => {
                    if (activityTracker.has(p.id) && (Date.now() - activityTracker.get(p.id) < activeThreshold)) activeCount++;
                });
                return sock.sendMessage(jid, { text: `*📊 ACTIVITY REPORT*\n\n🟢 *Active (Last 30m):* ${activeCount}\n👻 *Silent/Ghosts:* ${metadata.participants.length - activeCount}\n\n_Tracking started since bot went online._` });
            }

            if (command === "!ginfo") {
                return sock.sendMessage(jid, { text: `*📊 ${BOT_NAME} REPORT*\n\n*Group:* ${metadata?.subject}\n*Members:* ${metadata?.participants?.length}\n*Admin Control:* Active 🟢\n*Powered by:* ${POWERED_BY}` });
            }

            if (command === "!kick" || command === "!promote") {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || m.message.extendedTextMessage?.contextInfo?.participant;
                if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                if (!target || target.includes(OWNER_NUMBER)) return sock.sendMessage(jid, { text: "❌ Target invalid." });
                const action = command === "!kick" ? "remove" : "promote";
                await sock.groupParticipantsUpdate(jid, [target], action)
                    .then(() => sock.sendMessage(jid, { text: `✅ Successfully ${action === "remove" ? "removed" : "promoted"}.` }))
                    .catch(() => sock.sendMessage(jid, { text: "❌ Failed. Am I admin?" }));
            }

            if (command === "!mute" || command === "!unmute") {
                const announce = command === "!mute" ? 'announcement' : 'not_announcement';
                await sock.groupSettingUpdate(jid, announce)
                    .then(() => sock.sendMessage(jid, { text: command === "!mute" ? "🔒 *Group Locked.*" : "🔓 *Group Unlocked.*" }));
            }

            if (command === "!reset") {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return sock.sendMessage(jid, { text: "Tag someone to reset strikes." });
                await Warn.deleteOne({ userId: target });
                return sock.sendMessage(jid, { text: `✅ Strikes cleared for @${target.split('@')[0]}`, mentions: [target] });
            }
        }
    });
}

// --- ORIGINAL UI DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Jarvis AI Dashboard</title>
        <style>
            body { margin:0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#f0f2f5; }
            header { background:#002b5c; color:white; padding:20px; text-align:center; font-size:22px; font-weight:bold; }
            .container { padding:20px; max-width:600px; margin:auto; }
            .card { background:white; padding:25px; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1); margin-bottom:20px; }
            h3 { color:#002b5c; margin-top:0; }
            input { width:100%; padding:14px; margin:10px 0; border:1px solid #ddd; border-radius:8px; box-sizing: border-box; }
            button { width:100%; padding:14px; background:#003f88; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; transition: 0.3s; }
            button:hover { background: #002b5c; }
            .code-box { margin-top:20px; padding:15px; background:#eef6ff; border:2px dashed #003f88; border-radius:8px; text-align:center; font-size:20px; font-weight:bold; color:#003f88; min-height:30px; }
            ‎.features { margin-top:25px; border-top: 1px solid #eee; pt:15px; }
            footer { text-align:center; padding:20px; font-size:13px; color:#777; }
        </style>
    </head>
    <body>
        <header>🤖 JARVIS AI: Flexi Digital Academy</header>
        <div class="container">
            <div class="card">
                <h3>Pairing Dashboard</h3>
                <input type="text" id="number" placeholder="234XXXXXXXXXX" />
                <button onclick="getCode()">Generate Pairing Code</button>
                <div class="code-box" id="code">-- -- -- --</div>
            </div>
            <div class="card">
                <h3>AI Key Settings</h3>
                <input type="password" id="apiKey" placeholder="Paste Gemini API Key" />
                <button onclick="updateKey()">Save AI Key</button>
                <p id="keyStatus" style="font-size:12px; color:green; margin-top:10px;"></p>
            </div>
            
            ‎<div class="features">
‎                    <h3>Active Protections</h3>
‎                    <ul>
‎                        <li><b>Anti-Link:</b> Auto-deletes group invite links.</li>
‎                        <li><b>Anti-Badword:</b> Filters offensive Nigerian/English slang.</li>
‎                        <li><b>Strike System:</b> 3 warnings = Auto-kick.</li>
‎                        <li><b>AI Assistant:</b> Full Gemini integration via <code>!ai</code>.</li>
‎                    </ul>
‎                </div>
‎            </div>
‎        </div>
        <footer>©2026 Flexi edTech Digital Academy</footer>
        <script>
            async function getCode() {
                const num = document.getElementById('number').value;
                document.getElementById('code').innerText = 'GENERATING...';
                const res = await fetch('/pair?number=' + num);
                const data = await res.text();
                document.getElementById('code').innerText = data;
            }
            async function updateKey() {
                const key = document.getElementById('apiKey').value;
                const res = await fetch('/update-key?key=' + key);
                document.getElementById('keyStatus').innerText = await res.text();
            }
        </script>
    </body>
    </html>`);
});

app.get('/pair', async (req, res) => {
    const number = req.query.number?.replace(/[^0-9]/g, '');
    if (!sock) return res.send("Bot starting...");
    try {
        const code = await sock.requestPairingCode(number);
        res.send(code);
    } catch { res.send("Error generating code"); }
});

app.get('/update-key', async (req, res) => {
    const key = req.query.key;
    await Config.findOneAndUpdate({ keyName: 'GEMINI_API_KEY' }, { keyValue: key }, { upsert: true });
    res.send("✅ Key Saved to Database!");
});

app.listen(port, () => startJARVIS());
        
