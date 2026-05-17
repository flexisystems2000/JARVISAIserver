const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

require('dotenv').config();
const quizEngine = require('./quizEngine');
const grammarWatchdog = require('./grammarWatchdog');
const paymentHandler = require('./paymentHandler'); // 👈 ADD THIS LINE HERE

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
const WarnSchema = new mongoose.Schema({
    userId: String,
    count: { type: Number, default: 0 }
});

const ConfigSchema = new mongoose.Schema({
    keyName: String,
    keyValue: String
});

const Warn = mongoose.model('Warn', WarnSchema);
const Config = mongoose.model('Config', ConfigSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err.message));


// --- AI FUNCTION ---
async function askAI(prompt, base64Media = null, isPDF = false) {
    try {
        const endpoint = isPDF ? 'pdf' : 'ai';

        const payload = {
            prompt,
            ...(isPDF ? { fileBase64: base64Media } : { image: base64Media })
        };

        const res = await axios.post(
            `https://flexieduconsult-ai-link.onrender.com/${endpoint}`,
            payload
        );

        return res.data?.result || "🤖 No response from AI";
    } catch (err) {
        console.log("AI LINK ERROR:", err.message);
        return "⚠️ AI service unavailable.";
    }
}


// --- GLOBAL STATE ---
const groupCache = new Map();
const activityTracker = new Map();

let protocolFired = false;

// FIX: safer midnight reset (WAT)
setInterval(() => {
    const hour = new Date().toLocaleString("en-US", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        hour12: false
    });

    if (hour === "00") {
        protocolFired = false;
        console.log("🔄 Protocol reset (Nigeria Midnight)");
    }
}, 60000);


// --- MEDIA DOWNLOADER ---
async function downloadMedia(message) {
    const type = Object.keys(message)[0];
    const stream = await downloadContentFromMessage(
        message[type],
        type.replace('Message', '')
    );

    let buffer = Buffer.from([]);

    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    return buffer;
}

let sock;


// --- BOT START ---
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
            const shouldReconnect =
                (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) startJARVIS();

        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Online & Synced`);
        }
    });

    // --- GROUP WELCOME / GOODBYE ---
    sock.ev.on('group-participants.update', async (anu) => {
        const jid = anu.id;
        if (!jid) return;

        await new Promise(r => setTimeout(r, 1500));

        try {
            let metadata = groupCache.get(jid);

            if (!metadata) {
                metadata = await sock.groupMetadata(jid)
                    .catch(() => ({ subject: "this group" }));
            }

            const groupName = metadata.subject;

            for (const num of anu.participants) {
                if (num === sock.user.id.split(':')[0] + '@s.whatsapp.net') continue;

                const userTag = num.split('@')[0];

                if (anu.action === 'add') {
                    await sock.sendMessage(jid, {
                        text:
`👋 @${userTag}

🤖 *Welcome to ${groupName}*

Success in your Post-UTME starts here.

_Powered by ${POWERED_BY}_ 🚀`,
                        mentions: [num]
                    });

                } else if (anu.action === 'remove') {
                    await sock.sendMessage(jid, {
                        text:
`👋 Goodbye @${userTag}

We wish you success ahead from *${groupName}* 🎓`,
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

    activityTracker.set(sender, Date.now());

    // =========================
    // ANTI STATUS MENTION SYSTEM (FIXED SAFETY)
    // =========================
    try {
        const type = m.messageStubType || m.message?.messageStubType;

        const isStatusMention =
            type === 'group_mention_notification' ||
            type === 156 ||
            type === 0x9c;

        if (isStatusMention) {
            const participant = m.messageStubParameters?.[0];
            const groupJid = jid;

            if (!participant) return;

            await sock.sendMessage(groupJid, {
                delete: m.key
            }).catch(() => {});

            if (!global.db) global.db = { data: { users: {} } };
            if (!global.db.data.users[participant]) {
                global.db.data.users[participant] = { warn: 0 };
            }

            global.db.data.users[participant].warn += 1;

            const warnCount = global.db.data.users[participant].warn;
            const maxWarns = 3;

            const msg =
`*⚠️ JARVIS AI SAFETY SYSTEM ⚠️*

