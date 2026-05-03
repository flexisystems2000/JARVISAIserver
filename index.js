const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// State Persistence
const warnings = new Map();
const messageLog = new Map(); // ✅ Anti-Spam
const badWords = ["stupid", "idiot", "scam", "fool"];

// AI Config
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "You are JARVIS, an educational assistant for Flexi edTech Digital Academy. Only answer educational questions."
});

let sock;
let pairingCode = "";
let connectedNumber = "Not Connected";

// ✅ FIXED TEXT EXTRACTOR
const getText = (msg) => {
    if (!msg.message) return "";
    const m = msg.message;

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        ""
    );
};

async function startJarvis(targetNumber = null) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    if (targetNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                pairingCode = await sock.requestPairingCode(targetNumber);
            } catch (e) { console.error("Pairing Error:", e); }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            connectedNumber = sock.user.id.split(':')[0];
            pairingCode = "";
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startJarvis(targetNumber);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];

        // ✅ FIXED SAFETY CHECK
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const sender = msg.key.participant || jid;

        // ✅ USE FIXED EXTRACTOR
        const text = getText(msg).toLowerCase();

        // 1. Anti-Status Mention
        if (msg.messageStubType === 204 || msg.messageStubType === 'GROUP_MENTIONED_IN_STATUS') {
            await handleWarning(sock, jid, sender, "Status Mention");
            return;
        }

        if (!isGroup) {
            await sock.sendMessage(jid, { text: "Please join a group to interact with JARVIS." });
            return;
        }

        // 2. Anti-Spam
        const now = Date.now();
        const userLogs = messageLog.get(sender) || [];
        const recentLogs = userLogs.filter(time => now - time < 10000);
        recentLogs.push(now);
        messageLog.set(sender, recentLogs);

        if (recentLogs.length > 5)
            return await handleWarning(sock, jid, sender, "Spamming");

        // 3. Anti-Link & Bad Words
        if (/https?:\/\/\S+/.test(text))
            return await handleWarning(sock, jid, sender, "Anti-Link");

        if (badWords.some(word => text.includes(word)))
            return await handleWarning(sock, jid, sender, "Abusive Language");

        // Detect Jarvis call
        const isJarvisCalled =
            text.includes("jarvis") ||
            msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net');

        if (isJarvisCalled) {
            await sock.sendMessage(jid, {
                react: {
                    text: "🤖",
                    key: msg.key
                }
            });
        }

        // --- COMMANDS ---

        if (text === "!menu") {
            await sock.sendMessage(jid, { text: `*JARVIS AI MENU*\nPowered by Flexi edTech Digital Academy\n\n🔹 !groupinfo\n🔹 !kick @user\n🔹 !add 234...\n🔹 !ai [query]\n\n©2026 Flexi edTech Digital Academy` });
        }

        if (text === "!groupinfo") {
            const metadata = await sock.groupMetadata(jid);
            await sock.sendMessage(jid, { text: `📌 *Group:* ${metadata.subject}\n👥 *Members:* ${metadata.participants.length}` });
        }

        if (text.startsWith("!kick")) {
            const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return await sock.sendMessage(jid, { text: "Tag a user." });
            await sock.groupParticipantsUpdate(jid, [target], "remove");
        }

        if (text.startsWith("!add")) {
            const num = text.replace("!add", "").trim();
            const userJid = `${num}@s.whatsapp.net`;
            try {
                const resp = await sock.groupParticipantsUpdate(jid, [userJid], "add");
                if (resp[0]?.status === "403") {
                    const code = await sock.groupInviteCode(jid);
                    await sock.sendMessage(userJid, { text: `Invite Link: https://chat.whatsapp.com/${code}` });
                }
            } catch (e) { console.error("Add Error"); }
        }

        if (text.startsWith("!ai")) {
            const query = text.replace("!ai", "").trim();
            if (["how", "what", "solve", "math", "why", "define", "explain"].some(k => query.includes(k))) {
                try {
                    const result = await aiModel.generateContent(query);
                    await sock.sendMessage(jid, { text: `🎓 *JARVIS AI*\n\n${result.response.text()}` });
                } catch (e) { await sock.sendMessage(jid, { text: "AI Busy." }); }
            } else {
                await sock.sendMessage(jid, { text: "❌ Educational questions only." });
            }
        }
    });

    async function handleWarning(sock, jid, user, reason) {
        let count = (warnings.get(user) || 0) + 1;
        warnings.set(user, count);
        if (count >= 3) {
            await sock.sendMessage(jid, { text: `⛔ @${user.split('@')[0]} kicked for ${reason}.`, mentions: [user] });
            await sock.groupParticipantsUpdate(jid, [user], "remove");
            warnings.delete(user);
        } else {
            await sock.sendMessage(jid, { text: `⚠️ Strike [${count}/3] for @${user.split('@')[0]}\nReason: ${reason}`, mentions: [user] });
        }
    }
}

// --- DASHBOARD (UNCHANGED) ---
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>JARVIS | Flexi edTech</title>
            <style>
                body { font-family: sans-serif; background: #f0f4f8; text-align: center; color: #1a237e; margin: 0; }
                .header { background: #1565c0; color: white; padding: 40px; }
                .card { background: white; max-width: 450px; margin: -30px auto 40px; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
                input { padding: 12px; width: 80%; border: 1px solid #ddd; border-radius: 8px; }
                button { padding: 12px 25px; background: #0044ff; color: white; border: none; border-radius: 8px; margin-top: 15px; cursor: pointer; font-weight: bold; }
                .code { font-size: 32px; color: #2e7d32; font-weight: bold; background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0; border: 2px dashed #2e7d32; letter-spacing: 5px; }
            </style>
        </head>
        <body>
            <div class="header"><h1>JARVIS AI DASHBOARD</h1><p>Flexi edTech Digital Academy</p></div>
            <div class="card">
                <h3>Status: ${connectedNumber === "Not Connected" ? "Disconnected ❌" : "Connected ✅"}</h3>
                <p>User: ${connectedNumber}</p>
                <hr>
                <form action="/pair" method="POST">
                    <input type="text" name="number" placeholder="2348012345678" required>
                    <button type="submit">Get Pairing Code</button>
                </form>
                ${pairingCode ? `<div class="code">${pairingCode}</div>` : ""}
            </div>
            <p>©2026 Flexi edTech Digital Academy. All rights reserved.</p>
        </body>
        </html>
    `);
});

app.post("/pair", async (req, res) => {
    const num = req.body.number.replace(/\D/g, '');
    await startJarvis(num);
    res.redirect("/");
});

app.listen(PORT, () => {
    startJarvis();
    setInterval(() => { if(process.env.RENDER_EXTERNAL_URL) axios.get(process.env.RENDER_EXTERNAL_URL).catch(()=>{}); }, 600000);
});
