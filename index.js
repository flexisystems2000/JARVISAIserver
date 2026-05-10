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

const firebaseConfig = {
  apiKey: "AIzaSyCoGX2bXlvuwcJY8oyW6_J42fgxfH5vZao",
  authDomain: "jarvisai-1a594.firebaseapp.com",
  projectId: "jarvisai-1a594",
  storageBucket: "jarvisai-1a594.firebasestorage.app",
  messagingSenderId: "868499596875",
  appId: "1:868499596875:web:4bf592934f6086be8a4fce"
};

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
        const res = await axios.get(
            `https://flexieduconsult-ai-link.onrender.com/ai?q=${encodeURIComponent(prompt)}`
        );

        return res.data?.result || "🤖 No response from AI";

    } catch (err) {
        console.log("AI LINK ERROR:", err.message);
        return "⚠️ AI service unavailable.";
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

// --- AUTOMATED WELCOME & GOODBYE ---
sock.ev.on('group-participants.update', async (anu) => {
    const jid = anu.id;
    if (!jid) return;

    // A 1-second delay is still recommended to ensure WhatsApp 
    // has finished delivering the 'join' event metadata to your bot.
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        const metadata = await sock.groupMetadata(jid).catch(() => null);
        const groupName = metadata?.subject || "this group";
        const groupDesc = metadata?.desc?.toString() || "No description provided.";

        for (const num of anu.participants) {
            // Skip if the bot itself joined, to prevent self-greeting loops
            if (num === sock.user.id.split(':')[0] + '@s.whatsapp.net') continue;

            const userTag = num.split('@')[0];

            if (anu.action === 'add') {
                // Immediate automated greeting
                await sock.sendMessage(jid, {
                    text: `👋 @${userTag}\n\n🤖 *Welcome to ${groupName}*\n\n📝 *Group Info:* ${groupDesc}\n\nEnjoy your stay! Powered by *JARVIS AI* 🚀`,
                    mentions: [num]
                });
            } 
            else if (anu.action === 'remove' || anu.action === 'leave') {
                // Immediate automated goodbye
                await sock.sendMessage(jid, {
                    text: `👋 Goodbye @${userTag}\n\nWe're sorry to see you leave *${groupName}*. Best of luck! 🎓`,
                    mentions: [num]
                });
            }
        }
    } catch (err) {
        console.log("Automation Error:", err.message);
    }
});
    

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        activityTracker.set(sender, Date.now()); // Track activity

        // --- ANTI STATUS MENTION SYSTEM ---
try {
    const type = m.messageStubType;

    const isStatusMention =
        type === 'group_mention_notification' ||
        type === 156 ||
        type === 0x9c; // fallback for some Baileys builds

    if (isStatusMention) {
        const participant = m.messageStubParameters?.[0];
        const groupJid = jid;

        if (!participant) return;

        // delete system notification
        await sock.sendMessage(groupJid, {
            delete: m.key
        }).catch(() => {});

        // init warn system safely
        if (!global.db) global.db = { data: { users: {} } };
        if (!global.db.data.users[participant]) {
            global.db.data.users[participant] = { warn: 0 };
        }

        global.db.data.users[participant].warn += 1;
        const warnCount = global.db.data.users[participant].warn;
        const maxWarns = 3;

        const msg =
`*⚠️ JARVIS AI SAFETY SYSTEM ⚠️*\n\n@${participant.split('@')[0]}, tagging this group in status is not allowed.\n\n*Strike:* ${warnCount}/${maxWarns}`;

        await sock.sendMessage(groupJid, {
            text: msg,
            mentions: [participant]
        });

        if (warnCount >= maxWarns) {
            await sock.sendMessage(groupJid, {
                text: `🚫 Final strike reached. Removing user...`
            });

            await sock.groupParticipantsUpdate(groupJid, [participant], "remove");
        }

        return;
    }
} catch (err) {
    console.log("Anti-status error:", err.message);
}

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

        // --- PUBLIC COMMANDS (Everyone can use these) ---
        if (command === "!timetable") {
            const timetableUrl = 'https://firebasestorage.googleapis.com/v0/b/jarvisai-1a594.firebasestorage.app/o/20243.jpg?alt=media';
            try {
                const response = await axios.get(timetableUrl, { responseType: 'arraybuffer' });
                await sock.sendMessage(jid, { 
                    image: Buffer.from(response.data), 
                    caption: `🗓️ *POST UTME TUTORIALS 2025/2026*\n\n` +
                             `✅ *Starts:* 11th July\n` +
                             `💰 *Fee:* ₦6,000 monthly\n\n` +
                             `_Powered by ${POWERED_BY}_`
                });
            } catch (err) {
                console.log("Timetable Error:", err.message);
            }
               }

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