@${participant.split('@')[0]}, tagging this group in status is not allowed.

*Strike:* ${warnCount}/${maxWarns}`;

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

    // =========================
    // MESSAGE PARSING (FIXED SAFETY)
    // =========================
    const body =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption ||
        "";

        const text = body.toLowerCase().trim();
    const isOwner = sender.includes(OWNER_NUMBER);

    // 🌟 LIVE QUIZ INTERCEPTOR 🌟
    // Intercepts and grades students' choice inputs on Saturday nights
    const wasQuizMessage = await quizEngine.handleLiveMarking(sock, jid, sender, body, m);
    if (wasQuizMessage) return;
        
    if (text.includes("jarvis") && !text.startsWith("!")) {
        await sock.sendMessage(jid, {
            react: { key: m.key, text: "🤖" }
        });
    }

    // 🕵️‍♂️ AUTOMATED GRAMMAR MONITOR (Modular Interceptor)
    // Runs in the background to automatically correct bad grammar structures
    if (!m.key.fromMe && body) {
        const correctedVersion = await grammarWatchdog.autoCorrectGrammar(body);
        
        if (correctedVersion && correctedVersion.trim().toLowerCase() !== body.trim().toLowerCase()) {
            const userTag = sender.split('@')[0];
            const alertPayload = 
                `📝 *Grammar Check Alert* 📝\n\n` +
                `@${userTag}, I noticed a minor slip in your structure. Here is the corrected version:\n\n` +
                `👉 *"${correctedVersion}"*`;

            await sock.sendMessage(jid, { 
                text: alertPayload, 
                mentions: [sender] 
            }, { quoted: m });
        }
    }
        

    // =========================
    // GROUP METADATA / STAFF CHECK (FIXED)
    // =========================
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

            const admins =
                (metadata.participants || [])
                    .filter(p => p.admin)
                    .map(p => p.id);

            isStaff = isOwner || admins.includes(sender);

        } catch (err) {
            isStaff = isOwner;
        }
    }

    // =========================
    // WATCHDOG (FIXED SAFETY + LOWER FALSE POSITIVES)
    // =========================
    if (jid.endsWith('@g.us') && !isStaff) {

        const badWords = [
            "rubbish", "mumu", "foolish",
            "stupid", "bastard", "ode"
        ];

        const isLink =
            text.includes("http") ||
            text.includes(".com") ||
            text.includes("chat.whatsapp");

        const isBadWord = badWords.some(word => text.includes(word));

        if (isLink || isBadWord) {
            await sock.sendMessage(jid, { delete: m.key }).catch(() => {});

            let userWarn = await Warn.findOneAndUpdate(
                { userId: sender },
                { $inc: { count: 1 } },
                { upsert: true, new: true }
            );

            if (userWarn.count >= 3) {
                await sock.sendMessage(jid, {
                    text: `🚫 @${sender.split('@')[0]} removed (3 Strikes).`,
                    mentions: [sender]
                });

                await sock.groupParticipantsUpdate(jid, [sender], "remove");
                await Warn.deleteOne({ userId: sender });

            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ *Watchdog*\n@${sender.split('@')[0]}, violation detected (${userWarn.count}/3).`,
                    mentions: [sender]
                });
            }

            return;
        }
    }

    const command = text.split(/ +/)[0];
    const args = body.trim().split(/ +/).slice(1);

    // =========================
    // FILE / AI SYSTEM (FIXED IMAGE + DOC HANDLING)
    // =========================
    if (
        jid.endsWith('@g.us') &&
        (text.startsWith("!ai") || text.includes("jarvis"))
    ) {

        const isDoc = !!m.message.documentMessage;

        const isImg =
            !!m.message.imageMessage ||
            !!m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

        // =========================
        // FILE ANALYSIS MODE
        // =========================
        if (isDoc || isImg) {
            await sock.sendMessage(jid, {
                react: { key: m.key, text: "📂" }
            });

            await sock.sendPresenceUpdate('composing', jid);

            try {
                let mediaMessage;

                if (isDoc) {
                    mediaMessage = m.message.documentMessage;
                } else {
                    mediaMessage =
                        m.message.imageMessage
                            ? m.message
                            : m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                }

                const buffer = await downloadMedia(mediaMessage);
                const base64Media = buffer.toString('base64');

                const fileName = isDoc
                    ? m.message.documentMessage.fileName
                    : "Image Analysis";

                const aiReply = await askAI(
                    body || `Please analyze this file: ${fileName}`,
                    base64Media
                );

                return sock.sendMessage(jid, {
                    text: `🎓 *GROUP STUDY ASSISTANT*\n\n${aiReply}`
                }, { quoted: m });

            } catch (err) {
                console.log("File Error:", err.message);
                return sock.sendMessage(jid, {
                    text: "⚠️ I couldn't read that file. Ensure it's a PDF or Image."
                });
            }
        }
    }


