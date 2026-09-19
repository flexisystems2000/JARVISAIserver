const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    downloadContentFromMessage,
    areJidsSameUser
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

require('dotenv').config();
const quizEngine = require('./quizEngine');
const grammarWatchdog = require('./grammarWatchdog');
const paymentHandler = require('./paymentHandler'); // 👈 ADD THIS LINE HERE

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
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

// --- VIEW-ONCE RETRIEVER FUNCTION ---
async function vvCommand(sock, from, msg) {
    const loadEmojis = ['⏳', '🔓', '👁️'];
    for (const emoji of loadEmojis) {
        await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
    }

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) {
        return await sock.sendMessage(from, { text: "❌ Please reply to a View-Once message." }, { quoted: msg });
    }

    const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension; 
    const message = viewOnce ? viewOnce.message : quoted; 
    let vType = Object.keys(message)[0]; 

    if (['imageMessage', 'videoMessage', 'audioMessage'].includes(vType)) { 
        try { 
            const stream = await downloadContentFromMessage(message[vType], vType.replace('Message', '')); 
            let buffer = Buffer.from([]); 
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]); 

            if (vType === 'imageMessage') {
                await sock.sendMessage(from, { image: buffer, caption: "✅ View-Once Image Downloaded" }, { quoted: msg }); 
            } else if (vType === 'videoMessage') { 
                await sock.sendMessage(from, { video: buffer, caption: "✅ View-Once Video Downloaded" }, { quoted: msg }); 
            } else if (vType === 'audioMessage') { 
                await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4' }, { quoted: msg }); 
            } 
        } catch (e) { 
            console.log("VV Error:", e.message);
            await sock.sendMessage(from, { text: "❌ Failed to download View-Once media." }, { quoted: msg }); 
        } 
    } else { 
        await sock.sendMessage(from, { text: "❌ Not a View-Once media message." }, { quoted: msg }); 
    } 
}


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

// ============================================================
// 💬 JARVIS DASHBOARD CHAT STORAGE
// ------------------------------------------------------------
// Lightweight JSON storage for WhatsApp group conversations.
// This is independent of the existing MongoDB warning/config
// system.
// ============================================================

const CHAT_DATA_DIR = path.join(__dirname, 'data');
const CHAT_DATA_FILE = path.join(CHAT_DATA_DIR, 'chats.json');

function ensureChatStorage() {
    try {
        if (!fs.existsSync(CHAT_DATA_DIR)) {
            fs.mkdirSync(CHAT_DATA_DIR, { recursive: true });
        }

        if (!fs.existsSync(CHAT_DATA_FILE)) {
            fs.writeFileSync(
                CHAT_DATA_FILE,
                JSON.stringify({}, null, 2),
                'utf8'
            );
        }
    } catch (err) {
        console.log("❌ Chat storage initialization error:", err.message);
    }
}

ensureChatStorage();

function loadChatData() {
    try {
        ensureChatStorage();

        const raw = fs.readFileSync(
            CHAT_DATA_FILE,
            'utf8'
        );

        if (!raw.trim()) return {};

        return JSON.parse(raw);
    } catch (err) {
        console.log("❌ Chat JSON read error:", err.message);
        return {};
    }
}

function saveChatData(data) {
    try {
        ensureChatStorage();

        fs.writeFileSync(
            CHAT_DATA_FILE,
            JSON.stringify(data, null, 2),
            'utf8'
        );

        return true;
    } catch (err) {
        console.log("❌ Chat JSON write error:", err.message);
        return false;
    }
}


// ============================================================
// 💬 SAVE DASHBOARD CHAT MESSAGE
// ============================================================

function saveDashboardMessage({
    groupJid,
    messageId = '',
    senderJid = '',
    senderName = '',
    text = '',
    direction = 'incoming',
    timestamp = Date.now()
}) {

    if (!groupJid || !text) {
        return null;
    }

    if (!groupJid.endsWith('@g.us')) {
        return null;
    }

    const data = loadChatData();

    if (!data[groupJid]) {
        data[groupJid] = [];
    }

    // Prevent duplicate messages
    if (
        messageId &&
        data[groupJid].some(
            message => message.messageId === messageId
        )
    ) {
        return data[groupJid].find(
            message => message.messageId === messageId
        );
    }

    const message = {
        groupJid,
        messageId:
            messageId ||
            `${direction}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)}`,

        senderJid,
        senderName,
        text,
        direction,
        timestamp: new Date(timestamp).toISOString()
    };

    data[groupJid].push(message);

    // Keep the JSON file reasonably sized.
    // The dashboard keeps the latest 500 messages per group.
    if (data[groupJid].length > 500) {
        data[groupJid] =
            data[groupJid].slice(-500);
    }

    saveChatData(data);

    return message;
}

// =========================
// JARVIS TYPING SIMULATION
// =========================
async function sendWithTyping(
    jid,
    message,
    quotedMessage = null
) {

    try {

        await sock.sendPresenceUpdate(
            'composing',
            jid
        );

        const textLength =
            message?.text?.length || 0;

        const typingDelay =
            Math.min(
                Math.max(
                    800,
                    textLength * 12
                ),
                5000
            );

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    typingDelay
                )
        );


        const result =
            await sock.sendMessage(
                jid,
                message,
                quotedMessage
                    ? {
                        quoted:
                            quotedMessage
                    }
                    : undefined
            );


        // ========================================================
        // 💬 DASHBOARD — SAVE JARVIS OUTGOING TEXT
        // ========================================================

        if (
            jid &&
            jid.endsWith('@g.us') &&
            message?.text
        ) {

            saveDashboardMessage({

                groupJid:
                    jid,

                messageId:
                    result?.key?.id || '',

                senderJid:
                    sock.user?.id || '',

                senderName:
                    sock.user?.name ||
                    'JARVIS AI',

                text:
                    message.text,

                direction:
                    'outgoing',

                timestamp:
                    Date.now()
            });
        }


        return result;

    } finally {

        await sock.sendPresenceUpdate(
            'paused',
            jid
        ).catch(() => {});
    }
}


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
    
       // ============================================================
// 💬 DASHBOARD — SAVE INCOMING GROUP MESSAGE
// ============================================================

if (
    jid &&
    jid.endsWith('@g.us')
) {

    const incomingText =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        m.message?.documentMessage?.caption ||
        '';

    if (incomingText.trim()) {

        let senderName =
            sender?.split('@')[0] ||
            'Unknown';

        try {

            const metadata =
                groupCache.get(jid);

            const participant =
                metadata?.participants?.find(
                    p =>
                        p.id === sender
                );

            if (participant?.notify) {
                senderName =
                    participant.notify;
            }

        } catch (_) {}

        saveDashboardMessage({

            groupJid:
                jid,

            messageId:
                m.key.id,

            senderJid:
                sender,

            senderName:
                senderName,

            text:
                incomingText.trim(),

            direction:
                'incoming',

            timestamp:
                m.messageTimestamp
                    ? Number(
                        m.messageTimestamp
                    ) * 1000
                    : Date.now()
        });
    }
}

       // ==========================================
    // JARVIS ONLINE STATUS CHECK
    // ==========================================
    const rawMsgCheck = m.message.conversation || m.message.extendedTextMessage?.text || "";
    const msgLower = rawMsgCheck.toLowerCase().trim();

    const isOnlineQuery = 
        (msgLower.includes("jarvis") && msgLower.includes("online")) ||
        (msgLower.includes("jarvis") && msgLower.includes("there")) ||
        msgLower.includes("@jarvis") || 
        msgLower === "jarvis status";

    if (isOnlineQuery) {
        const jarvisOnlineResponses = [
            "Systems are fully operational and online, sir.",
            "All diagnostics green. I am completely at your service.",
            "Online and monitoring all secure channels.",
            "Network protocols active. Standing by for your command.",
            "Affirmative. I'm online and running at peak efficiency."
        ];
        
        const randomIndex = Math.floor(Math.random() * jarvisOnlineResponses.length);
        const replyText = jarvisOnlineResponses[randomIndex];

        await sendWithTyping(jid, { text: replyText }, m);
        return;
    }

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

                const result = await sock.groupParticipantsUpdate(
    jid,
    [target],
    action
);

console.log(
    "GROUP ACTION RESULT:",
    JSON.stringify(result, null, 2)
);
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
     
    // ============================================================
// 🧠 JARVIS AI — PHASE 4 MEDIA INTELLIGENCE
// Images • Documents • PDFs • Videos • Audio • View Once
// Admin/Owner-only View Once Preservation
// ============================================================

const rawMessage = m.message || {};


// ============================================================
// UNWRAP EPHEMERAL / VIEW-ONCE MEDIA
// ============================================================

let mediaMessage = rawMessage;
let isViewOnce = false;

// Ephemeral message
if (mediaMessage.ephemeralMessage?.message) {
    mediaMessage = mediaMessage.ephemeralMessage.message;
}

// View Once v1
if (mediaMessage.viewOnceMessage?.message) {
    isViewOnce = true;
    mediaMessage = mediaMessage.viewOnceMessage.message;
}

// View Once v2
if (mediaMessage.viewOnceMessageV2?.message) {
    isViewOnce = true;
    mediaMessage = mediaMessage.viewOnceMessageV2.message;
}

// View Once v2 Extension
if (mediaMessage.viewOnceMessageV2Extension?.message) {
    isViewOnce = true;
    mediaMessage = mediaMessage.viewOnceMessageV2Extension.message;
}


// ============================================================
// DETECT MEDIA TYPES
// ============================================================

const imageMessage =
    mediaMessage.imageMessage || null;

const videoMessage =
    mediaMessage.videoMessage || null;

const documentMessage =
    mediaMessage.documentMessage || null;

const audioMessage =
    mediaMessage.audioMessage || null;

const hasImage =
    !!imageMessage;

const hasVideo =
    !!videoMessage;

const hasDocument =
    !!documentMessage;

const hasAudio =
    !!audioMessage;


// ============================================================
// MEDIA CAPTION
// ============================================================

const mediaCaption =
    imageMessage?.caption ||
    videoMessage?.caption ||
    documentMessage?.caption ||
    "";


// ============================================================
// NATURAL MEDIA 
// ============================================================

const mediaRequestWords = [
    "analyze",
    "analyse",
    "explain",
    "describe",
    "read",
    "solve",
    "answer",
    "summarize",
    "summarise",
    "what is",
    "what's",
    "what are",
    "identify",
    "look at",
    "check",
    "study",
    "interpret",
    "calculate",
    "translate"
];

const hasExplicitMedia =
    mediaRequestWords.some(word =>
        text.includes(word)
    ) ||
    text.startsWith("!ai") ||
    (
        text.includes("jarvis") &&
        (
            hasImage ||
            hasVideo ||
            hasDocument ||
            hasAudio
        )
    );


// ============================================================
// 👑 VIEW-ONCE PRESERVATION 
// ============================================================

const preserveViewOnceWords = [
    "save this view once",
    "save this view-once",
    "save view once",
    "save view-once",

    "download this view once",
    "download this view-once",
    "download view once",
    "download view-once",

    "keep this view once",
    "keep this view-once",

    "preserve this view once",
    "preserve this view-once",
    "preserve view once",
    "preserve view-once",

    "send this view once",
    "send this view-once",

    "resend this view once",
    "resend this view-once"
];

