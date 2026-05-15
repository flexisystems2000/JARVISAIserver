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
  apiKey: "AIzaSyCoGX2bXlvuwcJY8y0yW6_J42fgxfH5vZao",
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

    if (text.includes("jarvis") && !text.startsWith("!")) {
        await sock.sendMessage(jid, {
            react: { key: m.key, text: "🤖" }
        });
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
});

// A. Reading/Analyzing Uploaded Files
if (isDoc || isImg) {
    await sock.sendMessage(jid, { react: { key: m.key, text: "📂" } });
    await sock.sendPresenceUpdate('composing', jid);

    try {
        let mediaMessage;

        if (isDoc) {
            mediaMessage = m.message.documentMessage;
        } else {
            mediaMessage = m.message.imageMessage
                ? m.message
                : m.message.extendedTextMessage?.contextInfo?.quotedMessage;
        }

        const buffer = await downloadMedia(mediaMessage);
        const base64Media = buffer.toString('base64');

        const fileName = isDoc
            ? m.message.documentMessage?.fileName || "document.pdf"
            : "Image Analysis";

        const aiReply = await askAI(
            body || `Please analyze this file: ${fileName}`,
            base64Media
        );

        return sock.sendMessage(
            jid,
            {
                text: `🎓 *GROUP STUDY ASSISTANT*\n\n${aiReply}`
            },
            { quoted: m }
        );

    } catch (err) {
        console.log("File Error:", err.message);
        return sock.sendMessage(jid, {
            text: "⚠️ I couldn't read that file. Ensure it's a valid image or document."
        });
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
    