// B. Creating Files (Generating Notes/PDFs)
if (
    text.includes("create file") ||
    text.includes("generate pdf") ||
    text.includes("write note")
) {
    await sock.sendMessage(jid, { react: { key: m.key, text: "📝" } });
    await sock.sendPresenceUpdate('composing', jid);

    const contentPrompt = `Create a detailed, professional study document based on this request: ${text}. Format it clearly for students.`;
    const content = await askAI(contentPrompt);

    const fileBuffer = Buffer.from(content, 'utf-8');

    const cleanName =
        text.split("file")[1]?.trim()?.replace(/ /g, "_") ||
        "JARVIS_Study_Note";

    return sock.sendMessage(
        jid,
        {
            document: fileBuffer,
            mimetype: 'text/plain',
            fileName: `${cleanName}.txt`,
            caption: `✅ *JARVIS Document Generator*\n\nStudy notes generated successfully.`
        },
        { quoted: m }
    );
}

    
// --- NEW: askAI NIGERIA PROTOCOL (7 PM WAT) ---
const nigeriaTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: 'numeric',
    hour12: false
}).format(new Date());

const currentHourWAT = parseInt(nigeriaTime);

// FIX: prevent undefined crash
if (isStaff && !isNaN(currentHourWAT)) {

    if (currentHourWAT >= 19 && !protocolFired && !text.startsWith("!")) {
        const subjects = ["math", "physics", "chemistry", "biology", "english", "economics", "government"];
        const foundSubject = subjects.find(s => text.includes(s));

        if (foundSubject) {
            const adminTag = `@${sender.split('@')[0]}`;

            await sock.sendMessage(jid, {
                text:
`================
*askAI PROTOCOL ONLINE*
================
${adminTag} Kindly use !ai to fetch PostUTME questions for ${foundSubject.toUpperCase()}`,
                mentions: [sender]
            });

            protocolFired = true;
        }
    }
}

    
// --- PUBLIC COMMAND: TIMETABLE ---
if (command === "!timetable") {
    try {
        const timetableUrl = 'https://i.postimg.cc/vTyBtTzS/IMG-20260511-WA0031.jpg';

        const response = await axios.get(timetableUrl, {
            responseType: 'arraybuffer'
        });

        await sock.sendMessage(jid, {
            image: Buffer.from(response.data),
            caption:
                `🗓️ *POST UTME TUTORIALS 2025/2026*\n\n` +
                `✅ *Starts:* 11th July\n` +
                `💰 *Fee:* ₦6,000 monthly\n\n` +
                `📢 Join WhatsApp group:\n` +
                `https://chat.whatsapp.com/KoI4QtlwggOFtGyoE0MYY4\n\n` +
                `_Powered by ${POWERED_BY}_`
        });

    } catch (err) {
        console.log("Timetable Error:", err.message);

        await sock.sendMessage(jid, {
            text: "❌ Failed to load timetable image."
        });
    }
}


        
    // --- LIST ADMINS COMMAND (Everyone can use) ---