const wantsViewOncePreservation =
    isViewOnce &&
    preserveViewOnceWords.some(word =>
        text.includes(word)
    );


// ============================================================
// 👑 CHECK GROUP ADMIN STATUS
// ============================================================

let requesterIsGroupAdmin = false;

if (wantsViewOncePreservation) {

    try {

        // Bot owner is always authorized.
        if (isOwner) {
            requesterIsGroupAdmin = true;
        }

        // Check WhatsApp group admin status.
        if (!requesterIsGroupAdmin) {

            const groupMetadata =
                await sock.groupMetadata(jid);

            const participant =
                groupMetadata.participants.find(
                    p => p.id === sender
                );

            requesterIsGroupAdmin =
                participant?.admin === "admin" ||
                participant?.admin === "superadmin";
        }

    } catch (err) {

        console.log(
            "View Once Admin Check Error:",
            err.message
        );
    }
}


// ============================================================
// 🔒 NON-ADMIN VIEW-ONCE PRESERVATION ATTEMPT
// ============================================================

if (
    wantsViewOncePreservation &&
    !requesterIsGroupAdmin
) {

    await sendWithTyping(
        jid,
        {
            text:
`🔒 *VIEW ONCE PRESERVATION*

Only a group admin or JARVIS owner can ask me to preserve and resend View Once media.`
        },
        m
    );

    return;
}


// ============================================================
// 📥 ADMIN/OWNER VIEW-ONCE PRESERVATION
// ============================================================

if (
    wantsViewOncePreservation &&
    requesterIsGroupAdmin
) {

    try {

        await sock.sendPresenceUpdate(
            "composing",
            jid
        );


        // ====================================================
        // 🖼️ VIEW-ONCE IMAGE
        // ====================================================

        if (hasImage) {

            const imageBuffer =
                await downloadMedia({
                    imageMessage: imageMessage
                });

            await sendWithTyping(
                jid,
                {
                    image: imageBuffer,
                    caption:
`📌 *VIEW ONCE PRESERVED*

Preserved by JARVIS at the request of a group admin.`
                },
                m
            );

            console.log(
                `👑 View Once image preserved by admin: ${sender}`
            );

            return;
        }


        // ====================================================
        // 🎥 VIEW-ONCE VIDEO
        // ====================================================

        if (hasVideo) {

            const videoBuffer =
                await downloadMedia({
                    videoMessage: videoMessage
                });

            await sendWithTyping(
                jid,
                {
                    video: videoBuffer,
                    caption:
`📌 *VIEW ONCE PRESERVED*

Preserved by JARVIS at the request of a group admin.`
                },
                m
            );

            console.log(
                `👑 View Once video preserved by admin: ${sender}`
            );

            return;
        }


        // ====================================================
        // 📄 VIEW-ONCE DOCUMENT
        // ====================================================

        if (hasDocument) {

            const documentBuffer =
                await downloadMedia({
                    documentMessage: documentMessage
                });

            await sendWithTyping(
                jid,
                {
                    document: documentBuffer,
                    mimetype:
                        documentMessage.mimetype ||
                        "application/octet-stream",
                    fileName:
                        documentMessage.fileName ||
                        "view-once-file",
                    caption:
`📌 *VIEW ONCE PRESERVED*

Preserved by JARVIS at the request of a group admin.`
                },
                m
            );

            console.log(
                `👑 View Once document preserved by admin: ${sender}`
            );

            return;
        }


        // ====================================================
        // ⚠️ UNSUPPORTED VIEW-ONCE TYPE
        // ====================================================

        await sendWithTyping(
            jid,
            {
                text:
                    "⚠️ I detected the View Once media, but I don't currently support preserving this media type."
            },
            m
        );

        return;

    } catch (err) {

        console.log(
            "View Once Preservation Error:",
            err.message
        );

        await sock.sendMessage(jid, {
            text:
                "⚠️ I couldn't preserve that View Once media."
        });

        return;
    }
}


// ============================================================
// 👀 VIEW-ONCE DETECTION
// ============================================================

if (
    isViewOnce &&
    (
        hasImage ||
        hasVideo ||
        hasDocument
    )
) {

    console.log(
        `👀 View Once media detected from ${sender}`
    );

    if (!hasExplicitMedia) {

        await sendWithTyping(
            jid,
            {
                text:
`👀 *VIEW ONCE MEDIA DETECTED*

You can ask me to analyze it.

A group admin can also ask me to preserve it with:

• "Jarvis, save this view once"
• "Jarvis, preserve this view once"`
            },
            m
        );

        return;
    }
}


// ============================================================
// 🖼️ IMAGE INTELLIGENCE
// ============================================================

if (
    hasImage &&
    hasExplicitMedia
) {

    try {

        await sock.sendPresenceUpdate(
            "composing",
            jid
        );

        const imageBuffer =
            await downloadMedia({
                imageMessage: imageMessage
            });

        const imageBase64 =
            imageBuffer.toString("base64");

        const prompt =
            mediaCaption ||
            body ||
            "Analyze this image carefully and explain what you see.";

        const result =
            await askAI(
                prompt,
                imageBase64,
                false
            );

        await sendWithTyping(
            jid,
            {
                text:
`🖼️ *JARVIS AI — IMAGE ANALYSIS*

${result}`
            },
            m
        );

        return;

    } catch (err) {

        console.log(
            "Image Intelligence Error:",
            err.message
        );

        await sock.sendMessage(jid, {
            text:
                "⚠️ I couldn't process that image right now."
        });

        return;
    }
}


// ============================================================
// 📄 DOCUMENT / PDF INTELLIGENCE
// ============================================================

if (
    hasDocument &&
    hasExplicitMedia
) {

    try {

        await sock.sendPresenceUpdate(
            "composing",
            jid
        );

        const document =
            documentMessage;

        const mimeType =
            document.mimetype || "";

        const fileName =
            document.fileName || "";

        const isPDF =
            mimeType.toLowerCase() ===
                "application/pdf" ||
            fileName
                .toLowerCase()
                .endsWith(".pdf");

        const documentBuffer =
            await downloadMedia({
                documentMessage: document
            });

        const documentBase64 =
            documentBuffer.toString("base64");

        const prompt =
            mediaCaption ||
            body ||
            (
                isPDF
                    ? "Read this PDF carefully and explain its contents."
                    : "Read this document carefully and explain its contents."
            );

        const result =
            await askAI(
                prompt,
                documentBase64,
                isPDF
            );

        await sendWithTyping(
            jid,
            {
                text:
`${isPDF ? "📄" : "📁"} *JARVIS AI — DOCUMENT ANALYSIS*

${result}`
            },
            m
        );

        return;

    } catch (err) {

        console.log(
            "Document Intelligence Error:",
            err.message
        );

        await sock.sendMessage(jid, {
            text:
                "⚠️ I couldn't read that document right now."
        });

        return;
    }
}


// ============================================================
// 🎥 VIDEO INTELLIGENCE
// ============================================================

if (
    hasVideo &&
    hasExplicitMedia
) {

    try {

        await sock.sendPresenceUpdate(
            "composing",
            jid
        );

        const video =
            videoMessage;

        const duration =
            Number(video.seconds || 0);

        // Prevent very large videos from being downloaded.
        if (duration > 180) {

            await sendWithTyping(
                jid,
                {
                    text:
`🎥 *VIDEO RECEIVED*

This video is longer than 3 minutes, so I won't download the entire file automatically.

Please send a shorter clip or extract the important part.`
                },
                m
            );

            return;
        }

        const videoBuffer =
            await downloadMedia({
                videoMessage: video
            });

        const videoBase64 =
            videoBuffer.toString("base64");

        const prompt =
            mediaCaption ||
            body ||
            "Analyze this video and explain what is happening.";

        const result =
            await askAI(
                prompt,
                videoBase64,
                false
            );

        await sendWithTyping(
            jid,
            {
                text:
`🎥 *JARVIS AI — VIDEO ANALYSIS*

${result}`
            },
            m
        );

        return;

    } catch (err) {

        console.log(
            "Video Intelligence Error:",
            err.message
        );

        await sock.sendMessage(jid, {
            text:
                "⚠️ I couldn't process that video right now."
        });

        return;
    }
}


// ============================================================
// 🎵 AUDIO NOTICE
// ============================================================

if (
    hasAudio &&
    hasExplicitMedia
) {

    await sendWithTyping(
        jid,
        {
            text:
`🎵 *AUDIO RECEIVED*

I can detect the audio, but audio transcription and analysis are not enabled yet.

🎙️ Audio intelligence will be added in a later phase.`
        },
        m
    );

    return;
}


// ============================================================
// 📦 MEDIA WITHOUT EXPLICIT REQUEST
// ============================================================

// Do not automatically analyze ordinary media.
// The existing bot can continue processing normally.

if (
    (
        hasImage ||
        hasVideo ||
        hasDocument ||
        hasAudio
    ) &&
    !hasExplicitMedia
) {
    // ionally do nothing.
    // This prevents JARVIS from consuming
    // every media message automatically.
}

    // 🌟 LIVE QUIZ INTERCEPTOR 🌟
    // Intercepts and grades students' choice inputs on Saturday nights
    const wasQuizMessage = await quizEngine.handleLiveMarking(sock, jid, sender, body, m);
    if (wasQuizMessage) return;
        
    // =========================
// CONTEXT-AWARE REACTION SYSTEM
// =========================
// JARVIS reacts ONLY when the user explicitly asks for a reaction.
// Mentioning "Jarvis" by itself will NOT trigger a reaction.

const reactionWords = [
    "react",
    "reaction",
    "react to this",
    "react to that",
    "react with",
    "give a reaction",
    "drop a reaction"
];

const hasReaction = reactionWords.some(word =>
    text.includes(word)
);

