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

// --- AI FUNCTION ---
async function askAI(prompt) {
    try {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }]
            }
        );
        return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "🤖 I couldn't process that request.";
    } catch (err) {
        console.log("AI Error:", err.message);
        return "⚠️ AI service is currently unavailable. Please check the API key.";
    }
}

// --- DATABASE ---
const WarnSchema = new mongoose.Schema({ userId: String, count: Number });
const Warn = mongoose.model('Warn', WarnSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

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
        browser: ["Mac OS", "Chrome", "125.0.0"]
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

    // --- WELCOME SYSTEM (Updated Tag Placement) ---
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const metadata = await sock.groupMetadata(anu.id);
            const participants = anu.participants;

            for (const num of participants) {
                if (anu.action === 'add') {
                    const welcomeText = `@${num.split('@')[0]}\n\n` +
                        `**Greetings from Jarvis AI**\n\n` +
                        `You're welcome to *${metadata.subject}*\n\n` +
                        `Please read the group rules carefully to stay updated\n\n` +
                        `- Posting of links is strictly prohibited ✍️\n` +
                        `- Avoid using stickers during lessons\n` +
                        `- Stay on topic — no off-topic discussions during classes\n` +
                        `- Do not tag this group in your status\n` +
                        `- Engage actively in group activities; inactive members may be removed to create space for active participants\n` +
                        `- Feel free to invite friends who are also preparing for SSCE or UTME`;

                    await sock.sendMessage(anu.id, { text: welcomeText, mentions: [num] });
                }
            }
        } catch (err) { console.log("Welcome Error:", err.message); }
    });
    

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "";
        const text = body.toLowerCase().trim();
        const isOwner = sender.includes(OWNER_NUMBER);

                // --- SMART REACTIONS (Place after defining 'text' and before 'isStaff') ---
        if (text.includes("jarvis") && !text.startsWith("!")) {
            await sock.sendMessage(jid, { react: { key: m.key, text: "🤖" } });
        }
        
        // --- GROUP METADATA & PERMISSIONS ---
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
            } catch { metadata = { subject: "Group", participants: [] }; }
        }

        const command = text.split(/ +/)[0];
        const args = body.trim().split(/ +/).slice(1);

        // --- WATCHDOG (Antilink, Antibadwords) ---
        if (jid.endsWith('@g.us') && !isStaff) {
            const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish", "stupid", "bastard"];
            const isLink = text.includes("http") || text.includes(".com") || text.includes("chat.whatsapp");
            const isBadWord = badWords.some(word => text.includes(word));

            if (isLink || isBadWord) {
                await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
                let userWarn = await Warn.findOneAndUpdate({ userId: sender }, { $inc: { count: 1 } }, { upsert: true, new: true });
                
                if (userWarn.count >= 3) {
                    await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} removed for hitting 3 strikes.`, mentions: [sender] });
                    await sock.groupParticipantsUpdate(jid, [sender], "remove");
                    await Warn.deleteOne({ userId: sender });
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ *Watchdog Alert*\n@${sender.split('@')[0]}, violation detected. Strike ${userWarn.count}/3.`, mentions: [sender] });
                }
                return;
            }
        }

        // --- COMMANDS ---
        if (isStaff) {
            if (command === "!ai") {
                const prompt = args.join(" ");
                if (!prompt) return sock.sendMessage(jid, { text: "Oya, what is your question?" });
                await sock.sendPresenceUpdate('composing', jid);
                const aiReply = await askAI(prompt);
                return sock.sendMessage(jid, { text: `🤖 *JARVIS AI*\n\n${aiReply}` });
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
                    .then(() => sock.sendMessage(jid, { text: `✅ Successfully ${action === "remove" ? "removed" : "promoted"} member.` }))
                    .catch(() => sock.sendMessage(jid, { text: "❌ Failed. Am I admin?" }));
            }
                        // --- MUTE / UNMUTE ---
            if (command === "!mute" || command === "!unmute") {
                const announce = command === "!mute" ? 'announcement' : 'not_announcement';
                
                await sock.groupSettingUpdate(jid, announce)
                    .then(() => {
                        const status = command === "!mute" 
                            ? "🔒 *Group Locked:* Only Admins can send messages now. Please stay tuned for the lesson."
                            : "🔓 *Group Unlocked:* Members can now send messages. Keep the discussion academic!";
                        
                        sock.sendMessage(jid, { text: status });
                    })
                    .catch(() => {
                        sock.sendMessage(jid, { text: "❌ Failed. Make sure I am an Admin." });
           }
            

            if (command === "!reset") {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return sock.sendMessage(jid, { text: "Tag the user to reset strikes." });
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
            .card { background:white; padding:25px; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
            h3 { color:#002b5c; margin-top:0; }
            input { width:100%; padding:14px; margin:10px 0; border:1px solid #ddd; border-radius:8px; box-sizing: border-box; }
            button { width:100%; padding:14px; background:#003f88; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; transition: 0.3s; }
            button:hover { background: #002b5c; }
            .code-box { margin-top:20px; padding:15px; background:#eef6ff; border:2px dashed #003f88; border-radius:8px; text-align:center; font-size:20px; font-weight:bold; color:#003f88; min-height:30px; }
            .features { margin-top:25px; border-top: 1px solid #eee; pt:15px; }
            ul { padding-left:20px; color: #444; }
            li { margin-bottom: 8px; }
            footer { text-align:center; padding:20px; font-size:13px; color:#777; }
        </style>
    </head>
    <body>
        <header>🤖 JARVIS AI: Flexi Digital Academy</header>
        <div class="container">
            <div class="card">
                <h3>Pairing Dashboard</h3>
                <p>Enter your phone number with country code (e.g., 234...)</p>
                <input type="text" id="number" placeholder="234XXXXXXXXXX" />
                <button onclick="getCode()">Generate Pairing Code</button>
                <div class="code-box" id="code">-- -- -- --</div>

                <div class="features">
                    <h3>Active Protections</h3>
                    <ul>
                        <li><b>Anti-Link:</b> Auto-deletes group invite links.</li>
                        <li><b>Anti-Badword:</b> Filters offensive Nigerian/English slang.</li>
                        <li><b>Strike System:</b> 3 warnings = Auto-kick.</li>
                        <li><b>AI Assistant:</b> Full Gemini integration via <code>!ai</code>.</li>
                    </ul>
                </div>
            </div>
        </div>
        <footer>©2026 Flexi edTech Digital Academy</footer>
        <script>
            async function getCode() {
                const num = document.getElementById('number').value;
                if (!num) return alert('Please enter your number first');
                document.getElementById('code').innerText = 'GENERATING...';
                try {
                    const res = await fetch('/pair?number=' + num);
                    const data = await res.text();
                    document.getElementById('code').innerText = data;
                } catch (e) {
                    document.getElementById('code').innerText = 'ERROR';
                }
            }
        </script>
    </body>
    </html>`);
});

app.get('/pair', async (req, res) => {
    const number = req.query.number.replace(/[^0-9]/g, '');
    if (!sock) return res.send("Bot starting... refresh in 5s");
    try {
        const code = await sock.requestPairingCode(number);
        res.send(code);
    } catch {
        res.send("Error generating code");
    }
});

app.listen(port, () => startJARVIS());
                                                       