if (command === "!listadmins") {
    if (!jid.endsWith('@g.us')) {
        return sock.sendMessage(jid, {
            text: "❌ This command only works in groups."
        });
    }

    try {
        let metadata = groupCache.get(jid);

        if (!metadata || Date.now() - (metadata.lastFetch || 0) > 300000) {
            metadata = await sock.groupMetadata(jid);
            metadata.lastFetch = Date.now();
            groupCache.set(jid, metadata);
        }

        const admins = metadata.participants.filter(p => p.admin);

        let adminList = `👑 *${metadata.subject} Admins*\n\n`;

        admins.forEach((admin, index) => {
            adminList += `${index + 1}. @${admin.id.split('@')[0]}\n`;
        });

        adminList += `\n🤖 _Powered by ${POWERED_BY}_`;

        await sock.sendMessage(jid, {
            text: adminList,
            mentions: admins.map(a => a.id)
        });

    } catch (err) {
        console.log("ListAdmins Error:", err.message);

        await sock.sendMessage(jid, {
            text: "❌ Failed to fetch admin list."
        });
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
🔹 *!listadmins* - View group admins
🔹 *!image* - To generate images

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

if (command === "!getjid") {
    return sock.sendMessage(jid, { 
        text: `🎯 This group's JID is:\n\n*${jid}*` 
    }, { quoted: m });
}

// =======================
// AI COMMAND (FIXED SAFE VERSION)
// =======================
if (isStaff && command === "!ai") {
    const prompt = args.join(" ");
    const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const isQuotedImage = quoted?.imageMessage;
    const isDirectImage = m.message.imageMessage;

    if (!prompt && !isDirectImage && !isQuotedImage) {
        return sock.sendMessage(jid, {
            text: "Oya, what is your question? You can also send an image."
        });
    }

    await sock.sendPresenceUpdate('composing', jid);

    let base64Image = null;

    if (isDirectImage || isQuotedImage) {
        await sock.sendMessage(jid, { react: { key: m.key, text: "📸" } });

        const mediaMessage = isDirectImage ? m.message : quoted;

        try {
            const buffer = await downloadMedia(mediaMessage);
            base64Image = buffer.toString('base64');
        } catch (err) {
            console.log("Media Error:", err.message);
        }
    }

    const aiReply = await askAI(
        prompt || "Analyze this image clearly.",
        base64Image
    );

    return sock.sendMessage(jid, {
        text: `🤖 *JARVIS AI*\n\n${aiReply}`
    });
}


// --- WATCHONLINE COMMAND ---
if (command === "!listonline") {
    if (!metadata) return;

    const activeThreshold = 30 * 60 * 1000;
    let activeCount = 0;

    metadata.participants.forEach(p => {
        if (
            activityTracker.has(p.id) &&
            (Date.now() - activityTracker.get(p.id) < activeThreshold)
        ) {
            activeCount++;
        }
    });

    return sock.sendMessage(jid, {
        text: `*📊 ACTIVITY REPORT*\n\n🟢 Active: ${activeCount}\n👻 Ghosts: ${metadata.participants.length - activeCount}`
    });
}


// --- GROUP INFO ---
if (command === "!ginfo") {
    return sock.sendMessage(jid, {
        text: `*📊 ${BOT_NAME} REPORT*\n\nGroup: ${metadata?.subject}\nMembers: ${metadata?.participants?.length}\nPowered by: ${POWERED_BY}`
    });
}


// --- KICK / PROMOTE ---
if (command === "!kick" || command === "!promote") {
    let target =
        m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        m.message.extendedTextMessage?.contextInfo?.participant;

    if (!target && args[0]) {
        target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    }

    if (!target || target.includes(OWNER_NUMBER)) {
        return sock.sendMessage(jid, { text: "❌ Target invalid." });
    }

    const action = command === "!kick" ? "remove" : "promote";

    try {
        await sock.groupParticipantsUpdate(jid, [target], action);

        await sock.sendMessage(jid, {
            text: `✅ Successfully ${action === "remove" ? "removed" : "promoted"}.`
        });

    } catch (err) {
        console.log("Group Action Error:", err.message);
        await sock.sendMessage(jid, {
            text: "❌ Failed. Am I admin?"
        });
    }
}


// --- IMAGE GENERATION ---
if (command === "!image") {
    const prompt = args.join(" ");
    if (!prompt) {
        return sock.sendMessage(jid, {
            text: "❌ Provide a prompt"
        });
    }

    await sock.sendMessage(jid, { react: { key: m.key, text: "🎨" } });

    try {
        const res = await axios.get(
            `https://flexieduconsult-ai-link.onrender.com/image?prompt=${encodeURIComponent(prompt)}`
        );

        if (res.data?.success) {
            await sock.sendMessage(jid, {
                image: { url: res.data.image },
                caption: `🖌️ *JARVIS AI ART*\nPrompt: ${prompt}`
            });
        }
    } catch (err) {
        console.log(err.message);
        await sock.sendMessage(jid, {
            text: "⚠️ Image generation failed"
        });
    }
}


// --- MUTE / UNMUTE ---
if (command === "!mute" || command === "!unmute") {
    const duration = args[0];
    const unit = args[1]?.toLowerCase();

    const action = command === "!mute"
        ? 'announcement'
        : 'not_announcement';

    const statusText = command === "!mute"
        ? "🔒 Group Locked"
        : "🔓 Group Unlocked";

    if (!duration || isNaN(duration)) {
        await sock.groupSettingUpdate(jid, action);
        return sock.sendMessage(jid, { text: statusText });
    }

    let milliseconds;

    switch (unit) {
        case 'sec':
        case 's': milliseconds = duration * 1000; break;

        case 'min':
        case 'm': milliseconds = duration * 60 * 1000; break;

        case 'hr':
        case 'h': milliseconds = duration * 60 * 60 * 1000; break;

        default:
            return sock.sendMessage(jid, {
                text: `❌ Use: ${command} [number] [sec/min/hr]`
            });
    }

    await sock.groupSettingUpdate(jid, action);

    setTimeout(async () => {
        const reverse = action === 'announcement'
            ? 'not_announcement'
            : 'announcement';

        await sock.groupSettingUpdate(jid, reverse);

        await sock.sendMessage(jid, {
            text: "🔄 Auto-reversed group setting"
        });
    }, milliseconds);
}


// --- ADD USER ---
if (command === "!add") {
    let target = args[0];

    if (!target) {
        return sock.sendMessage(jid, {
            text: "❌ Provide number e.g. !add 08012345678"
        });
    }

    target = target.replace(/[^0-9]/g, '');

    if (target.startsWith('0')) {
        target = '234' + target.slice(1);
    }

    const targetJid = target + "@s.whatsapp.net";

    try {
        const response = await sock.groupParticipantsUpdate(
            jid,
            [targetJid],
            "add"
        );

        const result = response?.[0];

        if (result?.status === "200") {
            return sock.sendMessage(jid, {
                text: `✅ Added @${target}`,
                mentions: [targetJid]
            });
        } else if (result?.status === "403") {
            return sock.sendMessage(jid, {
                text: "⚠️ Privacy restriction"
            });
        } else if (result?.status === "409") {
            return sock.sendMessage(jid, {
                text: "ℹ️ Already in group"
            });
        } else {
            return sock.sendMessage(jid, {
                text: "❌ Failed to add user"
            });
        }

    } catch (err) {
        console.log("Add Error:", err.message);
        return sock.sendMessage(jid, {
            text: "❌ Error: Am I admin?"
        });
    }
}


// --- RESET WARN ---
if (command === "!reset") {
    let target =
        m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target) {
        return sock.sendMessage(jid, {
            text: "❌ Tag someone to reset warnings"
        });
    }

    await Warn.deleteOne({ userId: target });

    return sock.sendMessage(jid, {
        text: `✅ Strikes cleared for @${target.split('@')[0]}`,
        mentions: [target]
    });
            }
    });
    // --- WEB DASHBOARD ROUTES ---