if (hasReaction) {
    const reactionMap = {
        "😂": "😂",
        "🤣": "🤣",
        "😭": "😭",
        "❤️": "❤️",
        "❤": "❤️",
        "😍": "😍",
        "😘": "😘",
        "😎": "😎",
        "😢": "😢",
        "😡": "😡",
        "😮": "😮",
        "😱": "😱",
        "👏": "👏",
        "👍": "👍",
        "👎": "👎",
        "🔥": "🔥",
        "💯": "💯",
        "🙏": "🙏",
        "🤔": "🤔",
        "😅": "😅",
        "🥰": "🥰",
        "❤️‍🔥": "❤️‍🔥",
        "💔": "💔",
        "🤍": "🤍",
        "💀": "💀",
        "🙄": "🙄",
        "😏": "😏",
        "🤩": "🤩",
        "😆": "😆",
        "😉": "😉",
        "🫡": "🫡"
    };

    let selectedReaction = null;

    for (const emoji of Object.keys(reactionMap)) {
        if (text.includes(emoji)) {
            selectedReaction = reactionMap[emoji];
            break;
        }
    }

    // Default reaction if the user asks for a reaction
    // but doesn't specify an emoji.
    if (!selectedReaction) {
        selectedReaction = "😂";
    }

    await sock.sendMessage(jid, {
        react: {
            key: m.key,
            text: selectedReaction
        }
    });

    return;
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
// GROUP METADATA / STAFF CHECK (REAL-TIME REFRESH FIX)
// =========================
let metadata;
let isStaff = isOwner;

if (jid.endsWith('@g.us')) {
    try {
        metadata = groupCache.get(jid);

        // Always fetch fresh metadata if cache is older than 5 mins, 
        // OR force an immediate re-fetch if someone attempts an administrative action
        const isTryingAdminAction = ["!kick", "!promote", "!mute", "!unmute", "!reset", "!add"].includes(command);

        if (!metadata || Date.now() - (metadata.lastFetch || 0) > 300000 || isTryingAdminAction) {
            metadata = await sock.groupMetadata(jid);
            metadata.lastFetch = Date.now();
            groupCache.set(jid, metadata);
        }

        const admins = (metadata.participants || [])
    .filter(p => p.admin)
    .map(p => p.id)
    .filter(Boolean);

isStaff =
    isOwner ||
    admins.some(adminJid => areJidsSameUser(adminJid, sender));

    } catch (err) {
    console.log("❌ STAFF CHECK ERROR:", err.message);
    isStaff = isOwner;
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

    let command = text.split(/ +/)[0];
const args = body.trim().split(/ +/).slice(1);

// =========================
// NATURAL-LANGUAGE  SYSTEM
// PHASE 3 — ALL COMMANDS
// =========================

let natural = null;
let naturalText = text.trim();

// Never override existing !commands
if (!naturalText.startsWith("!")) {

    // Allow:
// "Jarvis, who are the admins?"
// "Jarvis show me the menu"
// "Jarvis add 08012345678"
    naturalText = naturalText
        .replace(/^jarvis[\s,:-]*/i, "")
        .trim();

        const Patterns = [

        // =========================
        // MENU / HELP
        // =========================
        {
            name: "menu",
            patterns: [
                /^show (me )?(the )?menu\??$/i,
                /^open (the )?menu\??$/i,
                /^what can you do\??$/i,
                /^what can jarvis do\??$/i,
                /^what are your commands\??$/i,
                /^show me your commands\??$/i,
                /^help me\??$/i,
                /^give me (your )?commands\??$/i
            ]
        },

        // =========================
        // TIMETABLE
        // =========================
        {
            name: "timetable", // 👈 Fixed
            patterns: [
                /^show (me )?(the )?timetable\??$/i,
                /^send (me )?(the )?timetable\??$/i,
                /^what is (the )?timetable\??$/i,
                /^show timetable\??$/i,
                /^send timetable\??$/i,
                /^tutorial timetable\??$/i
            ]
        },

        // =========================
        // ADMINS
        // =========================
        {
            name: "listadmins", // 👈 Fixed
            patterns: [
                /^who (are|is) (the )?admins?\??$/i,
                /^who are the group admins\??$/i,
                /^show (me )?(the )?admins?\??$/i,
                /^show (me )?(the )?group admins?\??$/i,
                /^list (the )?admins?\??$/i,
                /^list (the )?group admins?\??$/i
            ]
        },

        // =========================
        // ONLINE MEMBERS
        // =========================
        {
            name: "listonline", // 👈 Fixed
            patterns: [
                /^who is online\??$/i,
                /^who's online\??$/i,
                /^who are online\??$/i,
                /^show (me )?(the )?online members?\??$/i,
                /^show (me )?who is online\??$/i,
                /^show (me )?who's online\??$/i,
                /^who is active\??$/i,
                /^show active members\??$/i
            ]
        },

        // =========================
        // GROUP INFO
        // =========================
        {
            name: "ginfo", // 👈 Fixed
            patterns: [
                /^show (me )?(the )?group info\??$/i,
                /^show (me )?(the )?group information\??$/i,
                /^what is this group\??$/i,
                /^tell me about this group\??$/i,
                /^group info\??$/i,
                /^group information\??$/i
            ]
        },

        // =========================
        // GROUP JID
        // =========================
        {
            name: "getjid", // 👈 Fixed
            patterns: [
                /^what is (this )?group'?s? id\??$/i,
                /^show (me )?(this )?group id\??$/i,
                /^give me (this )?group id\??$/i,
                /^what is (this )?group jid\??$/i,
                /^show (me )?(this )?group jid\??$/i
            ]
        },

        // =========================
        // IMAGE GENERATION
        // =========================
        {
            name: "image", // 👈 Fixed
            patterns: [
                /^generate an image (of )?.+/i,
                /^generate image (of )?.+/i,
                /^create an image (of )?.+/i,
                /^create image (of )?.+/i,
                /^make an image (of )?.+/i,
                /^make image (of )?.+/i,
                /^draw (me )?.+/i,
                /^create a picture (of )?.+/i,
                /^generate a picture (of )?.+/i
            ]
        },

        // =========================
        // PAYMENT
        // =========================
        {
            name: "pay", // 👈 Fixed
            patterns: [
                /^i want to pay.*$/i,
                /^i want to make payment.*$/i,
                /^make payment.*$/i,
                /^make a payment.*$/i,
                /^how do i pay.*$/i,
                /^how can i pay.*$/i,
                /^i want to subscribe.*$/i,
                /^i want a subscription.*$/i,
                /^pay for (the )?tutorial.*$/i,
                /^pay (weekly|monthly|week|month)$/i
            ]
        },

        // =========================
        // PROFILE / NAME
        // =========================
        {
            name: "name", // 👈 Fixed
            patterns: [
                /^my name is .+/i,
                /^call me .+/i,
                /^save my name as .+/i,
                /^register my name .+/i,
                /^my full name is .+/i
            ]
        },

        // =========================
        // KICK
        // =========================
        {
            name: "kick", // 👈 Fixed
            patterns: [
                /^kick .+/i,
                /^remove .+/i,
                /^remove (this )?person .+/i,
                /^kick (this )?person .+/i,
                /^kick (him|her|them)$/i,
                /^remove (him|her|them)$/i,
                /^kick this (guy|person|member)$/i,
                /^remove this (guy|person|member)$/i,
                /^get .+ out of the group$/i
            ]
        },

        // =========================
        // PROMOTE
        // =========================
        {
            name: "promote", // 👈 Fixed
            patterns: [
                /^promote .+/i,
                /^make .+ admin$/i,
                /^make .+ an admin$/i,
                /^give .+ admin$/i,
                /^give .+ admin rights$/i,
                /^make (him|her|them) admin$/i,
                /^promote (him|her|them)$/i,
                /^make this (guy|person|member) admin$/i
            ]
        },

        // =========================
        // ADD MEMBER
        // =========================
        {
            name: "add", // 👈 Fixed
            patterns: [
                /^add \+?\d+/i,
                /^add 0\d+/i,
                /^add \d+ to (the )?group$/i,
                /^add .+ to (the )?group$/i,
                /^invite \+?\d+/i,
                /^invite .+ to (the )?group$/i
            ]
        },

        // =========================
        // 🔒 MUTE / LOCK GROUP
        // =========================
        {
            name: "mute", // 👈 Fixed
            patterns: [
                /^mute (the )?group$/i,
                /^lock (the )?group$/i,
                /^close (the )?group$/i,
                /^lock this group$/i,
                /^close this group$/i,
                /^mute this group$/i,
                /^lock our group$/i,
                /^close our group$/i,
                /^make (the )?group admin only$/i,
                /^make this group admin only$/i,
                /^make (the )?group admins only$/i,
                /^make (the )?group admins? only$/i,
                /^set (the )?group to admin only$/i,
                /^set this group to admin only$/i,
                /^stop members from chatting$/i,
                /^stop everyone from chatting$/i,
                /^stop people from chatting$/i,
                /^prevent members from chatting$/i,
                /^prevent everyone from chatting$/i,
                /^don't let members chat$/i,
                /^do not let members chat$/i,
                /^restrict (the )?group$/i,
                /^restrict this group$/i,
                /^disable member messages$/i,
                /^disable members from chatting$/i,
                /^turn off member messaging$/i,
                /^lock (the )?group for \d+/i,
                /^mute (the )?group for \d+/i,
                /^close (the )?group for \d+/i
            ]
        },

        // =========================
        // 🔓 UNMUTE / UNLOCK GROUP
        // =========================
        {
            name: "unmute", // 👈 Fixed
            patterns: [
                /^unmute (the )?group$/i,
                /^unlock (the )?group$/i,
                /^open (the )?group$/i,
                /^unlock this group$/i,
                /^open this group$/i,
                /^unmute this group$/i,
                /^unlock our group$/i,
                /^open our group$/i,
                /^allow members to chat$/i,
                /^allow everyone to chat$/i,
                /^let everyone chat$/i,
                /^let members chat$/i,
                /^let people chat$/i,
                /^allow people to chat$/i,
                /^restore member messaging$/i,
                /^enable member messages$/i,
                /^enable members to chat$/i,
                /^turn on member messaging$/i,
                /^remove admin only$/i,
                /^make the group open$/i,
                /^make this group open$/i,
                /^open (the )?group again$/i,
                /^unlock (the )?group again$/i,
                /^let everyone chat again$/i
            ]
        },

        // =========================
        // VIEW ONCE / VV
        // =========================
        {
            name: "vv",
            patterns: [
                /^save (this )?view[- ]?once\??$/i,
                /^download (this )?view[- ]?once\??$/i,
                /^open (this )?view[- ]?once\??$/i,
                /^reveal (this )?view[- ]?once\??$/i,
                /^show (me )?(this )?view[- ]?once\??$/i,
                /^fetch (this )?view[- ]?once\??$/i,
                /^vv$/i
            ]
        },

        // =========================
        // RESET WARNINGS
        // =========================
        {
            name: "reset", // 👈 Fixed
            patterns: [
                /^reset .+ warnings?$/i,
                /^clear .+ warnings?$/i,
                /^remove .+ warnings?$/i,
                /^clear the warnings? for .+/i,
                /^reset the warnings? for .+/i,
                /^remove the strikes? for .+/i,
                /^clear the strikes? for .+/i,
                /^reset (his|her|their) warnings?$/i,
                /^clear (his|her|their) warnings?$/i,
                /^remove (his|her|their) warnings?$/i,
                /^reset (his|her|their) strikes?$/i,
                /^clear (his|her|their) strikes?$/i,
                /^remove (his|her|their) strikes?$/i
            ]
        },

        // =========================
        // DICTIONARY
        // =========================
        {
            name: "define",
            patterns: [
                /^define\s+.+$/i,
                /^define\s+/i,
                /^dictionary\s+.+$/i,
                /^dictionary\s+/i,
                /^what does .+ mean/i,
                /^what is .+ mean/i,
                  /^what is .+/i,
                 /^what are .+/i,
                /^tell me what .+ means/i,
                /^explain the word .+/i,
                /^give me the meaning of .+/i,
                /^define the word .+/i,
                /^lookup .+/i,
                /^look up .+/i,
                /^meaning of .+/i,
                /^define (a|the|an)\s+/i,
                /^jarvis\s+define\s+.+$/i,
                /^jarvis\s+dictionary\s+.+$/i,
                /^what does jarvis\s+mean/i,
                 /^explain .+/i,
                /^define the word jarvis/i
            ]
        },

        // =========================
        // AI
        // =========================
        {
            name: "ai", // 👈 Fixed from just colon
            patterns: [
                /^ask (jarvis )?(.+)/i,
 
                /^tell me about .+/i,
                /^who is .+/i,
                /^why is .+/i,
                /^why are .+/i,
                /^how do .+/i,
                /^how does .+/i,
                /^how can .+/i,
                /^solve .+/i,
                /^answer this .+/i,
                /^help me with .+/i
            ]
        },
        // =========================
        // CREATE FILE / NOTE / PDF
        // =========================
        {
            name: "createfile", // 👈 Fixed
            patterns: [
                /^create (a )?file .+/i,
                /^create (a )?document .+/i,
                /^generate (a )?pdf .+/i,
                /^make (a )?pdf .+/i,
                /^write (a )?note .+/i,
                /^create (a )?study note .+/i,
                /^generate (a )?study note .+/i,
                /^make (a )?study note .+/i
            ]
        }
    ];


    for (const item of Patterns) {
        if (item.patterns.some(pattern => pattern.test(naturalText))) {
            natural = item.name;
            break;
        }
    }
}


// =========================
// NATURAL LANGUAGE → COMMAND
// =========================

if (natural) {

        const naturalCommandMap = {
        menu: "!menu",
        ai: "!ai",
        timetable: "!timetable",
        listadmins: "!listadmins",
        listonline: "!listonline",
        ginfo: "!ginfo",
        getjid: "!getjid",
        image: "!image",
        pay: "!pay",
        name: "!name",
        kick: "!kick",
        promote: "!promote",
        add: "!add",
        mute: "!mute",
        unmute: "!unmute",
        reset: "!reset",
        createfile: "__createfile__", // 👈 Added missing comma here
        define: "!define",              // 👈 Properly mapped dictionary command
        vv: "!vv"
    };


    command = naturalCommandMap[natural];

    console.log(
        `🧠 Natural : ${natural} → ${command}`
    );


    // =========================
    // NATURAL ARGUMENT EXTRACTION
    // =========================

    if (natural === "ai") {

        let prompt = naturalText
            .replace(/^ask\s+(jarvis\s+)?/i, "")
            .trim();

        if (!prompt) {
            prompt = naturalText;
        }

        args.splice(0, args.length, ...prompt.split(/\s+/));
    }

// =========================
// 📖 DICTIONARY ARGUMENT EXTRACTION
// =========================
if (natural === "define") {

    let word = naturalText
        .replace(/^define\s+/i, "")
        .replace(/^dictionary\s+/i, "")
        .replace(/^what does\s+/i, "")
        .replace(/\s+mean\??$/i, "")
        .replace(/^tell me what\s+/i, "")
        .replace(/\s+means\??$/i, "")
        .replace(/^explain the word\s+/i, "")
        .replace(/^give me the meaning of\s+/i, "")
        .replace(/^define the word\s+/i, "")
        .replace(/^lookup\s+/i, "")
        .replace(/^look up\s+/i, "")
        .replace(/^meaning of\s+/i, "")
        .replace(/^what is\s+/i, "")
        .replace(/^what are\s+/i, "")
        .replace(/[?.!]+$/g, "")
        .trim();

    args.splice(
        0,
        args.length,
        word
    );

    console.log(`📖 Dictionary Word: ${word}`);
}

    if (natural === "image") {

        let prompt = naturalText
            .replace(
                /^(generate|create|make)\s+(an?\s+)?image\s*(of\s+)?/i,
                ""
            )
            .replace(
                /^(generate|create|make)\s+(an?\s+)?picture\s*(of\s+)?/i,
                ""
            )
            .replace(/^draw\s+(me\s+)?/i, "")
            .trim();

        args.splice(0, args.length, ...prompt.split(/\s+/));
    }


    if (natural === "pay") {

        if (
            /weekly|week/i.test(naturalText)
        ) {
            args.splice(0, args.length, "week");
        } else {
            args.splice(0, args.length, "month");
        }
    }


    if (natural === "name") {

        let name = naturalText
            .replace(/^my full name is\s+/i, "")
            .replace(/^my name is\s+/i, "")
            .replace(/^call me\s+/i, "")
            .replace(/^save my name as\s+/i, "")
            .replace(/^register my name\s+/i, "")
            .trim();

        args.splice(0, args.length, ...name.split(/\s+/));

        // Make the existing !name handler recognize it
        body = `!name ${name}`;
        text = body.toLowerCase();
    }


    if (natural === "add") {

        const numberMatch =
            naturalText.match(/\+?\d[\d\s-]{6,}/);

        if (numberMatch) {

            const number =
                numberMatch[0].replace(/\D/g, "");

            args.splice(
                0,
                args.length,
                number
            );
        }
    }


    // ============================================================
    // 🧠 PHASE 5B — CONTEXT-AWARE TARGET RESOLVER
    // ============================================================

    const contextInfo =
        m.message.extendedTextMessage?.contextInfo ||
        m.message.imageMessage?.contextInfo ||
        m.message.videoMessage?.contextInfo ||
        m.message.documentMessage?.contextInfo ||
        m.message.audioMessage?.contextInfo ||
        {};

    const mentionedTarget =
        contextInfo.mentionedJid?.[0] || null;

    const repliedParticipant =
        contextInfo.participant || null;

    const quotedMessage =
        contextInfo.quotedMessage || null;


    // ------------------------------------------------------------
    // Determine who the command is referring to
    // Priority:
    // 1. Explicit @mention
    // 2. Person whose message was replied to
    // ------------------------------------------------------------

    const contextTarget =
        mentionedTarget ||
        repliedParticipant ||
        null;


    // ------------------------------------------------------------
    // Commands that operate on another group member
    // ------------------------------------------------------------

    if (
        natural === "kick" ||
        natural === "promote" ||
        natural === "reset"
    ) {

        if (contextTarget) {

            args.splice(
                0,
                args.length,
                contextTarget
            );

            console.log(
                `🧠 Context Target: ${contextTarget}`
            );

        } else {

            console.log(
                "🧠 No contextual target found."
            );
        }
    }


    // ============================================================
    // 🔒 PHASE 5A — MUTE / UNMUTE DURATION EXTRACTION
    // ============================================================

    if (
        natural === "mute" ||
        natural === "unmute"
    ) {

        const durationMatch =
            naturalText.match(
                /(\d+)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)/i
            );

        if (durationMatch) {

            const number =
                durationMatch[1];

            let unit =
                durationMatch[2].toLowerCase();

            if (
                unit.startsWith("sec")
            ) {
                unit = "sec";

            } else if (
                unit.startsWith("min")
            ) {
                unit = "min";

            } else if (
                unit.startsWith("hr") ||
                unit.startsWith("hour")
            ) {
                unit = "hr";
            }

            args.splice(
                0,
                args.length,
                number,
                unit
            );
        }
    }
}

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

                return sendWithTyping(
    jid,
    {
        text: `🎓 *GROUP STUDY ASSISTANT*\n\n${aiReply}`
    },
    m
);

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

// --- PUBLIC COMMAND: DICTIONARY ---
if (command === "!define" || command === "!dictionary" || natural === "define") {

    const word = args.join(" ")
        .toLowerCase()
        .replace(/[^a-z'-]/g, "")
        .trim();

    if (!word) {
        return sendWithTyping(jid, {
            text: "Sure — which word would you like me to explain?"
        }, m);
    }

    await sock.sendMessage(jid, {
        react: {
            key: m.key,
            text: "📖"
        }
    });

    // ==========================================
    // PRIMARY DICTIONARY API
    // ==========================================
    try {

        console.log(`📖 Looking up: ${word}`);

        const response = await axios.get(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
            {
                timeout: 8000
            }
        );

        const data = response.data?.[0];

        if (data) {

            const phonetic =
                data.phonetic ||
                data.phonetics?.find(p => p.text)?.text ||
                "";

            const meaning =
                data.meanings?.[0];

            const partOfSpeech =
                meaning?.partOfSpeech || "";

            const definition =
                meaning?.definitions?.[0]?.definition || "";

            const example =
                meaning?.definitions?.[0]?.example || "";

            if (definition) {

                let reply =
                    `*${data.word || word}*`;

                if (phonetic) {
                    reply += ` ${phonetic}`;
                }

                if (partOfSpeech) {
                    reply += `\n_${partOfSpeech}_`;
                }

                reply += `\n\n${definition}`;

                if (example) {
                    reply += `\n\nFor example: "${example}"`;
                }

                return sendWithTyping(jid, {
                    text: reply
                }, m);
            }
        }

    } catch (err) {

        console.log(
            `⚠️ Dictionary API failed: ${err.response?.status || err.message}`
        );
    }


    // ==========================================
    // DATAMUSE FALLBACK
    // ==========================================
    try {

        console.log(`🔄 Trying dictionary fallback: ${word}`);

        const fallback = await axios.get(
            `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`,
            {
                timeout: 8000
            }
        );

        const result = fallback.data?.[0];

        if (result?.defs?.length) {

            const definition =
                result.defs[0].replace(/^[a-z]+\t/i, "");

            return sendWithTyping(jid, {
                text:
                    `*${word}*\n\n${definition}`
            }, m);
        }

    } catch (err) {

        console.log(
            `⚠️ Dictionary fallback failed: ${err.response?.status || err.message}`
        );
    }


    // ==========================================
    // FINAL RESPONSE
    // ==========================================
    return sendWithTyping(jid, {
        text:
            `I couldn't find a clear definition for *${word}* right now. ` +
            `Please check the spelling and try again.`
    }, m);
}

   // --- COMMAND: VIEW ONCE RETRIEVER (!vv) ---
if (command === "!vv" || text === "vv" || text === "save view once") {
    await vvCommand(sock, jid, m);
    return;
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

                // =====================================================
        // COMMAND: TUTORIAL PAYMENT PORTAL (!pay)
        // =====================================================
        if (command === "!pay") {
            // Silently processes and routes the response straight to the student's DM
            await paymentHandler.handlePaymentRequest(sock, m, sender, args);
            return;
        }

 // ===============================
// PROFILE REGISTRATION COMMAND
// ===============================

// Firebase
const admin = require("firebase-admin");

// Initialize Firebase ONLY ONCE
if (!admin.apps.length) {

    const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT
    );

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log("✅ Firebase Connected");
}

// Firestore Database Instance
const db = admin.firestore();

// ===============================
// PHONE NORMALIZER
// ===============================

function normalizePhone(input = "") {

    return input
        .toString()
        .replace(/\D/g, '')
        .replace(/^0/, '234');
}

// ===============================
// !NAME COMMAND
// Example:
// !name FLEXI SYSTEMS
// ===============================

if (body.startsWith("!name ")) {

    try {

        // Extract full name
        const suppliedName = body
            .replace("!name ", "")
            .trim();

        // Validate supplied name
        if (
            !suppliedName ||
            suppliedName.length < 2
        ) {

            await sock.sendMessage(sender, {

                text:
`⚠️ INVALID NAME

Please enter a valid name.

Example:
!name FLEXI SYSTEMS`

            });

            return;
        }

        // Normalize phone number
        const phone =
            normalizePhone(sender);

        console.log(
            "📌 Saving profile for:",
            phone
        );

        // Save profile to Firestore
        await db
            .collection("users")
            .doc(phone)
            .set({

                name: suppliedName,

                phone: phone,

                updatedAt:
                    Date.now(),

                createdAt:
                    Date.now()

            }, { merge: true });

        console.log(
            "✅ Profile saved for:",
            phone
        );

        // Success message
        await sock.sendMessage(sender, {

            text:
`✅ PROFILE REGISTERED SUCCESSFULLY 🎓

Thank you, your name has been saved as:

${suppliedName.toUpperCase()}

🚀 You can now proceed to type:

!pay month
or
!pay week

to receive your secure billing invoice!`

        });

    } catch (error) {

        console.log(
            "❌ Name registration FULL ERROR:",
            error
        );

        await sock.sendMessage(sender, {

            text:
`❌ PROFILE REGISTRATION FAILED

An unexpected error occurred while saving your profile.

Please try again later.`

        });
    }
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

    return sendWithTyping(
    jid,
    {
        text: `🤖 *JARVIS AI*\n\n${aiReply}`
    },
    m
  );
}

// --- KICK / PROMOTE ---
if (command === "!kick" || command === "!promote") {
    // 🛡️ AUTHORIZATION CHECK: Ensure only staff/admins can run this
    if (!isStaff) {
        return sock.sendMessage(jid, { 
            text: "❌ This command is restricted to group admins." 
        }, { quoted: m });
    }

    let target =
        m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        m.message.extendedTextMessage?.contextInfo?.participant;

    if (!target && args[0]) {
        target = args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    }

    if (!target || target.includes(OWNER_NUMBER)) {
        return sock.sendMessage(jid, { text: "❌ Target invalid." }, { quoted: m });
    }

    const action = command === "!kick" ? "remove" : "promote";

    try {
        await sock.groupParticipantsUpdate(jid, [target], action);

        // 🌟 USE THE RANDOM RESPONSE BANK HERE 🌟
        const actionBank = action === "remove" ? kickResponses : promoteResponses;
        const responseText = getRandomResponse(actionBank, target.split('@')[0]);

        await sock.sendMessage(jid, {
            text: responseText,
            mentions: [target]
        }, { quoted: m });

    } catch (err) {
        console.log("Group Action Error:", err.message);
        await sock.sendMessage(jid, {
            text: "❌ Failed. Am I admin?"
        }, { quoted: m });
    }
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

        //===Get Group ID Number 
if (command === "!getjid") {
    return sendWithTyping(jid, { text: `🎯 This group's JID is:\n\n*${jid}*` }, m);
}
// --- GROUP INFO ---
if (command === "!ginfo") {
    return sock.sendMessage(jid, {
        text: `*📊 ${BOT_NAME} REPORT*\n\nGroup: ${metadata?.subject}\nMembers: ${metadata?.participants?.length}\nPowered by: ${POWERED_BY}`
    });
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
    // 🛡️ AUTHORIZATION CHECK: Ensure only staff/admins can lock or unlock the group
    if (!isStaff) {
        return sock.sendMessage(jid, { 
            text: "❌ This command is restricted to group admins." 
        }, { quoted: m });
    }

    const duration = args[0];
    const unit = args[1]?.toLowerCase();

    const action = command === "!mute"
        ? 'announcement'
        : 'not_announcement';

    // 🌟 USE THE RANDOM RESPONSE BANK HERE 🌟
    const actionBank = command === "!mute" ? muteResponses : unmuteResponses;
    const statusText = getRandomResponse(actionBank);

    if (!duration || isNaN(duration)) {
        await sock.groupSettingUpdate(jid, action);
        return sock.sendMessage(jid, { text: statusText }, { quoted: m });
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
            }, { quoted: m });
    }

    await sock.groupSettingUpdate(jid, action);
    await sock.sendMessage(jid, { text: statusText }, { quoted: m }); // Sends the random mute/unmute message

    setTimeout(async () => {
        const reverse = action === 'announcement'
            ? 'not_announcement'
            : 'announcement';

        await sock.groupSettingUpdate(jid, reverse);

        await sock.sendMessage(jid, {
            text: "Timer's up. I've automatically reversed the group settings."
        });
    }, milliseconds);
}



// --- ADD USER ---
if (command === "!add") {
    // 🛡️ AUTHORIZATION CHECK: Ensure only staff/admins can add members
    if (!isStaff) {
        return sock.sendMessage(jid, { 
            text: "❌ This command is restricted to group admins." 
        }, { quoted: m });
    }

    let target = args[0];

    if (!target) {
        return sock.sendMessage(jid, {
            text: "❌ Provide number e.g. !add 08012345678"
        }, { quoted: m });
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
                text: `I successfully added @${target}`,
                mentions: [targetJid]
            }, { quoted: m });
        } else if (result?.status === "403") {
            return sock.sendMessage(jid, {
                text: "⚠️This person has some privacy restriction installed in the WhatsApp number"
            }, { quoted: m });
        } else if (result?.status === "409") {
            return sock.sendMessage(jid, {
                text: "ℹ️This person is already in group"
            }, { quoted: m });
        } else {
            return sock.sendMessage(jid, {
                text: "❌I'm sorry, I can't add this user at the moment"
            }, { quoted: m });
        }

    } catch (err) {
        console.log("Add Error:", err.message);
        return sock.sendMessage(jid, {
            text: "❌ Error: Am I admin?"
        }, { quoted: m });
    }
}