// --- TIMED MUTE/UNMUTE LOGIC ---
if (command === "!mute" || command === "!unmute") {
    const duration = args[0]; 
    const unit = args[1]?.toLowerCase();
    const action = command === "!mute" ? 'announcement' : 'not_announcement';
    const statusText = command === "!mute" ? "🔒 *Group Locked*" : "🔓 *Group Unlocked*";

    // 1. NORMAL ACTION (No time provided)
    if (!duration || isNaN(duration)) {
        await sock.groupSettingUpdate(jid, action);
        return sock.sendMessage(jid, { text: `${statusText}.` });
    }

    // 2. TIMED ACTION
    let milliseconds;
    switch (unit) {
        case 'sec': case 's': milliseconds = duration * 1000; break;
        case 'min': case 'm': milliseconds = duration * 60 * 1000; break;
        case 'hr':  case 'h': milliseconds = duration * 60 * 60 * 1000; break;
        default:
            return sock.sendMessage(jid, { text: `❌ Use: ${command} [number] [sec/min/hr]` });
    }

    // Perform initial action
    await sock.groupSettingUpdate(jid, action);
    await sock.sendMessage(jid, { 
        text: `${statusText} for ${duration} ${unit}.\nJARVIS will reverse this automatically.` 
    });

    // Schedule the reversal
    setTimeout(async () => {
        const reverseAction = action === 'announcement' ? 'not_announcement' : 'announcement';
        const reverseText = action === 'announcement' ? "🔓 *Time is up! Group Unlocked.*" : "🔒 *Time is up! Group Locked.*";
        
        await sock.groupSettingUpdate(jid, reverseAction);
        await sock.sendMessage(jid, { text: reverseText });
    }, milliseconds);
}


            // --- ADD USER COMMAND ---
if (command === "!add") {
    let target = args[0];
    if (!target) return sock.sendMessage(jid, { text: "❌ Oya, provide the number. Example: !add 08012345678" });

    // Clean and format for Nigeria (234)
    target = target.replace(/[^0-9]/g, '');
    if (target.startsWith('0')) {
        target = '234' + target.substring(1);
    }
    
    const targetJid = target + "@s.whatsapp.net";

    try {
        const response = await sock.groupParticipantsUpdate(jid, [targetJid], "add");
        
        // Baileys returns an array of results for each participant
        const result = response[0];

        if (result.status === "200") {
            return sock.sendMessage(jid, { 
                text: `✅ Added @${target} to the group.`, 
                mentions: [targetJid] 
            });
        } else if (result.status === "403") {
            return sock.sendMessage(jid, { 
                text: "⚠️ Privacy Settings: I've sent an invite link to their DM instead." 
            });
        } else if (result.status === "409") {
            return sock.sendMessage(jid, { text: "ℹ️ This person is already in the group!" });
        } else {
            return sock.sendMessage(jid, { text: "❌ Failed. The number might be invalid or not on WhatsApp." });
        }
    } catch (err) {
        console.log("Add Command Error:", err);
        return sock.sendMessage(jid, { text: "❌ Error: Am I an admin? Also check my connection." });
    }
}

