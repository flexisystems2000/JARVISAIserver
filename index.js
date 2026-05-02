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
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startJARVIS();
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is active for ${POWERED_BY}`);
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

        // --- TAG REACTION LOGIC ---
        const botNumber = sock.user.id.split(':')[0] + "@s.whatsapp.net";
        const isMentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botNumber) || text.includes("jarvis");

        if (isMentioned) {
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

        if (isStaff) {
            if (command === "!add") {
                if (!args[0]) return sock.sendMessage(jid, { text: "Oya, provide the number! Example: !add 2348000000000" });
                let target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                try {
                    await sock.groupParticipantsUpdate(jid, [target], "add");
                    return sock.sendMessage(jid, { text: "✅ Student added successfully." });
                } catch (e) {
                    return sock.sendMessage(jid, { text: "❌ Failed. Ensure I am Admin." });
                }
            }
            if (command === "!ginfo") {
                let info = `*📂 ${BOT_NAME} REPORT*\n\n*Group:* ${metadata.subject}\n*Members:* ${metadata.participants.length}\n*Admins:* ${admins.length}`;
                return sock.sendMessage(jid, { text: info });
            }
            return; 
        }

        const punish = async (reason) => {
            warns[sender] = (warns[sender] || 0) + 1;
            if (warns[sender] >= 3) {
                await sock.sendMessage(jid, { text: `🚫 @${sender.split('@')[0]} kicked for violations.`, mentions: [sender] });
                await sock.groupParticipantsUpdate(jid, [sender], "remove");
                delete warns[sender];
            } else {
                await sock.sendMessage(jid, { text: `⚠️ *STRIKE ${warns[sender]}/3*\n@${sender.split('@')[0]}\n*Reason:* ${reason}`, mentions: [sender] });
            }
        };

        const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish"];
        const containsBadWord = badWords.some(word => text.includes(word));
        
        if (containsBadWord) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Abusive language/Insults");
        }

        const hasLink = /https?:\/\/\S+|www\.\S+|wa\.me\/\S+/.test(text);
        const isStatusAd = text.includes("status") && (text.includes("view") || text.includes("check"));

        if (hasLink || isStatusAd) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Unauthorized links/Status ads");
        }

        const now = Date.now();
        if (!floodTracker[sender]) floodTracker[sender] = [];
        floodTracker[sender] = floodTracker[sender].filter(t => now - t < 10000);
        floodTracker[sender].push(now);

        if (floodTracker[sender].length > 5) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Spamming/Flooding");
        }
    });
}

// --- WEB DASHBOARD (HTML + CSS INCLUDED) ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_NAME} | Dashboard</title>
        <style>
            body { background: #0f172a; color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 50px 20px; }
            .card { background: #1e293b; padding: 40px; border-radius: 20px; border: 1px solid #38bdf8; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 400px; width: 100%; }
            h1 { color: #38bdf8; margin-bottom: 10px; }
            p { color: #94a3b8; margin-bottom: 30px; }
            input { padding: 15px; margin: 10px 0; width: 90%; border-radius: 10px; border: none; background: #334155; color: white; font-size: 16px; }
            button { background: #38bdf8; color: #0f172a; border: none; padding: 15px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 16px; transition: 0.3s; width: 100%; }
            button:hover { background: #0ea5e9; transform: translateY(-2px); }
            .status { margin-top: 20px; font-size: 14px; color: #4ade80; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🤖 ${BOT_NAME}</h1>
            <p>Official Enforcer for ${POWERED_BY}</p>
            <form action="/pair" method="POST">
                <input name="number" placeholder="e.g. 2347051768946" required />
                <button type="submit">Generate Pairing Code</button>
            </form>
            <div class="status">● System Online</div>
        </div>
    </body>
    </html>
    `);
});

app.post('/pair', async (req, res) => {
    const number = req.body.number.replace(/[^0-9]/g, '');
    if (!number) return res.send("❌ Invalid Number");
    try {
        const code = await sock.requestPairingCode(number);
        res.send(`
            <body style="background: #0f172a; color: white; font-family: sans-serif; text-align: center; padding: 100px 20px;">
                <div style="border: 2px solid #38bdf8; display: inline-block; padding: 50px; border-radius: 20px; background: #1e293b; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                    <h2 style="color: #94a3b8;">YOUR PAIRING CODE</h2>
                    <h1 style="font-size: 60px; letter-spacing: 12px; color: #38bdf8; margin: 20px 0;">${code}</h1>
                    <p style="color: #4ade80;">Enter this on WhatsApp > Linked Devices > Link with Phone Number</p>
                    <br>
                    <a href="/" style="color: #38bdf8; text-decoration: none; font-weight: bold;">← Go Back</a>
                </div>
            </body>
        `);
    } catch (e) {
        res.send("<h1 style='color:white; text-align:center;'>❌ Failed. Please Restart Render.</h1>");
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🌐 Dashboard online at port ${port}`));
startJARVIS();
                