// --- RESET WARN ---
if (command === "!reset") {
    // 🛡️ AUTHORIZATION CHECK: Ensure only staff/admins can reset warnings
    if (!isStaff) {
        return sock.sendMessage(jid, { 
            text: "❌ This command is restricted to group admins." 
        }, { quoted: m });
    }

    let target =
        m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target) {
        return sock.sendMessage(jid, {
            text: "❌ Tag someone to reset warnings"
        }, { quoted: m });
    }

    await Warn.deleteOne({ userId: target });

    // 🌟 USE THE RANDOM RESPONSE BANK HERE 🌟
    const responseText = getRandomResponse(resetResponses, target.split('@')[0]);

    return sock.sendMessage(jid, {
        text: responseText,
        mentions: [target]
    }, { quoted: m });
}
}
});
}

// ============================================================
// 🤖 JARVIS DASHBOARD API
// ============================================================


// ============================================================
// 📡 WHATSAPP STATUS
// ============================================================

app.get('/api/status', (req, res) => {

    const connected =
        !!sock &&
        !!sock.user;

    res.json({
        connected,
        online: connected,
        status: connected
            ? 'connected'
            : 'waiting'
    });
});


// ============================================================
// 👥 GET WHATSAPP GROUPS
// ============================================================

app.get('/api/groups', async (req, res) => {

    try {

        if (!sock || !sock.user) {
            return res.status(503).json({
                error: "WhatsApp is not connected.",
                groups: []
            });
        }

        let groups = {};

        // Get fresh groups directly from WhatsApp
        if (
            typeof sock.groupFetchAllParticipating ===
            'function'
        ) {
            groups =
                await sock.groupFetchAllParticipating();
        }

        // Fallback to existing group cache
        if (
            !groups ||
            Object.keys(groups).length === 0
        ) {

            for (
                const [jid, metadata]
                of groupCache.entries()
            ) {

                if (jid.endsWith('@g.us')) {
                    groups[jid] = metadata;
                }
            }
        }

        const result =
            Object.entries(groups)

                .filter(([jid]) =>
                    jid.endsWith('@g.us')
                )

                .map(([jid, metadata]) => ({

                    jid,

                    name:
                        metadata?.subject ||
                        metadata?.name ||
                        jid,

                    description:
                        metadata?.desc || '',

                    participants:
                        Array.isArray(
                            metadata?.participants
                        )
                            ? metadata.participants.length
                            : 0
                }))

                .sort((a, b) =>
                    a.name.localeCompare(b.name)
                );

        res.json({
            groups: result,
            count: result.length
        });

    } catch (err) {

        console.log(
            "❌ Dashboard groups error:",
            err.message
        );

        res.status(500).json({
            error: "Unable to load WhatsApp groups.",
            groups: []
        });
    }
});


