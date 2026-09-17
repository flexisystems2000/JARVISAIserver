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

// =========================
// JARVIS TYPING SIMULATION
// =========================
async function sendWithTyping(jid, message, quotedMessage = null) {
    try {
        await sock.sendPresenceUpdate('composing', jid);
        const textLength = message?.text?.length || 0;
        const typingDelay = Math.min(Math.max(800, textLength * 12), 5000);

        await new Promise(resolve => setTimeout(resolve, typingDelay));

        return await sock.sendMessage(jid, message, quotedMessage ? { quoted: quotedMessage } : undefined);
    } finally {
        await sock.sendPresenceUpdate('paused', jid).catch(() => {});
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

        // 🌟 USE THE NEW RANDOM RESPONSE BANK HERE 🌟
        const actionBank = action === "remove" ? kickResponses : promoteResponses;
        const responseText = getRandomResponse(actionBank, target.split('@')[0]);

        await sock.sendMessage(jid, {
            text: responseText,
            mentions: [target]
        });

    } catch (err) {
        console.log("Group Action Error:", err.message);
        await sock.sendMessage(jid, {
            text: "❌ Failed. Am I admin?"
        });
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
    const duration = args[0];
    const unit = args[1]?.toLowerCase();

    const action = command === "!mute"
        ? 'announcement'
        : 'not_announcement';

    // 🌟 USE THE NEW RANDOM RESPONSE BANK HERE 🌟
    const actionBank = command === "!mute" ? muteResponses : unmuteResponses;
    const statusText = getRandomResponse(actionBank);

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
    await sock.sendMessage(jid, { text: statusText }); // Sends the random mute/unmute message

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

    // 🌟 USE THE NEW RANDOM RESPONSE BANK HERE 🌟
    const responseText = getRandomResponse(resetResponses, target.split('@')[0]);

    return sock.sendMessage(jid, {
        text: responseText,
        mentions: [target]
    });
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
            `Hello @\( {phone}, your digital payment verification tracking for * \){plan}* is completely successful!\n\n` +
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