// --- MENU / HELP COMMAND ---
if (command === "!menu" || command === "!help") {
    const menuText = `🤖 *${BOT_NAME} SYSTEM MENU*
    
*Powered by ${POWERED_BY}*

━━━━━━━━━━━━━━━━━━━━
✨ *AI & UTILITY*
🔹 *!ai [query]* - Ask anything
🔹 *!ginfo* - Group status report
🔹 *!listonline* - Activity tracker
🔹 *!timetable* - Get latest tutorial schedule
🛡️ *GROUP MODERATION*
🔸 *!add [number]* - Add new member
🔸 *!kick @user* - Remove member
🔸 *!promote @user* - Make admin
🔸 *!mute [time] [unit]* - Lock group
🔸 *!unmute [time] [unit]* - Open group
🔸 *!reset @user* - Clear warnings

🚫 *SYSTEM PROTECTIONS*
✅ *Watchdog:* Anti-Link & Anti-Badword
✅ *Anti-Status:* Deletes status tags
✅ *Auto-Greet:* Welcome/Goodbye
━━━━━━━━━━━━━━━━━━━━

_Type !mute 30 min to test the timer!_`;

    return sock.sendMessage(jid, { 
        text: menuText,
        quoted: m 
    });
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

// --- WEB DASHBOARD ROUTES ---

const FB_SCRIPTS = `
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
    <script>
        const firebaseConfig = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(firebaseConfig);
    </script>
`;

app.get('/login', (req, res) => {
    res.send(`<html><head><title>Login</title><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body{font-family:sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;} 
        .card{background:white;padding:30px;border-radius:15px;width:90%;max-width:400px;box-shadow:0 10px 25px rgba(0,0,0,0.1); box-sizing: border-box;} 
        header{background:#002b5c;color:white;padding:15px;text-align:center;margin:-30px -30px 20px -30px;border-radius:15px 15px 0 0;} 
        input{width:100%;padding:12px;margin:8px 0;border:1px solid #ddd;border-radius:8px;box-sizing: border-box;} 
        button{width:100%;padding:12px;background:#002b5c;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;}
        
        /* Added Styles for Google Button */
        .google-btn { background: #ffffff; color: #757575; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 15px; }
        .divider { margin: 20px 0; border-top: 1px solid #eee; position: relative; text-align: center; }
        .divider span { position: absolute; top: -10px; left: 42%; background: white; padding: 0 10px; font-size: 12px; color: #aaa; }
    </style>
    </head><body>
    <div class="card">
        <header>LOGIN</header>
        <input id="email" type="email" placeholder="Email Address">
        <input id="pass" type="password" placeholder="Password">
        <button onclick="login()">Login</button>

        <!-- Keep these INSIDE the card div -->
        <div class="divider"><span>OR</span></div>
        <button class="google-btn" onclick="loginWithGoogle()">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18"> 
            Sign in with Google
        </button>

        <p style="text-align:center;font-size:12px;margin-top:15px;">Don't have an account? <a href="/signup">Sign up</a></p>
    </div>

    ${FB_SCRIPTS}
    <script>
        function login(){
            const e = document.getElementById('email').value; 
            const p = document.getElementById('pass').value;
            firebase.auth().signInWithEmailAndPassword(e, p).then(u => {
                localStorage.setItem('userName', u.user.displayName || 'Admin');
                window.location.href = '/';
            }).catch(err => alert(err.message));
        }

        function loginWithGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            firebase.auth().signInWithPopup(provider).then((result) => {
                localStorage.setItem('userName', result.user.displayName);
                window.location.href = '/';
            }).catch((error) => {
                alert("Google Error: " + error.message);
            });
        }
    </script></body></html>`);
});


app.get('/signup', (req, res) => {
    res.send(`<html><head><title>Sign Up</title><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body{font-family:sans-serif;background:#f0f2f5;display:flex;justify:center;align-items:center;height:100vh;margin:0;} .card{background:white;padding:30px;border-radius:15px;width:90%;max-width:400px;box-shadow:0 10px 25px rgba(0,0,0,0.1);} header{background:#002b5c;color:white;padding:15px;text-align:center;margin:-30px -30px 20px -30px;border-radius:15px 15px 0 0;} input{width:100%;padding:12px;margin:8px 0;border:1px solid #ddd;border-radius:8px;} button{width:100%;padding:12px;background:#002b5c;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;}</style>
    </head><body><div class="card"><header>CREATE AN ACCOUNT WITH JARVIS AI</header><input id="name" type="text" placeholder="Full Name"><input id="email" type="email" placeholder="Email"><input id="pass" type="password" placeholder="Password"><input id="confirm" type="password" placeholder="Confirm Password"><button onclick="signup()">Create an Account</button></div>
    ${FB_SCRIPTS}
    <script>
        function signup(){
            const n = document.getElementById('name').value; const e = document.getElementById('email').value; const p = document.getElementById('pass').value;
            if(p !== document.getElementById('confirm').value) return alert("Passwords don't match");
            firebase.auth().createUserWithEmailAndPassword(e, p).then(u => {
                u.user.updateProfile({displayName: n}).then(() => {
                    alert('✅ Account created successfully');
                    window.location.href = '/login';
                });
            }).catch(err => alert(err.message));
        }
    </script></body></html>`);
});

app.get('/', (req, res) => {
    res.send(`<html><head><title>Dashboard</title><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body{margin:0;font-family:sans-serif;background:#f4f7f9;} header{background:#002b5c;color:white;padding:20px;text-align:center;} .container{padding:20px;max-width:800px;margin:auto;} .welcome{font-size:24px;color:#002b5c;margin-bottom:20px;font-weight:bold;} .card{background:white;padding:20px;border-radius:12px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,0.05);} .btn{display:block;text-align:center;padding:15px;background:#003f88;color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:10px;}</style>
    </head><body><header>🤖 JARVIS AI PORTAL</header><div class="container"><div class="welcome" id="greet">Welcome back!</div>
    <div class="card"><h3>📡 Connection Status</h3><p id="linked">Linked Number: Not Set</p><input id="num" placeholder="234..." style="padding:10px;width:60%;"><button onclick="getPair()" style="padding:10px;background:#002b5c;color:white;border:none;">Pair</button><div id="code" style="font-size:22px;margin-top:10px;color:#003f88;font-weight:bold;">-- -- -- --</div></div>
    <div class="card"><h3>🚀 Quick Actions</h3><a href="/chat" class="btn">💬 Chat with JARVIS AI</a></div>
    <div class="card"><h3>🛠️ System Features</h3><ul><li>Anti-Link</li><li>Anti-Badword</li><li>Timed Mute</li></ul></div>
    </div><script>
        const u = localStorage.getItem('userName'); if(!u) window.location.href = '/login';
        document.getElementById('greet').innerText = "Welcome back, " + u + "!";
        async function getPair(){
            const n = document.getElementById('num').value;
            const res = await fetch('/pair?number=' + n);
            document.getElementById('code').innerText = await res.text();
            document.getElementById('linked').innerText = "Linked Number: +" + n;
        }
    </script></body></html>`);
});

app.get('/chat', (req, res) => {
    res.send(`<html><head><title>Chat</title><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body{margin:0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh;} header{background:#002b5c;color:white;padding:15px;text-align:center;} #box{flex:1;background:#e5ddd5;padding:20px;overflow-y:auto;} .inp{padding:20px;background:white;display:flex;gap:10px;} input{flex:1;padding:12px;border-radius:20px;border:1px solid #ddd;}</style>
    </head><body><header>💬 JARVIS CHAT</header><div id="box"><p style="background:white;padding:10px;border-radius:8px;display:inline-block;">Hello Admin! Ready to manage Flexi Digital Academy?</p></div>
    <div class="inp"><input id="msg" placeholder="Type to JARVIS..."><button onclick="alert('Sent to Bot!')" style="border-radius:20px;padding:0 20px;background:#002b5c;color:white;border:none;">Send</button></div>
    <script>if(!localStorage.getItem('userName')) window.location.href = '/login';</script></body></html>`);
});

app.get('/pair', async (req, res) => {
    const num = req.query.number?.replace(/[^0-9]/g, '');
    if (!sock) return res.send("Bot starting...");
    try { res.send(await sock.requestPairingCode(num)); } catch { res.send("Error"); }
});

app.listen(port, () => startJARVIS());
