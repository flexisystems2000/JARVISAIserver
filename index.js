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

// --- CONFIGURATION ---
const OWNER_NUMBER = "2347051768946"; 
const BOT_NAME = "JARVIS AI";
const POWERED_BY = "Flexi Digital Academy";
const MONGO_URI = "mongodb+srv://JarvisAI:flexisystems2000@cluster0.7g5odvt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// --- DATABASE SCHEMAS ---
const WarnSchema = new mongoose.Schema({ userId: String, count: Number });
const Warn = mongoose.model('Warn', WarnSchema);

const QueueSchema = new mongoose.Schema({ 
    jid: String, 
    target: String, 
    type: String, 
    status: { type: String, default: 'pending' },
    retries: { type: Number, default: 0 }
});
const Queue = mongoose.model('Queue', QueueSchema);

// --- DATABASE CONNECTION ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected (Strict Admin Mode Active)"))
    .catch(err => console.log("❌ DB Error:", err));

const groupCache = new Map(); 
let sock; 
let isProcessing = false;

// --- QUEUE ---
async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;
    
    let task = await Queue.findOne({ status: 'pending' });

    while (task) {

        if (!sock?.user) {
            console.log("⏸️ Socket not ready, pausing queue...");
            break;
        }

        try {
            const code = await sock.groupInviteCode(task.jid);
            const inviteLink = `https://chat.whatsapp.com/${code}`;
            
            await sock.sendMessage(task.target, { 
                text: `Hello! You were invited to *${BOT_NAME}* group, but your privacy settings blocked the auto-add.\n\nJoin here: ${inviteLink}` 
            });

            await sock.sendMessage(task.jid, { 
                text: "📥 Privacy block detected. Invite sent to DM successfully." 
            });
            
            await Queue.deleteOne({ _id: task._id }); 

        } catch (e) {
            console.log("Queue Task Failed:", e);

            if (task.retries < 3) {
                await Queue.updateOne(
                    { _id: task._id },
                    { status: 'pending', $inc: { retries: 1 } }
                );
            } else {
                await Queue.updateOne(
                    { _id: task._id },
                    { status: 'failed' }
                );
            }
        }

        task = await Queue.findOne({ status: 'pending' });

        await new Promise(r => setTimeout(r, 400));
    }

    isProcessing = false;
}

