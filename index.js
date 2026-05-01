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

// --- IN-MEMORY DATABASE ---
const warns = {}; 
const floodTracker = {}; 
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

    // --- CONNECTION HANDLER ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startJARVIS();
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is active for ${POWERED_BY}`);
        }
    });

    // --- MESSAGE HANDLER ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        if (!isGroup) return;

        const sender = m.key.participant || m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
        const command = text.split(/ +/)[0].toLowerCase();
        const args = text.split(/ +/).slice(1);

        // 1. GET GROUP DATA & PERMISSIONS
        const metadata = await sock.groupMetadata(jid);
        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
        
        const isOwner = sender.includes(OWNER_NUMBER);
        const isStaff = isOwner || admins.includes(sender);

        // 2. ADMIN & OWNER COMMANDS
        if (isStaff) {
            if (command === "!add") {
                if (!args[0]) return sock.sendMessage(jid, { text: "Oya, provide the number! Example: !add 2348000000000" });
                let target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                try {
                    await sock.groupParticipantsUpdate(jid, [target], "add");
                    return sock.sendMessage(jid, { text: "✅ Student added successfully." });
                } catch (e) {
                    return sock.sendMessage(jid, { text: "❌ Failed to add. Ensure I am an Admin." });
                }
            }

            if (command === "!ginfo") {
                const creationDate = new Date(metadata.creation * 1000).toLocaleString();
                let info = `*📂 ${BOT_NAME} GROUP REPORT*\n\n*Name:* ${metadata.subject}\n*Created:* ${creationDate}\n*Members:* ${metadata.participants.length}\n*Admins:* ${admins.length}`;
                return sock.sendMessage(jid, { text: info });
            }

            return; // Exit here so rules don't fire for Staff
        }

        // 3. REGULAR MEMBER RULES (Enforcer Mode)
        const punish = async (reason) => {
            warns[sender] = (warns[sender] || 0) + 1;
            
            if (warns[sender] >= 3) {
                await sock.sendMessage(jid, { 
                    text: `🚫 *TERMINATED*\n\n@${sender.split('@')[0]} reached 3 warnings. Bye!`,
                    mentions: [sender]
                });
                await sock.groupParticipantsUpdate(jid, [sender], "remove");
                delete warns[sender];
            } else {
                await sock.sendMessage(jid, { 
                    text: `⚠️ *STRIKE ${warns[sender]}/3*\n\n@${sender.split('@')[0]}\n*Reason:* ${reason}`,
                    mentions: [sender]
                });
            }
        };

        // Anti-Flood
        const now = Date.now();
        if (!floodTracker[sender]) floodTracker[sender] = [];
        floodTracker[sender] = floodTracker[sender].filter(t => now - t < 10000);
        floodTracker[sender].push(now);

        if (floodTracker[sender].length > 5) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Spamming/Flood");
        }

        // Anti-Link & Anti-Status
        const hasLink = /https?:\/\/\S+|www\.\S+|wa\.me\/\S+/.test(text.toLowerCase());
        const isStatusAd = text.toLowerCase().includes("status") && (text.toLowerCase().includes("view") || text.toLowerCase().includes("check"));

        if (hasLink || isStatusAd) {
            await sock.sendMessage(jid, { delete: m.key });
            return punish("Unauthorized links/Status ads");
        }
    });
}

// --- WEB DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>${BOT_NAME} Dashboard</title>
        <style>
            body { background: #0f172a; color: white; font-family: sans-serif; text-align: center; padding: 50px; }
            .card { background: #1e293b; padding: 30px; border-radius: 15px; border: 1px solid #38bdf8; display: inline-block; }
            input { padding: 12px; margin: 10px; width: 280px; border-radius: 8px; border: none; background: #334155; color: white; }
            button { background: #38bdf8; color: #0f172a; border: none; padding: 12px 25px; border-radius: 8px; font-weight: bold; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🤖 ${BOT_NAME}</h1>
            <p>Powered by ${POWERED_BY}</p>
            <form action="/pair" method="POST">
                <input name="number" placeholder="2347051768946" required />
                <br>
                <button type="submit">Get Pairing Code</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

app.post('/pair', async (req, res) => {
    const number = req.body.number.replace(/[^0-9]/g, '');
    if (!number) return res.send("❌ Error: Invalid Number");

    try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const code = await sock.requestPairingCode(number);
        res.send(`
            <body style="background: #0f172a; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
                <div style="border: 2px solid #38bdf8; display: inline-block; padding: 50px; border-radius: 15px; background: #1e293b;">
                    <h2>PAIRING CODE</h2>
                    <h1 style="font-size: 60px; letter-spacing: 10px;">${code}</h1>
                    <p>Enter this on WhatsApp > Linked Devices</p>
                    <a href="/" style="color: #38bdf8;">Back</a>
                </div>
            </body>
        `);
    } catch (e) {
        res.send("<h1>❌ Failed to generate code. Restart Render.</h1>");
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🌐 Dashboard online at port ${port}`));
startJARVIS();