const FB_SCRIPTS = `
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
    <script>
        const firebaseConfig = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(firebaseConfig);
    </script>
`;

// ---------------- LOGIN ----------------
app.get('/login', (req, res) => {
    res.send(`
<html>
<head>
<title>Login</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{
    font-family:sans-serif;
    background:#f0f2f5;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
    margin:0;
}
.card{
    background:white;
    padding:30px;
    border-radius:15px;
    width:90%;
    max-width:400px;
    box-shadow:0 10px 25px rgba(0,0,0,0.1);
    box-sizing:border-box;
}
header{
    background:#002b5c;
    color:white;
    padding:15px;
    text-align:center;
    margin:-30px -30px 20px -30px;
    border-radius:15px 15px 0 0;
}
input{
    width:100%;
    padding:12px;
    margin:8px 0;
    border:1px solid #ddd;
    border-radius:8px;
    box-sizing:border-box;
}
button{
    width:100%;
    padding:12px;
    background:#002b5c;
    color:white;
    border:none;
    border-radius:8px;
    cursor:pointer;
    font-weight:bold;
}
.google-btn{
    background:#fff;
    color:#757575;
    border:1px solid #ddd;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:10px;
    margin-top:15px;
}
.divider{
    margin:20px 0;
    border-top:1px solid #eee;
    position:relative;
    text-align:center;
}
.divider span{
    position:absolute;
    top:-10px;
    left:42%;
    background:white;
    padding:0 10px;
    font-size:12px;
    color:#aaa;
}
</style>
</head>
<body>

<div class="card">
<header>LOGIN</header>

<input id="email" type="email" placeholder="Email Address">
<input id="pass" type="password" placeholder="Password">

<button onclick="login()">Login</button>

<div class="divider"><span>OR</span></div>

<button class="google-btn" onclick="loginWithGoogle()">
<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18">
Sign in with Google
</button>

<p style="text-align:center;font-size:12px;margin-top:15px;">
Don't have an account? <a href="/signup">Sign up</a>
</p>
</div>

${FB_SCRIPTS}

<script>
function login(){
    const e = document.getElementById('email').value;
    const p = document.getElementById('pass').value;

    firebase.auth().signInWithEmailAndPassword(e,p)
    .then(u=>{
        localStorage.setItem('userName', u.user.displayName || 'Admin');
        window.location.href='/';
    })
    .catch(err=>alert(err.message));
}

function loginWithGoogle(){
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
    .then(result=>{
        localStorage.setItem('userName', result.user.displayName);
        window.location.href='/';
    })
    .catch(err=>alert("Google Error: "+err.message));
}
</script>

</body>
</html>
`);
});