// ============================================================
// 💬 GET GROUP MESSAGE HISTORY
// ============================================================

app.get(
    '/api/groups/:jid/messages',
    (req, res) => {

        try {

            const jid =
                decodeURIComponent(
                    req.params.jid
                );

            if (!jid.endsWith('@g.us')) {

                return res.status(400).json({
                    error: "Invalid group JID."
                });
            }

            const data =
                loadChatData();

            const messages =
                data[jid] || [];

            // Dashboard normally needs the latest 200.
            const latestMessages =
                messages.slice(-200);

            res.json({
                messages: latestMessages
            });

        } catch (err) {

            console.log(
                "❌ Dashboard message error:",
                err.message
            );

            res.status(500).json({
                error:
                    "Unable to load chat history."
            });
        }
    }
);


// ============================================================
// 📤 SEND MESSAGE FROM DASHBOARD
// ============================================================

app.post(
    '/api/groups/:jid/messages',
    async (req, res) => {

        try {

            const jid =
                decodeURIComponent(
                    req.params.jid
                );

            const messageText =
                typeof req.body?.text === 'string'
                    ? req.body.text.trim()
                    : '';

            // Validate group
            if (!jid.endsWith('@g.us')) {

                return res.status(400).json({
                    error:
                        "Invalid WhatsApp group."
                });
            }

            // Validate message
            if (!messageText) {

                return res.status(400).json({
                    error:
                        "Message cannot be empty."
                });
            }

            if (messageText.length > 4000) {

                return res.status(400).json({
                    error:
                        "Message is too long. Maximum is 4000 characters."
                });
            }

            // Check WhatsApp connection
            if (!sock || !sock.user) {

                return res.status(503).json({
                    error:
                        "WhatsApp is not connected."
                });
            }


            // Send to WhatsApp
            const sent =
                await sock.sendMessage(
                    jid,
                    {
                        text: messageText
                    }
                );


            // Save outgoing message
            const savedMessage =
                saveDashboardMessage({

                    groupJid: jid,

                    messageId:
                        sent?.key?.id || '',

                    senderJid:
                        sock.user?.id || '',

                    senderName:
                        sock.user?.name ||
                        "JARVIS AI",

                    text:
                        messageText,

                    direction:
                        'outgoing',

                    timestamp:
                        Date.now()
                });


            res.json({

                success: true,

                message:
                    savedMessage
            });

        } catch (err) {

            console.log(
                "❌ Dashboard send error:",
                err.message
            );

            res.status(500).json({

                error:
                    "Unable to send message to WhatsApp."
            });
        }
    }
);


// ============================================================
// 📊 DASHBOARD METRICS
// ============================================================

