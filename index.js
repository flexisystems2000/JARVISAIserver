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

// --- Persistence & Config ---
const warnings = new Map();
const messageLog = new Map(); 
const badWords = ["stupid", "idiot", "scam", "fool"];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "You are JARVIS, an educational assistant for Flexi edTech Digital Academy. Only answer educational questions."
});

let sock;
let pairingCode = "";
let connectedNumber = "Not Connected";

// --- Utility Functions ---
const getText = (msg) => {
    if (!msg.message) return "";
    const m = msg.message;
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || "";
};

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

// --- Main Bot Logic ---
async function startJarvis(targetNumber = null) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Handle Pairing Code Request
    if (targetNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                pairingCode = await sock.requestPairingCode(targetNumber);
                console.log(`Pairing Code: ${pairingCode}`);
            } catch (e) { console.error("Pairing Error:", e); }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            connectedNumber = sock.user.id.split(':')[0];
            pairingCode = "";
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startJarvis();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const sender = msg.key.participant || jid;
        const text = getText(msg).toLowerCase();

        // Security & Moderation
        if (!isGroup) {
            return await sock.sendMessage(jid, { text: "Please join a group to interact with JARVIS." });
        }

        if (badWords.some(word => text.includes(word))) {
            return await handleWarning(sock, jid, sender, "Abusive Language");
        }

        // Commands
        if (text === "!menu") {
            await sock.sendMessage(jid, { text: `*JARVIS AI MENU*\n\n🔹 !groupinfo\n🔹 !add [number]\n🔹 !kick @user\n🔹 !ai [query]` });
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
            if (!num) return await sock.sendMessage(jid, { text: "Provide a number (e.g., 234...)" });
            
            const userJid = `${num}@s.whatsapp.net`;
            try {
                const resp = await sock.groupParticipantsUpdate(jid, [userJid], "add");
                
                // Handle privacy blocks (status 403)
                if (resp[0]?.status === "403") {
                    const code = await sock.groupInviteCode(jid);
                    await sock.sendMessage(jid, { text: "📩 Privacy settings detected. Sending an invite link to the user's DM instead." });
                    await sock.sendMessage(userJid, { text: `Hello! You've been invited to join our group: https://chat.whatsapp.com/${code}` });
                } else if (resp[0]?.status === "200") {
                    await sock.sendMessage(jid, { text: "✅ User added successfully." });
                }
            } catch (e) { 
                console.error("Add Error"); 
                await sock.sendMessage(jid, { text: "❌ Error adding user. Make sure I am an admin." });
            }
        }

        if (text.startsWith("!ai")) {
            const query = text.replace("!ai", "").trim();
            try {
                const result = await aiModel.generateContent(query);
                await sock.sendMessage(jid, { text: `🎓 *JARVIS AI*\n\n${result.response.text()}` });
            } catch (e) { await sock.sendMessage(jid, { text: "AI is currently busy." }); }
        }
    });
}

// --- Dashboard & Server ---
app.get("/", (req, res) => {
    const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>JARVIS | Flexi edTech</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f0f4f8; text-align: center; color: #1a237e; margin: 0; }
                .header { background: #1565c0; color: white; padding: 40px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .card { background: white; max-width: 450px; margin: -30px auto 40px; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
                input { padding: 12px; width: 85%; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; }
                button { padding: 12px 25px; background: #0044ff; color: white; border: none; border-radius: 8px; margin-top: 15px; cursor: pointer; font-weight: bold; }
                .code-box { font-size: 28px; color: #2e7d32; font-weight: bold; background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0; border: 2px dashed #2e7d32; letter-spacing: 4px; }
                .footer { padding: 20px; color: #78909c; font-size: 13px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>JARVIS AI DASHBOARD</h1>
                <p>Flexi edTech Digital Academy</p>
            </div>
            <div class="card">
                <h3>Connection Status</h3>
                <p>Status: <span style="color: ${connectedNumber === "Not Connected" ? "red" : "green"}">● ${connectedNumber === "Not Connected" ? "Disconnected" : "Connected ✅"}</span></p>
                ${connectedNumber !== "Not Connected" ? `<p>User: ${connectedNumber}</p>` : ""}
                
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                
                <h4>Link Your WhatsApp</h4>
                <form action="/pair" method="POST">
                    <input type="text" name="number" placeholder="Enter number (e.g. 2348012345678)" required>
                    <button type="submit">Generate Pairing Code</button>
                </form>

                ${pairingCode ? `
                    <div class="code-box">${pairingCode}</div>
                    <p style="font-size: 14px;">Open WhatsApp > Linked Devices > Link with Phone Number. Enter the code above.</p>
                ` : ""}
            </div>
            <div class="footer">©2026 Flexi edTech Digital Academy. All rights reserved.</div>
        </body>
        </html>
    `;
    res.send(htmlResponse); 
});

app.post("/pair", async (req, res) => {
    const num = req.body.number.replace(/\D/g, '');
    await startJarvis(num);
    res.redirect("/");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startJarvis(); 
});
            
