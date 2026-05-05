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

// --- CRASH GUARDS ---
process.on('uncaughtException', (err) => console.log('⚠️ System Error:', err.message));
process.on('unhandledRejection', (err) => console.log('⚠️ Rejection Guard:', err.message));

// --- CONFIG ---
const OWNER_NUMBER = "2347051768946"; 
const BOT_NAME = "JARVIS AI";
const POWERED_BY = "Flexi Digital Academy";
const MONGO_URI = "mongodb+srv://JarvisAI:flexisystems2000@cluster0.7g5odvt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// --- AI FUNCTION ---
async function askAI(prompt) {
    try {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }]
            }
        );
        return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "🤖 No response.";
    } catch (err) {
        console.log("AI Error:", err.message);
        return "⚠️ AI unavailable right now.";
    }
}

// --- DATABASE ---
const WarnSchema = new mongoose.Schema({ userId: String, count: Number });
const Warn = mongoose.model('Warn', WarnSchema);

const QueueSchema = new mongoose.Schema({ 
    jid: String, 
    target: String, 
    status: { type: String, default: 'pending' }
});
const Queue = mongoose.model('Queue', QueueSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

const groupCache = new Map();
let sock;
let isProcessing = false;

// --- QUEUE ---
async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        let task = await Queue.findOne({ status: 'pending' });
        while (task) {
            if (!sock?.user) break;
            try {
                const code = await sock.groupInviteCode(task.jid);
                const inviteLink = `https://chat.whatsapp.com/${code}`;

                await sock.presenceSubscribe(task.target);
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendPresenceUpdate('composing', task.target);
                await new Promise(r => setTimeout(r, 1500));

                await sock.sendMessage(task.target, {
                    text: `Hello! JARVIS here. Your privacy settings blocked the group add.\n\n*Join here:*\n${inviteLink}`
                });

                await sock.sendMessage(task.jid, { text: `📥 Invite sent to DM for ${task.target.split('@')[0]}` });
                await Queue.deleteOne({ _id: task._id });
            } catch {
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
        const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "";
        const text = body.toLowerCase().trim();
        
        const isOwner = sender.includes(OWNER_NUMBER);

        if (text.includes("jarvis")) {
            await sock.sendMessage(jid, { react: { key: m.key, text: "🤖" } });
        }

        if (!jid.endsWith('@g.us') && !isOwner) return;

        let metadata;
        if (jid.endsWith('@g.us')) {
            try {
                metadata = groupCache.get(jid);
                if (!metadata || Date.now() - (metadata.lastFetch || 0) > 600000) {
                    metadata = await sock.groupMetadata(jid);
                    metadata.lastFetch = Date.now();
                    groupCache.set(jid, metadata);
                }
            } catch { metadata = { subject: "Group", participants: [] }; }
        }

        const admins = (metadata?.participants || []).filter(p => p.admin).map(p => p.id);
        const isStaff = isOwner || admins.includes(sender);
        
        const command = text.split(/ +/)[0];
        const args = body.trim().split(/ +/).slice(1);

        // --- AI ---
        if (text && !command.startsWith("!") && (text.includes("jarvis") || !jid.endsWith('@g.us'))) {
            try {
                await sock.sendPresenceUpdate('composing', jid);
                const aiReply = await askAI(body);
                await sock.sendMessage(jid, { text: `🤖 *JARVIS AI*\n\n${aiReply}` });
            } catch (e) {
                console.log("AI Reply Error:", e.message);
            }
        }

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
            if (command === "!ginfo") {
                return sock.sendMessage(jid, { text: `*📊 ${BOT_NAME} REPORT*\n\nGroup: ${metadata.subject}\nMembers: ${metadata.participants.length}\nStatus: Active 🟢` });
            }

            if (command === "!add") {
                let num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return sock.sendMessage(jid, { text: "Oya, type the number." });
                let jidTarget = num + "@s.whatsapp.net";
                const resp = await sock.groupParticipantsUpdate(jid, [jidTarget], "add").catch(() => null);
                if (!resp || !resp[0] || resp[0].status.toString() !== "200") {
                    await Queue.create({ jid, target: jidTarget });
                    processQueue();
                    return sock.sendMessage(jid, { text: `📨 Privacy detected. Sending invite to DM.` });
                }
                return sock.sendMessage(jid, { text: `✅ Added ${num}.` });
            }

            if (command === "!kick" || command === "!promote") {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             m.message.extendedTextMessage?.contextInfo?.participant;
                if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                if (!target || target.includes(OWNER_NUMBER)) return;

                const action = command === "!kick" ? "remove" : "promote";
                await sock.groupParticipantsUpdate(jid, [target], action).catch(() => {});
                return sock.sendMessage(jid, { text: `✅ ${action.toUpperCase()} done.` });
            }
        }
    });
}

// --- UI (UPDATED WITH YOUR DESIGN) ---
app.get('/', (req, res) => {
res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Jarvis AI Dashboard</title>
<style>
body { margin:0; font-family: Arial; background:#f4f8fc; }
header { background:#002b5c; color:white; padding:15px; text-align:center; font-size:18px; font-weight:bold; }
.container { padding:20px; max-width:500px; margin:auto; }
.card { background:white; padding:20px; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
input { width:100%; padding:12px; margin-top:10px; border:1px solid #ccc; border-radius:6px; }
button { width:100%; padding:12px; margin-top:10px; background:#003f88; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; }
.code { margin-top:15px; padding:10px; background:#e6f0ff; border-radius:6px; text-align:center; font-weight:bold; }
.features { margin-top:20px; }
.features h3 { color:#003366; }
.features ul { padding-left:20px; }
footer { text-align:center; padding:15px; margin-top:20px; font-size:13px; color:#555; }
</style>
</head>
<body>
<header>🤖 JARVIS AI powered by Flexi edTech Digital Academy</header>
<div class="container">
<div class="card">
<h3>Connect WhatsApp</h3>
<input type="text" id="number" placeholder="Enter your WhatsApp number (234...)" />
<button onclick="getCode()">Get Pairing Code</button>
<div class="code" id="code">Your pairing code will appear here</div>

<div class="features">
<h3>Features of Jarvis AI</h3>
<ul>
<li>AI Educational Assistant</li>
<li>Antilink Protection</li>
<li>Antispam System</li>
<li>Antibadwords Filter</li>
<li>Group Management</li>
<li>Jarvis Smart Reactions 🤖</li>
</ul>
</div>

</div>
</div>

<footer>©2026 Flexi edTech Digital Academy. All rights reserved</footer>

<script>
async function getCode() {
  const number = document.getElementById('number').value;
  if (!number) return alert('Enter number');

  const res = await fetch('/pair?number=' + number);
  const data = await res.text();

  document.getElementById('code').innerText = data;
}
</script>
</body>
</html>`);
});

app.get('/pair', async (req, res) => {
    const number = req.query.number.replace(/[^0-9]/g, '');
    const code = await sock.requestPairingCode(number);
    res.send(code);
});

app.listen(port, () => startJARVIS());