async function startJARVIS() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000, 
        emitOwnEvents: true,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startJARVIS();
        } 
        
        else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Connected`);

            processQueue();

            setInterval(() => {
                processQueue();
            }, 3000);
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

        const botNumber = sock.user.id.split(':')[0];
        const mentions = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentions.some(v => v.includes(botNumber)) || text.includes("jarvis")) {
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
        const isStaff = sender.includes(OWNER_NUMBER) || admins.includes(sender);

        if (isStaff) {

            if (command === "!add") {
                if (!args[0]) return sock.sendMessage(jid, { text: "Provide a number!" });

                let target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";

                try {
                    const resp = await sock.groupParticipantsUpdate(jid, [target], "add");

                    if (resp[0]?.status === "200") {
                        return sock.sendMessage(jid, { text: "✅ Student added." });
                    }

                    if (["403", "408", "409"].includes(resp[0]?.status)) {
                        await sock.sendMessage(jid, { 
                            text: "⚠️ Privacy Block! Sending DM link via Queue..." 
                        });

                        const exists = await Queue.findOne({ jid, target, status: 'pending' });
                        if (exists) return;

                        await Queue.create({ jid, target, type: 'SEND_INVITE' });

                        processQueue();
                        return;
                    }

                } catch (e) { 
                    return sock.sendMessage(jid, { text: "❌ Error processing add." }); 
                }
            }

            if (command === "!kick") {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                             m.message.extendedTextMessage?.contextInfo?.participant ||
                             (args[0] ? args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net" : null);
                
                if (!target || target.includes(OWNER_NUMBER)) return;

                await sock.groupParticipantsUpdate(jid, [target], "remove");

                return sock.sendMessage(jid, { text: "🚫 Removed by Staff." });
            }
        }

        const punish = async (reason) => {
            let userWarn = await Warn.findOne({ userId: sender });

            if (!userWarn) userWarn = await Warn.create({ userId: sender, count: 0 });
            
            userWarn.count += 1;
            await userWarn.save();

            if (userWarn.count >= 3) {
                await sock.sendMessage(jid, { 
                    text: `🚫 @${sender.split('@')[0]} kicked for 3 strikes. Record cleared for fresh start.`, 
                    mentions: [sender] 
                });

                await sock.groupParticipantsUpdate(jid, [sender], "remove");

                await Warn.deleteOne({ userId: sender });

            } else {
                await sock.sendMessage(jid, { 
                    text: `⚠️ *STRIKE ${userWarn.count}/3*\n@${sender.split('@')[0]}\n*Reason:* ${reason}`, 
                    mentions: [sender] 
                });
            }
        };

        const badWords = ["are you okay", "you are mad", "your mother", "your father", "rubbish", "ode", "mumu", "foolish"];

        if (badWords.some(word => text.includes(word))) {
            await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
            return punish("Abusive language");
        }

        const hasLink = /https?:\/\/\S+|www\.\S+|wa\.me\/\S+/.test(text);

        if (hasLink || (text.includes("status") && text.includes("view"))) {
            await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
            return punish("Unauthorized links/ads");
        }
    });
}

// --- NEW APIs ---
app.get('/stats', async (req, res) => {
    res.json({
        groups: groupCache.size,
        users: await Warn.countDocuments(),
        pending: await Queue.countDocuments({ status: 'pending' }),
        failed: await Queue.countDocuments({ status: 'failed' }),
        bot: sock?.user ? "Online" : "Offline"
    });
});

app.get('/queue', async (req, res) => {
    res.json(await Queue.find().sort({ _id: -1 }).limit(10));
});

app.get('/clear-failed', async (req, res) => {
    await Queue.deleteMany({ status: 'failed' });
    res.send("Cleared");
});

// --- DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${BOT_NAME}</title>
<style>
body{background:#020617;color:white;text-align:center;padding:30px;font-family:sans-serif;}
.card{background:#1e293b;padding:25px;border-radius:15px;border:1px solid #38bdf8;max-width:500px;margin:auto;}
h1{color:#38bdf8;}
input{padding:12px;margin:10px;width:80%;border-radius:8px;border:none;}
button{background:#38bdf8;padding:12px;width:85%;border-radius:8px;font-weight:bold;cursor:pointer;}
</style>
</head>
<body>

<div class="card">
<h1>🤖 ${BOT_NAME}</h1>
<p>${POWERED_BY}</p>

<form action="/pair" method="POST">
<input name="number" placeholder="234..." required />
<button type="submit">Get Code</button>
</form>

<div id="stats">Loading...</div>
<div id="queue"></div>

<button onclick="clearQ()">Clear Failed</button>
</div>

<script>
async function load(){
    const s = await fetch('/stats').then(r=>r.json());
    document.getElementById('stats').innerHTML =
    "Status: "+s.bot+"<br>Groups: "+s.groups+"<br>Users: "+s.users+"<br>Pending: "+s.pending+"<br>Failed: "+s.failed;

    const q = await fetch('/queue').then(r=>r.json());
    document.getElementById('queue').innerHTML = q.map(x=>"• "+x.target+" ("+x.status+")").join("<br>");
}

function clearQ(){ fetch('/clear-failed'); }

setInterval(load,3000);
load();
</script>

</body>
</html>`);
});

app.post('/pair', async (req, res) => {
    const number = req.body.number.replace(/[^0-9]/g, '');
    try {
        const code = await sock.requestPairingCode(number);
        res.send(`<body style="background:#0f172a;color:white;text-align:center;padding:100px;"><h1>CODE: ${code}</h1></body>`);
    } catch (e) { 
        res.send("<h1>Error - Session Busy</h1>"); 
    }
});

app.listen(port, () => startJARVIS());