// ---------------- SIGNUP ----------------
app.get('/signup', (req, res) => {
    res.send(`
<html>
<head>
<title>Sign Up</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{
    font-family:sans-serif;
    background:#f0f2f5;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
    margin:0;
}
.card{
    background:white;
    padding:30px;
    border-radius:15px;
    width:90%;
    max-width:400px;
    box-shadow:0 10px 25px rgba(0,0,0,0.1);
}
header{
    background:#002b5c;
    color:white;
    padding:15px;
    text-align:center;
    margin:-30px -30px 20px -30px;
    border-radius:15px 15px 0 0;
}
input{
    width:100%;
    padding:12px;
    margin:8px 0;
    border:1px solid #ddd;
    border-radius:8px;
}
button{
    width:100%;
    padding:12px;
    background:#002b5c;
    color:white;
    border:none;
    border-radius:8px;
    cursor:pointer;
}
</style>
</head>
<body>

<div class="card">
<header>CREATE ACCOUNT</header>

<input id="name" placeholder="Full Name">
<input id="email" type="email" placeholder="Email">
<input id="pass" type="password" placeholder="Password">
<input id="confirm" type="password" placeholder="Confirm Password">

<button onclick="signup()">Create Account</button>
</div>

${FB_SCRIPTS}

<script>
function signup(){
    const n=document.getElementById('name').value;
    const e=document.getElementById('email').value;
    const p=document.getElementById('pass').value;

    if(p !== document.getElementById('confirm').value){
        return alert("Passwords don't match");
    }

    firebase.auth().createUserWithEmailAndPassword(e,p)
    .then(u=>{
        u.user.updateProfile({displayName:n}).then(()=>{
            alert("Account created");
            window.location.href="/login";
        });
    })
    .catch(err=>alert(err.message));
}
</script>

</body>
</html>
`);
});


