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
        printQRInTerminal: true, // Keep QR as backup in terminal
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

    // --- MESSAGE HANDLER (THE ENFORCER) ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();

        // 1. OWNER & ADMIN IMMUNITY
        if (sender.includes(OWNER_NUMBER)) return;
        
        if (isGroup) {
            const metadata = await sock.groupMetadata(jid);
            const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
            if (admins.includes(sender)) return;

            // 2. PUNISHMENT LOGIC
            const punish = async (reason) => {
                warns[sender] = (warns[sender] || 0) + 1;
                
                if (warns[sender] >= 3) {
                    await sock.sendMessage(jid, { 
                        text: `🚫 *TERMINATED*\n\n@${sender.split('@')[0]} has been kicked for repeated violations: ${reason}.`,
                        mentions: [sender]
                    });
                    await sock.groupParticipantsUpdate(jid, [sender], "remove");
                    delete warns[sender];
                } else {
                    await sock.sendMessage(jid, { 
                        text: `⚠️ *STRIKE ${warns[sender]}/3*\n\n@${sender.split('@')[0]}\n*Reason:* ${reason}\n\n_Keep it clean or be removed._`,
                        mentions: [sender]
                    });
                }
            };

            // 3. ANTI-FLOOD
            const now = Date.now();
            if (!floodTracker[sender]) floodTracker[sender] = [];
            floodTracker[sender] = floodTracker[sender].filter(t => now - t < 10000);
            floodTracker[sender].push(now);

            if (floodTracker[sender].length > 5) {
                await sock.sendMessage(jid, { delete: m.key });
                return punish("Flood/Spamming");
            }

            // 4. ANTI-LINK & ANTI-STATUS
            const hasLink = /https?:\/\/\S+|www\.\S+|wa\.me\/\S+/.test(text.toLowerCase());
            const isStatusAd = text.toLowerCase().includes("status") && (text.toLowerCase().includes("view") || text.toLowerCase().includes("check"));

            if (hasLink || isStatusAd) {
                await sock.sendMessage(jid, { delete: m.key });
                return punish("Unauthorized links/Status ads");
            }
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
            body { background: #0f172a; color: white; font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; }
            .card { background: #1e293b; padding: 30px; border-radius: 15px; border: 1px solid #38bdf8; display: inline-block; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
            input { padding: 12px; margin: 10px; width: 280px; border-radius: 8px; border: none; background: #334155; color: white; }
            button { background: #38bdf8; color: #0f172a; border: none; padding: 12px 25px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; }
            button:hover { background: #0ea5e9; }
            .footer { margin-top: 30px; font-size: 12px; color: #64748b; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1 style="color: #38bdf8;">🤖 ${BOT_NAME}</h1>
            <p>Security for ${POWERED_BY}</p>
            <form action="/pair" method="POST">
                <input name="number" placeholder="2347051768946" required />
                <br>
                <button type="submit">Get Pairing Code</button>
            </form>
            <div class="footer">Owner: FLEXI SYSTEMS</div>
        </div>
    </body>
    </html>
    `);
});

// --- PAIRING CODE LOGIC ---
app.post('/pair', async (req, res) => {
    const number = req.body.number.replace(/[^0-9]/g, '');
    if (!number) return res.send("❌ Error: Invalid Number");

    if (sock.authState.creds.registered) {
        return res.send("<h1>Already Connected ✅</h1><a href='/'>Go Back</a>");
    }

    try {
        const code = await sock.requestPairingCode(number);
        res.send(`
            <body style="background: #0f172a; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
                <div style="border: 2px solid #38bdf8; display: inline-block; padding: 50px; border-radius: 15px; background: #1e293b;">
                    <h2 style="color: #38bdf8;">PAIRING CODE</h2>
                    <h1 style="font-size: 60px; letter-spacing: 10px;">${code}</h1>
                    <p>Go to WhatsApp > Linked Devices > Link with Phone Number</p>
                    <p>Type this code on your phone now.</p>
                    <a href="/" style="color: #64748b; text-decoration: none;">← Back</a>
                </div>
            </body>
        `);
    } catch (e) {
        res.send("<h1>❌ Failed to generate code. Try again later.</h1>");
    }
});

app.listen(port, () => console.log(`🌐 Dashboard: http://localhost:${port}`));
startJARVIS();
                                       