app.get('/api/metrics', async (req, res) => {

    try {

        const data =
            loadChatData();

        let totalMessages = 0;

        for (
            const jid of Object.keys(data)
        ) {

            if (
                Array.isArray(data[jid])
            ) {
                totalMessages +=
                    data[jid].length;
            }
        }


        let groupCount = 0;

        if (
            sock &&
            sock.user &&
            typeof sock.groupFetchAllParticipating ===
                'function'
        ) {

            try {

                const groups =
                    await sock.groupFetchAllParticipating();

                groupCount =
                    Object.keys(
                        groups || {}
                    ).length;

            } catch (_) {}
        }

        if (!groupCount) {
            groupCount =
                groupCache.size;
        }


        res.json({

            messages:
                totalMessages,

            messageCount:
                totalMessages,

            // These remain zero until we connect
            // them to your existing AI/command counters.
            ai: 0,
            aiTasks: 0,

            commands: 0,
            commandCount: 0,

            groups:
                groupCount,

            groupCount:
                groupCount
        });

    } catch (err) {

        console.log(
            "❌ Dashboard metrics error:",
            err.message
        );

        res.status(500).json({
            error:
                "Unable to load dashboard metrics."
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



// ============================================================
// 🤖 JARVIS AI COMMAND CENTER
// ============================================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>JARVIS AI Command Center</title>

<style>
*{
    box-sizing:border-box;
}

:root{
    --bg:#050912;
    --panel:rgba(10,20,36,.72);
    --panel2:rgba(12,27,48,.58);
    --border:rgba(0,220,255,.16);
    --cyan:#00e5ff;
    --blue:#1677ff;
    --green:#00e676;
    --text:#eefaff;
    --muted:#7e9bad;
    --danger:#ff4d6d;
}

html,body{
    margin:0;
    padding:0;
    width:100%;
    min-height:100%;
    background:
        radial-gradient(circle at 15% 15%,rgba(0,229,255,.09),transparent 30%),
        radial-gradient(circle at 85% 80%,rgba(22,119,255,.10),transparent 32%),
        var(--bg);
    color:var(--text);
    font-family:Arial,Helvetica,sans-serif;
}

body{
    min-height:100vh;
    overflow-x:hidden;
}

button,
input{
    font:inherit;
}

button{
    cursor:pointer;
}

.topbar{
    position:sticky;
    top:0;
    z-index:100;
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:18px 24px;
    background:rgba(5,9,18,.78);
    backdrop-filter:blur(18px);
    -webkit-backdrop-filter:blur(18px);
    border-bottom:1px solid var(--border);
}

.brand{
    display:flex;
    align-items:center;
    gap:12px;
}

.logo{
    width:42px;
    height:42px;
    border-radius:14px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:21px;
    background:linear-gradient(135deg,#00e5ff,#1677ff);
    color:#001018;
    box-shadow:0 0 25px rgba(0,229,255,.35);
}

.brand h1{
    margin:0;
    font-size:18px;
    letter-spacing:1.4px;
}

.brand span{
    display:block;
    margin-top:3px;
    font-size:11px;
    color:var(--muted);
    letter-spacing:1px;
}

.status{
    display:flex;
    align-items:center;
    gap:8px;
    padding:9px 13px;
    border:1px solid rgba(0,230,118,.25);
    border-radius:999px;
    background:rgba(0,230,118,.07);
    color:#7dffb3;
    font-size:11px;
    font-weight:bold;
    letter-spacing:1px;
}

.status-dot{
    width:8px;
    height:8px;
    border-radius:50%;
    background:var(--green);
    box-shadow:0 0 12px var(--green);
}

.container{
    width:min(1180px,calc(100% - 32px));
    margin:0 auto;
    padding:30px 0 50px;
}

.hero{
    margin-bottom:22px;
}

.hero h2{
    margin:0;
    font-size:clamp(25px,4vw,38px);
    letter-spacing:-.5px;
}

.hero p{
    margin:8px 0 0;
    color:var(--muted);
    font-size:14px;
}

.glass{
    background:linear-gradient(
        145deg,
        rgba(15,30,51,.78),
        rgba(7,15,28,.60)
    );
    border:1px solid var(--border);
    border-radius:22px;
    box-shadow:
        0 18px 60px rgba(0,0,0,.25),
        inset 0 1px 0 rgba(255,255,255,.025);
    backdrop-filter:blur(18px);
    -webkit-backdrop-filter:blur(18px);
}

.section{
    padding:20px;
    margin-bottom:20px;
}

.section-title{
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:15px;
}

.section-title h3{
    margin:0;
    font-size:14px;
    letter-spacing:1px;
}

.section-title span{
    font-size:10px;
    color:var(--muted);
    letter-spacing:1px;
}

/* GRAPH */

.graph-card{
    overflow:hidden;
}

.graph{
    height:230px;
    position:relative;
    overflow:hidden;
    border-radius:15px;
    background:
        linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
        linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
    background-size:42px 42px;
    border:1px solid rgba(255,255,255,.04);
}

.graph svg{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
}

.graph-line{
    fill:none;
    stroke:var(--cyan);
    stroke-width:3;
    filter:drop-shadow(0 0 7px rgba(0,229,255,.7));
}

.graph-area{
    fill:url(#areaGradient);
    opacity:.22;
}

.graph-label{
    position:absolute;
    left:14px;
    top:13px;
    padding:6px 9px;
    border-radius:8px;
    background:rgba(0,229,255,.08);
    border:1px solid rgba(0,229,255,.13);
    color:var(--cyan);
    font-size:10px;
    font-weight:bold;
    letter-spacing:1px;
}

/* METRICS */

.metrics{
    display:grid;
    grid-template-columns:repeat(4,1fr);
    gap:14px;
    margin-bottom:20px;
}

.metric{
    padding:18px;
    min-height:105px;
    position:relative;
    overflow:hidden;
}

.metric:after{
    content:"";
    position:absolute;
    width:80px;
    height:80px;
    right:-35px;
    bottom:-35px;
    border-radius:50%;
    background:rgba(0,229,255,.08);
    filter:blur(8px);
}

.metric-label{
    color:var(--muted);
    font-size:10px;
    letter-spacing:1.3px;
}

.metric-value{
    margin-top:10px;
    font-size:27px;
    font-weight:700;
    color:white;
}

.metric-value.cyan{
    color:var(--cyan);
    text-shadow:0 0 18px rgba(0,229,255,.25);
}

/* PAIRING */

.pairing{
    display:grid;
    grid-template-columns:1fr auto;
    gap:20px;
    align-items:center;
}

.pair-info h3{
    margin:0 0 7px;
}

.pair-info p{
    margin:0;
    color:var(--muted);
    font-size:12px;
}

.pair-controls{
    display:flex;
    flex-wrap:wrap;
    gap:9px;
    justify-content:flex-end;
}

.pair-controls input{
    width:220px;
    padding:13px 15px;
    border-radius:12px;
    border:1px solid rgba(0,229,255,.15);
    outline:none;
    background:rgba(0,0,0,.24);
    color:white;
}

.pair-controls input:focus{
    border-color:var(--cyan);
    box-shadow:0 0 0 3px rgba(0,229,255,.07);
}

.btn{
    border:0;
    padding:13px 18px;
    border-radius:12px;
    color:white;
    font-weight:bold;
    background:linear-gradient(135deg,#007f9b,#1468dc);
    box-shadow:0 8px 25px rgba(0,126,180,.18);
}

.btn:hover{
    filter:brightness(1.1);
}

.pair-code{
    margin-top:13px;
    min-height:25px;
    color:var(--cyan);
    font-size:20px;
    font-weight:bold;
    letter-spacing:3px;
}

/* CHATS ENTRY */

.chat-entry{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:20px;
    padding:22px;
}

.chat-entry-left{
    display:flex;
    align-items:center;
    gap:15px;
}

.chat-icon{
    width:52px;
    height:52px;
    border-radius:16px;
    display:flex;
    align-items:center;
    justify-content:center;
    background:rgba(0,229,255,.08);
    border:1px solid rgba(0,229,255,.16);
    font-size:24px;
    box-shadow:0 0 25px rgba(0,229,255,.08);
}

.chat-entry h3{
    margin:0 0 5px;
}

.chat-entry p{
    margin:0;
    color:var(--muted);
    font-size:12px;
}

.open-chat{
    min-width:130px;
}

/* CHAT WORKSPACE */

#chatWorkspace{
    display:none;
    position:fixed;
    inset:0;
    z-index:200;
    background:
        radial-gradient(circle at 10% 20%,rgba(0,229,255,.07),transparent 30%),
        radial-gradient(circle at 90% 80%,rgba(22,119,255,.08),transparent 30%),
        var(--bg);
}

.chat-layout{
    display:grid;
    grid-template-columns:340px 1fr;
    width:100%;
    height:100%;
}

.groups-panel{
    border-right:1px solid var(--border);
    background:rgba(5,12,23,.72);
    backdrop-filter:blur(20px);
    -webkit-backdrop-filter:blur(20px);
    overflow:hidden;
}

.groups-header{
    padding:20px;
    border-bottom:1px solid var(--border);
}

.groups-top{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
}

.groups-top h2{
    margin:0;
    font-size:18px;
}

.back-home{
    border:1px solid rgba(0,229,255,.14);
    background:rgba(0,229,255,.05);
    color:var(--cyan);
    border-radius:10px;
    padding:8px 10px;
}

.search{
    width:100%;
    margin-top:15px;
    padding:12px 13px;
    border-radius:11px;
    border:1px solid rgba(255,255,255,.07);
    background:rgba(0,0,0,.23);
    color:white;
    outline:none;
}

.groups-list{
    height:calc(100% - 130px);
    overflow-y:auto;
    padding:10px;
}

.group-item{
    padding:14px;
    border-radius:13px;
    margin-bottom:6px;
    cursor:pointer;
    border:1px solid transparent;
}

.group-item:hover,
.group-item.active{
    background:rgba(0,229,255,.07);
    border-color:rgba(0,229,255,.13);
}

.group-name{
    font-size:13px;
    font-weight:bold;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}

.group-meta{
    margin-top:5px;
    font-size:10px;
    color:var(--muted);
}

/* CONVERSATION */

.conversation{
    min-width:0;
    display:flex;
    flex-direction:column;
    background:rgba(4,10,19,.54);
}

.conversation-header{
    min-height:75px;
    display:flex;
    align-items:center;
    gap:12px;
    padding:13px 20px;
    border-bottom:1px solid var(--border);
    background:rgba(8,17,31,.72);
    backdrop-filter:blur(15px);
}

.mobile-back{
    display:none;
    border:0;
    background:transparent;
    color:var(--cyan);
    font-size:22px;
}

.group-avatar{
    width:43px;
    height:43px;
    border-radius:50%;
    display:flex;
    align-items:center;
    justify-content:center;
    background:linear-gradient(135deg,#063b52,#123a79);
    border:1px solid rgba(0,229,255,.15);
}

.conversation-title{
    min-width:0;
}

.conversation-title h3{
    margin:0;
    font-size:14px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}

.conversation-title span{
    display:block;
    margin-top:4px;
    color:var(--muted);
    font-size:10px;
}

.messages{
    flex:1;
    overflow-y:auto;
    padding:22px;
    display:flex;
    flex-direction:column;
    gap:7px;
}

.message{
    max-width:min(72%,600px);
    padding:9px 12px;
    border-radius:13px;
    font-size:13px;
    line-height:1.45;
    word-break:break-word;
}

.message.incoming{
    align-self:flex-start;
    background:rgba(19,33,53,.9);
    border:1px solid rgba(255,255,255,.05);
    border-bottom-left-radius:4px;
}

.message.outgoing{
    align-self:flex-end;
    background:linear-gradient(135deg,rgba(0,112,145,.72),rgba(16,73,143,.72));
    border:1px solid rgba(0,229,255,.11);
    border-bottom-right-radius:4px;
}

.sender{
    margin-bottom:3px;
    color:var(--cyan);
    font-size:10px;
    font-weight:bold;
}

.message-time{
    margin-top:4px;
    text-align:right;
    color:rgba(255,255,255,.42);
    font-size:9px;
}

.empty{
    margin:auto;
    text-align:center;
    color:var(--muted);
    font-size:13px;
}

.composer{
    display:flex;
    gap:10px;
    padding:14px;
    border-top:1px solid var(--border);
    background:rgba(5,12,22,.82);
}

.composer input{
    flex:1;
    min-width:0;
    border:1px solid rgba(255,255,255,.08);
    border-radius:13px;
    padding:13px 15px;
    background:rgba(0,0,0,.25);
    color:white;
    outline:none;
}

.composer input:focus{
    border-color:rgba(0,229,255,.4);
}

.send{
    width:52px;
    border:0;
    border-radius:13px;
    color:white;
    background:linear-gradient(135deg,#007c9a,#1466d8);
    font-size:18px;
}

.loading{
    text-align:center;
    padding:25px;
    color:var(--muted);
    font-size:12px;
}

@media(max-width:800px){

    .container{
        width:min(100% - 20px,700px);
        padding-top:20px;
    }

    .topbar{
        padding:14px 15px;
    }

    .metrics{
        grid-template-columns:repeat(2,1fr);
    }

    .pairing{
        grid-template-columns:1fr;
    }

    .pair-controls{
        justify-content:flex-start;
    }

    .chat-layout{
        grid-template-columns:1fr;
    }

    .groups-panel{
        display:block;
        width:100%;
    }

    .conversation{
        display:none;
    }

    #chatWorkspace.mobile-conversation .groups-panel{
        display:none;
    }

    #chatWorkspace.mobile-conversation .conversation{
        display:flex;
    }

    .mobile-back{
        display:block;
    }

    .message{
        max-width:85%;
    }
}

@media(max-width:500px){

    .metrics{
        gap:9px;
    }

    .metric{
        padding:14px;
    }

    .metric-value{
        font-size:23px;
    }

    .pair-controls{
        flex-direction:column;
    }

    .pair-controls input,
    .pair-controls .btn{
        width:100%;
    }

    .chat-entry{
        align-items:flex-start;
        flex-direction:column;
    }

    .open-chat{
        width:100%;
    }

    .graph{
        height:190px;
    }
}
</style>
</head>

<body>

<div class="topbar">
    <div class="brand">
        <div class="logo">J</div>
        <div>
            <h1>JARVIS AI</h1>
            <span>COMMAND CENTER</span>
        </div>
    </div>

    <div class="status" id="systemStatus">
        <span class="status-dot"></span>
        <span id="statusText">SYSTEM ONLINE</span>
    </div>
</div>

<main class="container" id="home">

    <div class="hero">
        <h2>JARVIS AI Command Center</h2>
        <p>Monitor your WhatsApp AI system and manage conversations from one place.</p>
    </div>

    <section class="glass section graph-card">

        <div class="section-title">
            <h3>PROCESSING ACTIVITY</h3>
            <span>SYSTEM LIVE</span>
        </div>

        <div class="graph">
            <div class="graph-label">LIVE ACTIVITY</div>

            <svg viewBox="0 0 1000 230" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#00e5ff"/>
                        <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
                    </linearGradient>
                </defs>

                <path
                    id="graphArea"
                    class="graph-area"
                    d=""
                />

                <path
                    id="graphLine"
                    class="graph-line"
                    d=""
                />
            </svg>
        </div>

    </section>

    <section class="metrics">

        <div class="glass metric">
            <div class="metric-label">MESSAGES</div>
            <div class="metric-value cyan" id="messagesMetric">0</div>
        </div>

        <div class="glass metric">
            <div class="metric-label">AI TASKS</div>
            <div class="metric-value" id="aiMetric">0</div>
        </div>

        <div class="glass metric">
            <div class="metric-label">COMMANDS</div>
            <div class="metric-value" id="commandsMetric">0</div>
        </div>

        <div class="glass metric">
            <div class="metric-label">GROUPS</div>
            <div class="metric-value" id="groupsMetric">0</div>
        </div>

    </section>

    <section class="glass section">

        <div class="section-title">
            <h3>WHATSAPP PAIRING</h3>
            <span id="pairStatus">READY</span>
        </div>

        <div class="pairing">

            <div class="pair-info">
                <h3>Connect JARVIS to WhatsApp</h3>
                <p>
                    Enter the WhatsApp number attached to the account
                    you want to pair with JARVIS.
                </p>

                <div class="pair-code" id="pairCode"></div>
            </div>

            <div class="pair-controls">

                <input
                    id="pairingNumber"
                    type="text"
                    inputmode="numeric"
                    placeholder="2348012345678"
                >

                <button
                    class="btn"
                    id="pairButton"
                    onclick="requestPairCode()"
                >
                    GET PAIRING CODE
                </button>

            </div>

        </div>

    </section>

    <section class="glass chat-entry">

        <div class="chat-entry-left">

            <div class="chat-icon">💬</div>

            <div>
                <h3>WhatsApp Chats</h3>
                <p>
                    Open your WhatsApp groups and manage conversations
                    directly from the JARVIS dashboard.
                </p>
            </div>

        </div>

        <button
            class="btn open-chat"
            id="openChats"
            onclick="openChatWorkspace()"
        >
            OPEN CHATS
        </button>

    </section>

</main>


<!-- ============================================================
     CHAT WORKSPACE
============================================================ -->

<div id="chatWorkspace">

    <div class="chat-layout">

        <!-- GROUP LIST -->

        <aside class="groups-panel">

            <div class="groups-header">

                <div class="groups-top">

                    <h2>WhatsApp Groups</h2>

                    <button
                        class="back-home"
                        onclick="closeChatWorkspace()"
                    >
                        ← Home
                    </button>

                </div>

                <input
                    class="search"
                    id="groupSearch"
                    placeholder="Search groups..."
                    oninput="filterGroups()"
                >

            </div>

            <div
                class="groups-list"
                id="groupsList"
            >
                <div class="loading">
                    Loading groups...
                </div>
            </div>

        </aside>


        <!-- CONVERSATION -->

        <section class="conversation">

            <div class="conversation-header">

                <button
                    class="mobile-back"
                    onclick="mobileBackToGroups()"
                >
                    ←
                </button>

                <div class="group-avatar">
                    💬
                </div>

                <div class="conversation-title">

                    <h3 id="conversationName">
                        Select a group
                    </h3>

                    <span id="conversationMeta">
                        Choose a WhatsApp group to view messages
                    </span>

                </div>

            </div>

            <div
                class="messages"
                id="messages"
            >
                <div class="empty">
                    Select a group to open the conversation.
                </div>
            </div>

            <div class="composer">

                <input
                    id="messageInput"
                    type="text"
                    placeholder="Type a message..."
                    autocomplete="off"
                    disabled
                >

                <button
                    class="send"
                    id="sendButton"
                    onclick="sendMessage()"
                    disabled
                >
                    ➤
                </button>

            </div>

        </section>

    </div>

</div>


<script>

let groups = [];
let selectedGroup = null;

let messageTimer = null;
let metricsTimer = null;
let statusTimer = null;


/* ============================================================
   HELPERS
============================================================ */

function escapeHtml(value){

    return String(value ?? '')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');

}


function formatNumber(value){

    return Number(value || 0).toLocaleString();

}


function formatMessageTime(timestamp){

    if(!timestamp){
        return '';
    }

    const date = new Date(timestamp);

    if(Number.isNaN(date.getTime())){
        return '';
    }

    return date.toLocaleTimeString([],{
        hour:'2-digit',
        minute:'2-digit'
    });

}


/* ============================================================
   PAIRING
============================================================ */

async function requestPairCode(){

    const input =
        document.getElementById('pairingNumber');

    const button =
        document.getElementById('pairButton');

    const code =
        document.getElementById('pairCode');

    const pairStatus =
        document.getElementById('pairStatus');

    const number =
        input.value.replace(/[^0-9]/g,'');

    if(!number){

        code.textContent =
            'Enter a WhatsApp number first.';

        return;
    }

    button.disabled = true;
    button.textContent = 'REQUESTING...';

    pairStatus.textContent = 'REQUESTING';

    code.textContent = 'Generating pairing code...';

    try{

        const response =
            await fetch(
                '/pair?number=' +
                encodeURIComponent(number)
            );

        const text =
            await response.text();

        code.textContent = text;

        pairStatus.textContent = 'CODE READY';

    }catch(error){

        console.error(error);

        code.textContent =
            'Unable to generate pairing code.';

        pairStatus.textContent = 'ERROR';

    }finally{

        button.disabled = false;
        button.textContent = 'GET PAIRING CODE';

    }

}


/* ============================================================
   CHAT WORKSPACE
============================================================ */

async function openChatWorkspace(){

    document.getElementById('home').style.display = 'none';

    document.getElementById('chatWorkspace').style.display = 'block';

    await loadGroups();

}


function closeChatWorkspace(){

    stopMessagePolling();

    document.getElementById('chatWorkspace').style.display = 'none';

    document.getElementById('chatWorkspace')
        .classList.remove('mobile-conversation');

    document.getElementById('home').style.display = 'block';

    selectedGroup = null;

}


function mobileBackToGroups(){

    document.getElementById('chatWorkspace')
        .classList.remove('mobile-conversation');

}


/* ============================================================
   GROUPS
============================================================ */

async function loadGroups(){

    const list =
        document.getElementById('groupsList');

    list.innerHTML =
        '<div class="loading">Loading WhatsApp groups...</div>';

    try{

        const response =
            await fetch('/api/groups');

        const data =
            await response.json();

        if(!response.ok){

            throw new Error(
                data.error ||
                'Unable to load groups'
            );

        }

        groups =
            Array.isArray(data)
                ? data
                : (data.groups || []);

        renderGroups(groups);

        document.getElementById('groupsMetric')
            .textContent =
            formatNumber(groups.length);

    }catch(error){

        console.error(error);

        list.innerHTML =
            '<div class="loading">' +
            escapeHtml(error.message) +
            '</div>';

    }

}


function renderGroups(items){

    const list =
        document.getElementById('groupsList');

    if(!items.length){

        list.innerHTML =
            '<div class="loading">No WhatsApp groups found.</div>';

        return;
    }

    list.innerHTML =
        items.map(group => {

            const active =
                selectedGroup &&
                selectedGroup.jid === group.jid
                    ? 'active'
                    : '';

            return \`
                <div
                    class="group-item \${active}"
                    onclick="selectGroup('\${escapeJs(group.jid)}')"
                >
                    <div class="group-name">
                        \${escapeHtml(group.name || group.jid)}
                    </div>

                    <div class="group-meta">
                        \${formatNumber(group.participants || 0)}
                        participants
                    </div>
                </div>
            \`;

        }).join('');

}


function escapeJs(value){

    return String(value || '')
        .replace(/\\\\/g,'\\\\\\\\')
        .replace(/'/g,"\\\\'")
        .replace(/"/g,'&quot;')
        .replace(/\\n/g,'\\\\n')
        .replace(/\\r/g,'\\\\r');

}


function filterGroups(){

    const query =
        document.getElementById('groupSearch')
            .value
            .trim()
            .toLowerCase();

    const filtered =
        groups.filter(group =>
            String(group.name || group.jid)
                .toLowerCase()
                .includes(query)
        );

    renderGroups(filtered);

}


/* ============================================================
   SELECT GROUP
============================================================ */

async function selectGroup(jid){

    selectedGroup =
        groups.find(group =>
            group.jid === jid
        ) || {
            jid,
            name: jid
        };

    document.getElementById('conversationName')
        .textContent =
        selectedGroup.name || jid;

    document.getElementById('conversationMeta')
        .textContent =
        formatNumber(
            selectedGroup.participants || 0
        ) +
        ' participants';

    document.getElementById('messageInput')
        .disabled = false;

    document.getElementById('sendButton')
        .disabled = false;

    document.getElementById('chatWorkspace')
        .classList.add('mobile-conversation');

    renderGroups(
        groups.filter(group => {

            const query =
                document.getElementById('groupSearch')
                    .value
                    .trim()
                    .toLowerCase();

            return String(group.name || group.jid)
                .toLowerCase()
                .includes(query);

        })
    );

    await loadMessages();

    startMessagePolling();

}


/* ============================================================
   MESSAGES
============================================================ */

async function loadMessages(){

    if(!selectedGroup){
        return;
    }

    try{

        const response =
            await fetch(
                '/api/groups/' +
                encodeURIComponent(
                    selectedGroup.jid
                ) +
                '/messages'
            );

        const data =
            await response.json();

        if(!response.ok){

            throw new Error(
                data.error ||
                'Unable to load messages'
            );

        }

        renderMessages(
            Array.isArray(data)
                ? data
                : (data.messages || [])
        );

    }catch(error){

        console.error(error);

        document.getElementById('messages')
            .innerHTML =
            '<div class="empty">' +
            escapeHtml(error.message) +
            '</div>';

    }

}


function renderMessages(messages){

    const box =
        document.getElementById('messages');

    if(!messages.length){

        box.innerHTML =
            '<div class="empty">' +
            'No stored messages for this group yet.' +
            '</div>';

        return;
    }

    box.innerHTML =
        messages.map(message => {

            const outgoing =
                message.direction === 'outgoing';

            return \`
                <div class="message \${outgoing ? 'outgoing' : 'incoming'}">

                    \${!outgoing && message.senderName
                        ? \`
                            <div class="sender">
                                \${escapeHtml(message.senderName)}
                            </div>
                          \`
                        : ''
                    }

                    <div>
                        \${escapeHtml(message.text || '')}
                    </div>

                    <div class="message-time">
                        \${formatMessageTime(message.timestamp)}
                    </div>

                </div>
            \`;

        }).join('');

    box.scrollTop =
        box.scrollHeight;

}


function startMessagePolling(){

    stopMessagePolling();

    messageTimer =
        setInterval(
            loadMessages,
            2500
        );

}


function stopMessagePolling(){

    if(messageTimer){

        clearInterval(messageTimer);

        messageTimer = null;

    }

}


/* ============================================================
   SEND MESSAGE
============================================================ */

async function sendMessage(){

    if(!selectedGroup){
        return;
    }

    const input =
        document.getElementById('messageInput');

    const button =
        document.getElementById('sendButton');

    const text =
        input.value.trim();

    if(!text){
        return;
    }

    input.disabled = true;
    button.disabled = true;

    try{

        const response =
            await fetch(
                '/api/groups/' +
                encodeURIComponent(
                    selectedGroup.jid
                ) +
                '/messages',
                {
                    method:'POST',
                    headers:{
                        'Content-Type':'application/json'
                    },
                    body:JSON.stringify({
                        text
                    })
                }
            );

        const data =
            await response.json();

        if(!response.ok){

            throw new Error(
                data.error ||
                'Unable to send message'
            );

        }

        input.value = '';

        await loadMessages();

    }catch(error){

        console.error(error);

        alert(error.message);

    }finally{

        input.disabled = false;
        button.disabled = false;

        input.focus();

    }

}


document.getElementById('messageInput')
    .addEventListener('keydown',event => {

        if(event.key === 'Enter'){

            event.preventDefault();

            sendMessage();

        }

    });


/* ============================================================
   METRICS
============================================================ */

async function loadMetrics(){

    try{

        const response =
            await fetch('/api/metrics');

        const data =
            await response.json();

        if(!response.ok){
            return;
        }

        document.getElementById('messagesMetric')
            .textContent =
            formatNumber(
                data.messages ??
                data.totalMessages ??
                0
            );

        document.getElementById('aiMetric')
            .textContent =
            formatNumber(
                data.aiTasks ??
                data.ai ??
                0
            );

        document.getElementById('commandsMetric')
            .textContent =
            formatNumber(
                data.commands ??
                0
            );

        if(
            typeof data.groups !== 'undefined'
        ){

            document.getElementById('groupsMetric')
                .textContent =
                formatNumber(data.groups);

        }

    }catch(error){

        console.error(
            'Metrics error:',
            error
        );

    }

}


/* ============================================================
   STATUS
============================================================ */

async function loadStatus(){

    try{

        const response =
            await fetch('/api/status');

        const data =
            await response.json();

        const statusText =
            document.getElementById('statusText');

        const status =
            document.getElementById('systemStatus');

        const connected =
            Boolean(
                data.connected ||
                data.online ||
                data.status === 'connected'
            );

        if(connected){

            statusText.textContent =
                'SYSTEM ONLINE';

            status.style.color =
                '#7dffb3';

        }else{

            statusText.textContent =
                'SYSTEM OFFLINE';

            status.style.color =
                '#ff8198';

        }

    }catch(error){

        document.getElementById('statusText')
            .textContent =
            'SYSTEM OFFLINE';

    }

}


/* ============================================================
   MOCK PROCESSING GRAPH
   This intentionally remains simulated.
============================================================ */

const graphPoints =
    Array.from(
        {length:45},
        () => 25 + Math.random() * 55
    );


function updateGraph(){

    for(let i = 0; i < graphPoints.length - 1; i++){

        graphPoints[i] =
            graphPoints[i + 1];

    }

    const last =
        graphPoints[graphPoints.length - 1];

    let next =
        last +
        (Math.random() - .5) * 28;

    next =
        Math.max(
            12,
            Math.min(90,next)
        );

    graphPoints[graphPoints.length - 1] =
        next;

    const width = 1000;
    const height = 230;

    const step =
        width /
        (graphPoints.length - 1);

    let line = '';

    graphPoints.forEach((value,index) => {

        const x =
            index * step;

        const y =
            height -
            (value / 100) * height;

        line +=
            (index === 0 ? 'M' : 'L') +
            x +
            ' ' +
            y +
            ' ';

    });

    const area =
        line +
        'L ' +
        width +
        ' ' +
        height +
        ' L 0 ' +
        height +
        ' Z';

    document.getElementById('graphLine')
        .setAttribute('d',line);

    document.getElementById('graphArea')
        .setAttribute('d',area);

}


updateGraph();

setInterval(
    updateGraph,
    700
);


/* ============================================================
   START DASHBOARD POLLING
============================================================ */

loadMetrics();
loadStatus();

metricsTimer =
    setInterval(
        loadMetrics,
        3000
    );

statusTimer =
    setInterval(
        loadStatus,
        5000
    );

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

// 🚀 PASTE THE NEW ROUTE RIGHT HERE:

app.post("/payment-success", express.json(), async (req, res) => {
    try {
        const { phone, plan } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: "Missing phone details parameters." });
        }

        const studentJid = `${phone}@s.whatsapp.net`;
        const paidClassGroupLink = "https://chat.whatsapp.com/JC7W3YORbIr4GtoktECpaU";

       const activationNotice = 
    `🎉 *FLEXI TUTORS PAYSTACK COMPLIANCE* 🎓\n\n` +
    `Hello @${phone}, your digital payment verification tracking for *${plan}* is completely successful!\n\n` +
    `🚀 Premium system access tokens have been deployed straight to your mobile number profile.\n\n` +
    `👇 *Click the direct link below to jump into the Paid Lectures Group right away:* \n` +
    `${paidClassGroupLink}\n\n` +
    `Welcome to the inner circle! Let's get you ready to clear those boards!`;

        await sock.sendMessage(studentJid, { 
            text: activationNotice,
            mentions: [studentJid]
        });

        console.log(`🚀 Automated entry credentials passed cleanly to DM profile: ${phone}`);
        return res.json({ success: true, message: "Group link dropped successfully." });

    } catch (err) {
        console.error("❌ Error running WhatsApp automation link callback:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// JARVIS ACTION RESPONSE BANKS
// ==========================================
const kickResponses = [
    (tag) => `I successfully removed @${tag}. Out they go.`,
    (tag) => `Done. I've successfully kicked @${tag} from the group.`,
    (tag) => `I successfully showed @${tag} the door. Good riddance.`,
    (tag) => `Operation complete. I've successfully removed @${tag}.`
];

// ... rest of your response banks and app.listen remain the same

const promoteResponses = [
    (tag) => `I successfully promoted @${tag} to admin. Welcome to the inner circle.`,
    (tag) => `Done. I've successfully granted admin status to @${tag}.`,
    (tag) => `I successfully elevated @${tag}. They are now an admin.`
];

const muteResponses = [
    () => `I've locked the group down. Only admins have the floor right now.`,
    () => `Protocol active: I've successfully locked the group. Silence is golden.`,
    () => `I've locked the group. Member messaging is temporarily restricted.`
];

const unmuteResponses = [
    () => `I've unlocked the group. Everyone can speak freely again.`,
    () => `Restrictions lifted. I've successfully opened the group back up.`,
    () => `I've unlocked the group. The floor is open.`
];

const resetResponses = [
    (tag) => `I successfully cleared the slate. All warnings for @${tag} have been wiped.`,
    (tag) => `Done. I've successfully reset the strike count for @${tag}.`,
    (tag) => `Clean record restored. I successfully cleared the warnings for @${tag}.`
];

// Helper function to pick a random item from any bank
function getRandomResponse(bank, param) {
    const randomIndex = Math.floor(Math.random() * bank.length);
    return bank[randomIndex](param);
}


// ---------------- START ----------------
app.listen(port, () => {
   console.log(`Server running on ${port}`);
   startJARVIS();
});