// ---------------- DASHBOARD ----------------
app.get('/', (req, res) => {
    res.send(`
<html>
<head>
<title>Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{margin:0;font-family:sans-serif;background:#f4f7f9;}
header{background:#002b5c;color:white;padding:20px;text-align:center;}
.container{padding:20px;max-width:800px;margin:auto;}
.welcome{font-size:24px;color:#002b5c;margin-bottom:20px;font-weight:bold;}
.card{background:white;padding:20px;border-radius:12px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,0.05);}
.btn{display:block;text-align:center;padding:15px;background:#003f88;color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:10px;}
</style>
</head>
<body>

<header>🤖 JARVIS AI PORTAL</header>

<div class="container">
<div class="welcome" id="greet">Welcome</div>

<div class="card">
<h3>Connection Status</h3>
<p id="linked">Linked Number: Not Set</p>

<input id="num" placeholder="234..." style="padding:10px;width:60%;">
<button onclick="getPair()">Pair</button>

<div id="code" style="font-size:22px;margin-top:10px;color:#003f88;font-weight:bold;">-- -- -- --</div>
</div>

<div class="card">
<h3>Quick Actions</h3>
<a href="/chat" class="btn">Chat with JARVIS</a>
</div>

</div>

<script>
const u = localStorage.getItem('userName');
if(!u) window.location.href='/login';

document.getElementById('greet').innerText = "Welcome back, " + u;

async function getPair(){
    const n=document.getElementById('num').value;
    const res=await fetch('/pair?number='+n);
    document.getElementById('code').innerText=await res.text();
    document.getElementById('linked').innerText="Linked: +"+n;
}
</script>

</body>
</html>
`);
});


// ---------------- CHAT ----------------
app.get('/chat', (req, res) => {
    res.send(`
<html>
<head>
<title>Chat</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{margin:0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh;}
header{background:#002b5c;color:white;padding:15px;text-align:center;}
#box{flex:1;background:#e5ddd5;padding:20px;overflow-y:auto;}
.inp{padding:20px;background:white;display:flex;gap:10px;}
input{flex:1;padding:12px;border-radius:20px;border:1px solid #ddd;}
</style>
</head>
<body>

<header>JARVIS CHAT</header>

<div id="box">
<p style="background:white;padding:10px;border-radius:8px;display:inline-block;">
Hello Admin
</p>
</div>

<div class="inp">
<input placeholder="Type...">
<button>Send</button>
</div>

<script>
if(!localStorage.getItem('userName')) window.location.href='/login';
</script>

</body>
</html>
`);
});    
// ... (rest of your code above)

// ---------------- PAIR ----------------
app.get('/pair', async (req, res) => {
    const num = req.query.number?.replace(/[^0-9]/g,'');
    if(!sock) return res.send("Bot starting...");

    try{
        const code = await sock.requestPairingCode(num);
        res.send(code);
    }catch(e){
        res.send("Error generating code");
    }
});

// 🌟🌟🌟 PASTE THE WEBHOOK ROUTE BLOCK DIRECTLY HERE 🌟🌟🌟
app.post('/webhook/trigger-quiz', express.json(), async (req, res) => {
    try {
        const { subject, quizText, answers } = req.body;
        
        if (!subject || !answers) {
            return res.status(400).json({ success: false, error: "Incomplete quiz data payload" });
        }

        const trigger = await quizEngine.fireQuiz(sock, { subject, quizText, answers });
        
        if (trigger.success) {
            res.json({ success: true, message: "Quiz pushed to group successfully" });
        } else {
            res.status(500).json({ success: false, error: trigger.error });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


} // <-- This is the absolute final curly bracket of your startJARVIS function

// ---------------- START ----------------
app.listen(port, () => {
   console.log(`Server running on ${port}`);
   startJARVIS();
});
