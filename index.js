const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    downloadContentFromMessage,
    areJidsSameUser
} = require('@musteqeem/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

require('dotenv').config();
const quizEngine = require('./quizEngine');
const naturalLanguageRouter =
    require('./naturalLanguageRouter');
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
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) console.warn('⚠️ MONGO_URI is not set. Configure it in your hosting environment.');

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

// Persistent, group-specific bans. A member banned in one group is not
// automatically banned from any other group.
const BanSchema = new mongoose.Schema({
    groupJid: { type: String, required: true, index: true },
    userJid: { type: String, required: true, index: true },
    bannedBy: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
BanSchema.index({ groupJid: 1, userJid: 1 }, { unique: true });
const Ban = mongoose.models.Ban || mongoose.model('Ban', BanSchema);

// ============================================================
// 🧠 PERSISTENT JARVIS CONVERSATION MEMORY (MongoDB)
// Stores user/assistant turns separately for each user and chat.
// Group conversations are scoped to that group AND participant,
// so one member's private context is not shared with another.
// ============================================================
const MemoryMessageSchema = new mongoose.Schema({
    conversationKey: { type: String, required: true, index: true },
    userJid: { type: String, required: true, index: true },
    chatJid: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true }
});
MemoryMessageSchema.index({ conversationKey: 1, createdAt: -1 });
const MemoryMessage = mongoose.models.JarvisMemoryMessage ||
    mongoose.model('JarvisMemoryMessage', MemoryMessageSchema);


// Persistent per-chat voice reply preference. Defaults to text mode.
const TTSPreferenceSchema = new mongoose.Schema({
    chatJid: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
});
const TTSPreference = mongoose.models.JarvisTTSPreference ||
    mongoose.model('JarvisTTSPreference', TTSPreferenceSchema);


// Persistent reminders. The polling worker checks MongoDB so reminders survive restarts.
const ReminderSchema = new mongoose.Schema({
    chatJid: { type: String, required: true, index: true },
    requesterJid: { type: String, default: '' },
    text: { type: String, required: true },
    dueAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['pending', 'sent', 'cancelled'], default: 'pending', index: true },
    createdAt: { type: Date, default: Date.now }
});
const Reminder = mongoose.models.JarvisReminder || mongoose.model('JarvisReminder', ReminderSchema);

function parseReminderDelay(input) {
    const match = String(input || '').trim().match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
    if (!match) return null;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = /^s/.test(unit) ? 1000 : /^(m|min|mins|minute|minutes)$/.test(unit) ? 60000 : /^(h|hr|hrs|hour|hours)$/.test(unit) ? 3600000 : 86400000;
    if (!Number.isFinite(n) || n < 1 || n > 10000) return null;
    return n * multiplier;
}

function validatePublicHttpUrl(raw) {
    let url;
    try { url = new URL(String(raw || '').trim()); } catch { throw new Error('Please provide a valid URL, including https://'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS URLs are supported.');
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        throw new Error('Private/local network URLs are not allowed.');
    }
    return url.toString();
}

async function checkWebsite(rawUrl, includeContent = false) {
    const url = validatePublicHttpUrl(rawUrl);
    const started = Date.now();
    let response;
    try {
        response = await axios.get(url, {
            timeout: 12000,
            maxRedirects: 4,
            maxContentLength: 2 * 1024 * 1024,
            responseType: 'text',
            validateStatus: () => true,
            headers: { 'User-Agent': 'JarvisAI-WebsiteCheck/1.0' }
        });
    } catch (err) {
        return { url, reachable: false, status: null, ms: Date.now() - started, error: err.code || err.message };
    }
    const html = typeof response.data === 'string' ? response.data : '';
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '').slice(0, 300);
    const headings = includeContent ? [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0, 12).map(x => x[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
    return { url, reachable: response.status >= 200 && response.status < 500, status: response.status, ms: Date.now() - started, title, description, headings };
}

async function captureWebsiteScreenshot(rawUrl) {
    const url = validatePublicHttpUrl(rawUrl);
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch {
        throw new Error('Playwright is not installed. Install dependencies and Chromium to enable website screenshots.');
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const page = await browser.newPage({
            viewport: { width: 1365, height: 900 },
            deviceScaleFactor: 1
        });
        page.setDefaultNavigationTimeout(25000);
        await page.route('**/*', async route => {
            try {
                const requestUrl = route.request().url();
                if (/^(data|blob):/i.test(requestUrl)) return route.continue();
                validatePublicHttpUrl(requestUrl);
                return route.continue();
            } catch {
                return route.abort();
            }
        });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const finalUrl = validatePublicHttpUrl(page.url());
        const dimensions = await page.evaluate(() => ({
            width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
            height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
        }));
        // Keep very long pages to a viewport screenshot to avoid huge WhatsApp uploads.
        const fullPage = dimensions.height <= 12000;
        const buffer = await page.screenshot({ type: 'jpeg', quality: 78, fullPage });
        if (!buffer?.length) throw new Error('Browser returned an empty screenshot.');
        return { buffer, url: finalUrl, fullPage };
    } finally {
        await browser.close().catch(() => {});
    }
}

async function translateText(source, target, input) {
    const endpoint = (process.env.LIBRETRANSLATE_URL || 'https://libretranslate.de').replace(/\/$/, '');
    const payload = { q: input, source: source || 'auto', target, format: 'text' };
    if (process.env.LIBRETRANSLATE_API_KEY) payload.api_key = process.env.LIBRETRANSLATE_API_KEY;
    const response = await axios.post(`${endpoint}/translate`, payload, { timeout: 20000, headers: { 'Content-Type': 'application/json' } });
    if (!response.data?.translatedText) throw new Error('Translation service returned no translated text.');
    return response.data.translatedText;
}

async function searchYouTube(query) {
    if (process.env.YOUTUBE_API_KEY) {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: { part: 'snippet', q: query, type: 'video', maxResults: 5, key: process.env.YOUTUBE_API_KEY }, timeout: 15000
        });
        return (response.data.items || []).map(item => ({ id: item.id?.videoId, title: item.snippet?.title, channel: item.snippet?.channelTitle, url: `https://www.youtube.com/watch?v=${item.id?.videoId}` }));
    }
    // Public Invidious instances; availability varies. This is a fallback, not an official YouTube API.
    const instances = (process.env.INVIDIOUS_INSTANCE_URLS || 'https://inv.nadeko.net,https://invidious.nerdvpn.de,https://invidious.privacyredirect.com').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
    let lastError;
    for (const instance of instances) {
        try {
            const response = await axios.get(`${instance}/api/v1/search`, { params: { q: query, type: 'video' }, timeout: 10000 });
            const rows = Array.isArray(response.data) ? response.data.filter(x => x.videoId).slice(0, 5) : [];
            if (rows.length) return rows.map(x => ({ id: x.videoId, title: x.title, channel: x.author, url: `https://www.youtube.com/watch?v=${x.videoId}` }));
        } catch (err) { lastError = err; }
    }
    throw new Error(`YouTube search is unavailable right now${lastError ? ` (${lastError.message})` : ''}. Configure YOUTUBE_API_KEY for a more reliable official API.`);
}

// Send due reminders once after a successful DB connection; MongoDB status prevents duplicate sends.
let reminderWorkerStarted = false;
function startReminderWorker() {
    if (reminderWorkerStarted) return;
    reminderWorkerStarted = true;
    setInterval(async () => {
        if (mongoose.connection.readyState !== 1 || !sock?.user) return;
        try {
            const due = await Reminder.findOneAndUpdate(
                { status: 'pending', dueAt: { $lte: new Date() } },
                { $set: { status: 'sent' } },
                { sort: { dueAt: 1 }, new: true }
            );
            if (due) {
                try {
                    await sock.sendMessage(due.chatJid, { text: `⏰ *JARVIS REMINDER*\n\n${due.text}\n\n_Reminder ID: ${due._id}_` });
                } catch (sendErr) {
                    await Reminder.updateOne({ _id: due._id, status: 'sent' }, { $set: { status: 'pending' } });
                    console.log('Reminder delivery failed:', sendErr.message);
                }
            }
        } catch (err) { console.log('Reminder worker error:', err.message); }
    }, 15000).unref?.();
}

async function getTTSMode(chatJid) {
    try {
        if (!chatJid || mongoose.connection.readyState !== 1) return false;
        const pref = await TTSPreference.findOne({ chatJid }).lean();
        return !!pref?.enabled;
    } catch (err) {
        console.log('TTS preference read error:', err.message);
        return false;
    }
}

async function setTTSMode(chatJid, enabled) {
    if (!chatJid) throw new Error('Chat ID is missing.');
    if (mongoose.connection.readyState !== 1) throw new Error('MongoDB is not connected, so the voice preference cannot be saved persistently.');
    await TTSPreference.findOneAndUpdate(
        { chatJid },
        { $set: { enabled: !!enabled, updatedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

function extractTTSPlainText(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' code omitted ')
        .replace(/[*_~`]/g, '')
        .replace(/https?:\/\/\S+/g, 'link')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

async function sendAIReply(jid, text, quotedMessage = null) {
    const cleanText = String(text || '').trim();
    const sendOptions = quotedMessage ? { quoted: quotedMessage } : undefined;
    if (!cleanText) return sock.sendMessage(jid, { text: '⚠️ I received an empty reply.' }, sendOptions);

    if (await getTTSMode(jid)) {
        const speechText = extractTTSPlainText(cleanText);
        // Kiprio's no-key demo endpoint is the default; TTS_API_URL can override it.
        const endpoint = String(process.env.TTS_API_URL || 'https://kiprio.com/v1/tts/demo').trim();
        if (endpoint && speechText) {
            try {
                const headers = { 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/*, application/json' };
                // Kiprio's demo endpoint requires no key. If using its authenticated endpoint,
                // pass the key in X-API-Key as required by Kiprio's API documentation.
                if (process.env.TTS_API_KEY) headers['X-API-Key'] = process.env.TTS_API_KEY;
                const response = await axios.post(endpoint, {
                    text: speechText,
                    lang: process.env.TTS_API_LANG || 'en',
                    slow: String(process.env.TTS_API_SLOW || 'false').toLowerCase() === 'true'
                }, {
                    headers,
                    responseType: 'arraybuffer',
                    timeout: Number(process.env.TTS_API_TIMEOUT_MS) || 45000,
                    maxContentLength: 20 * 1024 * 1024
                });

                let audio = Buffer.from(response.data || []);
                let mimeType = String(response.headers?.['content-type'] || '').split(';')[0].trim();
                if (mimeType.includes('application/json')) {
                    let payload;
                    try { payload = JSON.parse(audio.toString('utf8')); } catch { payload = null; }
                    const encoded = payload?.audio || payload?.audio_base64 || payload?.data;
                    if (typeof encoded !== 'string' || !encoded.trim()) {
                        throw new Error('TTS JSON response did not contain a base64 audio field.');
                    }
                    audio = Buffer.from(encoded.replace(/^data:audio\/[^;]+;base64,/i, ''), 'base64');
                    mimeType = payload?.mimeType || payload?.mime_type || 'audio/mpeg';
                }
                if (!audio.length) throw new Error('TTS returned an empty audio file.');

                const isOpusOgg = /audio\/ogg/i.test(mimeType) &&
                    (/opus/i.test(mimeType) || String(process.env.TTS_API_FORMAT || '').toLowerCase() === 'opus');
                await sock.sendMessage(jid, {
                    audio,
                    mimetype: mimeType || ((process.env.TTS_API_FORMAT || 'mp3').toLowerCase() === 'wav' ? 'audio/wav' : 'audio/mpeg'),
                    // WhatsApp voice-note mode requires compatible OGG/Opus audio.
                    ptt: process.env.TTS_API_PTT === 'true' && isOpusOgg
                }, sendOptions);
                return;
            } catch (err) {
                const detail = err.response?.data
                    ? Buffer.from(err.response.data).toString('utf8').slice(0, 300)
                    : err.message;
                console.log('Self-hosted TTS failed; falling back to text:', detail);
            }
        } else {
            console.log('Voice replies are enabled but TTS_API_URL is missing or there is no speakable text.');
        }
    }
    return sendWithTyping(jid, { text: cleanText }, quotedMessage);
}

if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => { console.log('✅ MongoDB Connected'); startReminderWorker(); })
        .catch(err => console.log('❌ DB Error:', err.message));
}


// --- AI FUNCTION ---
async function askAI(prompt, base64Media = null, isPDF = false) {
    try {
        const endpoint = isPDF ? 'pdf' : 'ai';

        const payload = {
            prompt,
            ...(isPDF ? { fileBase64: base64Media } : { image: base64Media })
        };

        const res = await axios.post(
            `https://flexieduconsult-ai-link-wqnb.onrender.com/${endpoint}`,
            payload
        );

        return res.data?.result || "🤖 No response from AI";
    } catch (err) {
        console.log("AI LINK ERROR:", err.message);
        return "⚠️ AI service unavailable.";
    }
}

// Build a stable memory boundary: each person's DM is separate, and
// group history is separate per participant within that specific group.
function getMemoryConversationKey(chatJid, userJid) {
    return `${String(chatJid || 'unknown-chat')}::${String(userJid || 'unknown-user')}`;
}

async function getConversationContext(chatJid, userJid, limit = 12) {
    try {
        if (mongoose.connection.readyState !== 1 || !chatJid || !userJid) return '';
        const conversationKey = getMemoryConversationKey(chatJid, userJid);
        const messages = await MemoryMessage.find({ conversationKey })
            .sort({ createdAt: -1 })
            .limit(Math.max(2, Math.min(Number(limit) || 12, 20)))
            .lean();
        if (!messages.length) return '';
        return messages.reverse().map(item =>
            `${item.role === 'assistant' ? 'JARVIS' : 'USER'}: ${item.content}`
        ).join('\n');
    } catch (err) {
        console.log('⚠️ Memory read error:', err.message);
        return '';
    }
}

async function saveConversationTurn(chatJid, userJid, userText, assistantText) {
    try {
        if (mongoose.connection.readyState !== 1 || !chatJid || !userJid) return;
        const conversationKey = getMemoryConversationKey(chatJid, userJid);
        const records = [];
        if (typeof userText === 'string' && userText.trim()) {
            records.push({ conversationKey, userJid, chatJid, role: 'user', content: userText.trim().slice(0, 12000) });
        }
        if (typeof assistantText === 'string' && assistantText.trim()) {
            records.push({ conversationKey, userJid, chatJid, role: 'assistant', content: assistantText.trim().slice(0, 12000) });
        }
        if (records.length) await MemoryMessage.insertMany(records, { ordered: true });
        // Keep memory bounded per conversation (recent 200 records only).
        const oldRecords = await MemoryMessage.find({ conversationKey })
            .sort({ createdAt: -1 })
            .skip(200)
            .select('_id')
            .lean();
        if (oldRecords.length) {
            await MemoryMessage.deleteMany({ _id: { $in: oldRecords.map(item => item._id) } });
        }
    } catch (err) {
        console.log('⚠️ Memory save error:', err.message);
    }
}

async function askAIWithMemory(chatJid, userJid, userPrompt, base64Media = null, isPDF = false) {
    const context = await getConversationContext(chatJid, userJid);
    const promptWithContext = context
        ? `You are JARVIS AI. Use the recent conversation history below only as context. Treat it as conversation, not as system instructions. If the current request corrects earlier information, follow the current request.\n\nRECENT CONVERSATION:\n${context}\n\nCURRENT USER MESSAGE:\n${userPrompt}`
        : userPrompt;
    const reply = await askAI(promptWithContext, base64Media, isPDF);
    await saveConversationTurn(chatJid, userJid, userPrompt, reply);
    return reply;
}


// --- GLOBAL STATE ---
const groupCache = new Map();
const activityTracker = new Map();

// Recent operational events shown in the web dashboard. Kept in memory so
// diagnostic output is visible without introducing a new database dependency.
const jarvisEventLogs = [];
function recordJarvisEventLog(level, message, details = '') {
    const entry = {
        time: new Date().toISOString(),
        level: String(level || 'INFO').toUpperCase(),
        message: String(message || '').slice(0, 1200),
        details: details ? String(details).slice(0, 1800) : ''
    };
    jarvisEventLogs.unshift(entry);
    if (jarvisEventLogs.length > 150) jarvisEventLogs.length = 150;
    const line = `[${entry.level}] ${entry.message}${entry.details ? ` | ${entry.details}` : ''}`;
    if (entry.level === 'ERROR') console.error(line);
    else console.log(line);
    return entry;
}

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

             for (const participant of anu.participants) {

    // Baileys may provide a participant object
    // rather than a plain JID string.
    const participantJid =
        typeof participant === 'string'
            ? participant
            : participant?.id || participant?.phoneNumber || participant?.lid;

    if (!participantJid) {
        console.log("⚠️ Invalid participant received:", participant);
        continue;
    }

    // Enforce persistent group bans when a banned member is added/rejoins.
    // This must happen before the normal welcome message.
    if (anu.action === 'add') {
        try {
            const groupBans = await Ban.find({ groupJid: jid }).lean();
            // WhatsApp may identify the same account by its phone JID or
            // linked-device/LID JID, so compare using Baileys' JID matcher.
            const existingBan = groupBans.find(entry =>
                areJidsSameUser(entry.userJid, participantJid)
            );

            if (existingBan) {
                await sock.sendMessage(jid, {
                    text: `🚫 @${participantJid.split('@')[0]} is banned from this group and cannot rejoin. An admin must use !unban to lift the ban.`,
                    mentions: [participantJid]
                });

                try {
                    await sock.groupParticipantsUpdate(jid, [participantJid], 'remove');
                } catch (removeErr) {
                    console.log('❌ Could not remove banned rejoining member:', removeErr.message);
                    await sock.sendMessage(jid, {
                        text: '⚠️ A banned member rejoined, but I could not remove them. Please confirm that JARVIS is a group admin.'
                    });
                }
                continue;
            }
        } catch (banCheckErr) {
            // Fail closed for this join event: do not welcome a participant
            // when the ban database cannot be checked.
            console.log('❌ Ban enforcement lookup failed:', banCheckErr.message);
            await sock.sendMessage(jid, {
                text: '⚠️ I could not verify this member against the group ban list. Please ask an admin to check the ban system.'
            }).catch(() => {});
            continue;
        }
    }

    // Don't greet JARVIS itself
    const botJid = sock.user?.id?.split(':')[0];

    if (
        botJid &&
        (
            participantJid === `${botJid}@s.whatsapp.net` ||
            participantJid === `${botJid}@lid`
        )
    ) {
        continue;
    }

    const userTag = participantJid.split('@')[0];

    if (anu.action === 'add') {

        await sock.sendMessage(jid, {
            text:
`👋 Hi @${userTag}, welcome to *${groupName}*! 🎉

This group was created for JAMB, WAEC & JUPEB candidates.

📌 *GROUP RULES*
• Don't post links.
• Abusive words are not allowed.
• Respect all members and admins.
• No spam or unnecessary messages.
• Keep discussions relevant to the purpose of the group.

📚 *JOIN YOUR DEPARTMENT GROUP*

🔬 *SCIENCE DEPARTMENT*
https://chat.whatsapp.com/FE7tVCSQgim7uUJouZqtmy

💼 *COMMERCIAL DEPARTMENT*
https://chat.whatsapp.com/FnOcPasgCi6LuMCSheF8LT

📖 *ART DEPARTMENT*
https://chat.whatsapp.com/CrrJvOI3mz3JhqMNBd7bVy

🤖 *JARVIS AI*
_Powered by ${POWERED_BY}_`,
            mentions: [participantJid]
        });

    } else if (anu.action === 'remove') {

        await sock.sendMessage(jid, {
            text:
`👋 Goodbye @${userTag}

We wish you success ahead from *${groupName}* 🎓`,
            mentions: [participantJid]
        });
    }
}
        } catch (err) {
            console.log("Automation Error:", err.message);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m?.message) return;

    const jid = m.key.remoteJid;
    const earlyBody =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        '';
    const earlyCommand = earlyBody.trim().split(/\s+/)[0].toLowerCase();
    const ownerUtilityCommands = new Set([
        '!addxxjarvis',
        '!groupids',
        '!getgroupids'
    ]);

    // Keep ignoring the bot's own ordinary messages. Only these owner utility
    // commands may pass through when they are issued from self-chat.
    if (m.key.fromMe && !ownerUtilityCommands.has(earlyCommand)) return;

    const sender = m.key.participant || (m.key.fromMe ? sock.user?.id : m.key.remoteJid);

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

    // Operational commands: text commands and common natural-language aliases.
    // Keep this block before the general conversational router so diagnostics are deterministic.
    const normalizedOperationalText = msgLower.replace(/[.!?]+$/g, '').trim();


    // ============================================================
    // SEVEN REQUESTED FEATURE GROUPS: crawl, sitecheck, reminders,
    // translation, TTS (below), health (below), and YouTube.
    // Each handler returns before the general AI conversation router.
    // ============================================================
    const operationalReply = async (text) => sendWithTyping(jid, { text }, m);

    // Website availability checker: !sitecheck URL or natural language.
    let sitecheckUrl = null;
    const sitecheckMatch = rawMsgCheck.match(/^!sitecheck\s+(\S+)/i);
    if (sitecheckMatch) sitecheckUrl = sitecheckMatch[1];
    else if (/^(?:check|test)\s+(?:whether\s+)?(?:if\s+)?(?:this\s+)?website\s+(?:is\s+)?(?:online|up|available)\s*[:：]?\s*https?:\/\/\S+/i.test(rawMsgCheck)) sitecheckUrl = rawMsgCheck.match(/https?:\/\/\S+/i)?.[0];
    if (sitecheckUrl) {
        try {
            const result = await checkWebsite(sitecheckUrl, false);
            await operationalReply(`🌐 *WEBSITE CHECK*\n\nURL: ${result.url}\nStatus: ${result.status ?? 'No HTTP response'}\nAvailability: ${result.reachable ? '🟢 Reachable' : '🔴 Unreachable'}\nResponse time: ${result.ms} ms${result.error ? `\nError: ${result.error}` : ''}`);
        } catch (err) { await operationalReply(`⚠️ Website check failed: ${err.message}`); }
        return;
    }

    // Website crawler: inspect metadata and capture a screenshot of the rendered page.
    let crawlUrl = null;
    const crawlMatch = rawMsgCheck.match(/^!crawl\s+(\S+)/i);
    if (crawlMatch) crawlUrl = crawlMatch[1];
    else if (/^(?:crawl|inspect|summarize)\s+(?:this\s+)?website\s+https?:\/\/\S+/i.test(rawMsgCheck)) crawlUrl = rawMsgCheck.match(/https?:\/\/\S+/i)?.[0];
    if (crawlUrl) {
        try {
            const result = await checkWebsite(crawlUrl, true);
            if (!result.reachable) throw new Error(`The website did not return a successful response (HTTP ${result.status ?? 'no response'}).`);
            const headings = result.headings?.length ? result.headings.map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No H1–H3 headings were found.';
            let screenshot = null;
            let screenshotError = '';
            try {
                screenshot = await captureWebsiteScreenshot(result.url);
            } catch (shotErr) {
                screenshotError = shotErr.message || 'Screenshot capture failed.';
                recordJarvisEventLog('WARN', 'Website screenshot capture failed', `${result.url}: ${screenshotError}`);
            }
            const summary = `🕸️ *WEBSITE CRAWL SUMMARY*\n\n*URL:* ${result.url}\n*HTTP:* ${result.status}\n*Title:* ${result.title || 'Not found'}\n*Description:* ${result.description || 'Not found'}\n*Headings:*\n${headings}\n\n${screenshot ? '📸 A screenshot of the rendered page is attached.' : `⚠️ Screenshot unavailable: ${screenshotError}`}\n\n_Note: this inspects the supplied public page; it does not crawl an entire site or bypass access controls._`;
            await operationalReply(summary);
            if (screenshot?.buffer?.length) {
                await sock.sendMessage(jid, {
                    image: screenshot.buffer,
                    caption: `📸 Website screenshot\n${screenshot.url}`
                }, { quoted: m });
            }
        } catch (err) {
            await operationalReply(`⚠️ Website crawl failed: ${err.message}`);
        }
        return;
    }

    // Reminders: !remind 30m message; natural language e.g. "remind me in 30m to ...".
    let reminderCreate = rawMsgCheck.match(/^!remind\s+(\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days))\s+([\s\S]+)$/i);
    if (!reminderCreate) reminderCreate = rawMsgCheck.match(/^remind me in\s+(\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days))\s+(?:to\s+)?([\s\S]+)$/i);
    if (reminderCreate) {
        try {
            if (mongoose.connection.readyState !== 1) throw new Error('MongoDB is not connected, so I cannot save reminders yet.');
            const delay = parseReminderDelay(reminderCreate[1]);
            const reminderText = reminderCreate[2].trim();
            if (!delay || !reminderText) throw new Error('Use a duration such as 30m, 2h, or 1d, followed by the reminder text.');
            const dueAt = new Date(Date.now() + delay);
            const reminder = await Reminder.create({ chatJid: jid, requesterJid: sender || '', text: reminderText.slice(0, 1000), dueAt });
            startReminderWorker();
            await operationalReply(`⏰ *Reminder saved*\n\n${reminderText}\nDue: ${dueAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} (Nigeria time)\nID: ${reminder._id}\n\nUse !reminders to list or !cancelreminder ${reminder._id} to cancel.`);
        } catch (err) { await operationalReply(`⚠️ Could not create reminder: ${err.message}`); }
        return;
    }
    if (/^!reminders$|^(?:show|list) my reminders$/i.test(normalizedOperationalText)) {
        try {
            if (mongoose.connection.readyState !== 1) throw new Error('MongoDB is not connected.');
            const rows = await Reminder.find({ chatJid: jid, status: 'pending' }).sort({ dueAt: 1 }).limit(20).lean();
            await operationalReply(rows.length ? `⏰ *YOUR PENDING REMINDERS*\n\n${rows.map((r, i) => `${i + 1}. ${r.text}\n   Due: ${new Date(r.dueAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}\n   ID: ${r._id}`).join('\n\n')}` : 'You have no pending reminders in this chat.');
        } catch (err) { await operationalReply(`⚠️ Could not list reminders: ${err.message}`); }
        return;
    }
    const cancelReminderMatch = rawMsgCheck.match(/^!cancelreminder\s+([a-f\d]{24})$/i) || rawMsgCheck.match(/^cancel reminder\s+([a-f\d]{24})$/i);
    if (cancelReminderMatch) {
        try {
            if (mongoose.connection.readyState !== 1) throw new Error('MongoDB is not connected.');
            const result = await Reminder.updateOne({ _id: cancelReminderMatch[1], chatJid: jid, status: 'pending' }, { $set: { status: 'cancelled' } });
            await operationalReply(result.modifiedCount ? '✅ Reminder cancelled.' : 'I could not find a pending reminder with that ID in this chat.');
        } catch (err) { await operationalReply(`⚠️ Could not cancel reminder: ${err.message}`); }
        return;
    }

    // Translation: !translate English Yoruba text, or "translate ... to Yoruba: ...".
    let translationParts = rawMsgCheck.match(/^!translate\s+(\S+)\s+(\S+)\s+([\s\S]+)$/i);
    if (!translationParts) {
        const naturalTranslate = rawMsgCheck.match(/^translate\s+([\s\S]+?)\s+to\s+(English|Yoruba|Igbo|Hausa|French|Spanish|Arabic|Portuguese|German|Chinese|Japanese|Korean|Italian|Swahili)\s*[:：]?\s*["“]?([\s\S]+?)["”]?$/i);
        if (naturalTranslate) translationParts = [naturalTranslate[0], 'auto', naturalTranslate[2], naturalTranslate[3]];
    }
    if (translationParts) {
        try {
            const langCodes = { english: 'en', yoruba: 'yo', igbo: 'ig', hausa: 'ha', french: 'fr', spanish: 'es', arabic: 'ar', portuguese: 'pt', german: 'de', chinese: 'zh', japanese: 'ja', korean: 'ko', italian: 'it', swahili: 'sw', auto: 'auto' };
            const sourceLang = langCodes[String(translationParts[1]).toLowerCase()] || String(translationParts[1]).toLowerCase();
            const targetLang = langCodes[String(translationParts[2]).toLowerCase()] || String(translationParts[2]).toLowerCase();
            const translated = await translateText(sourceLang, targetLang, translationParts[3]);
            await operationalReply(`🌍 *TRANSLATION* (${translationParts[1]} → ${translationParts[2]})\n\n${translated}`);
        } catch (err) { await operationalReply(`⚠️ Translation failed: ${err.response?.data?.error || err.message}\nYou may configure LIBRETRANSLATE_URL and, if required, LIBRETRANSLATE_API_KEY in Render.`); }
        return;
    }

    // YouTube search: official API key preferred; public Invidious instances are fallback.
    let ytQuery = rawMsgCheck.match(/^!yt\s+search\s+([\s\S]+)$/i)?.[1];
    if (!ytQuery) ytQuery = rawMsgCheck.match(/^(?:search|find)\s+(?:for\s+)?(?:videos?\s+)?on youtube\s*[:：]?\s*([\s\S]+)$/i)?.[1];
    if (ytQuery) {
        try {
            const results = await searchYouTube(ytQuery.trim());
            await operationalReply(`▶️ *YOUTUBE SEARCH*\nQuery: ${ytQuery.trim()}\n\n${results.map((v, i) => `${i + 1}. *${v.title || 'Untitled video'}*\nChannel: ${v.channel || 'Unknown'}\n${v.url}`).join('\n\n')}`);
        } catch (err) { await operationalReply(`⚠️ YouTube search failed: ${err.message}`); }
        return;
    }
    const ytVideoMatch = rawMsgCheck.match(/^!yt\s+video\s+([\w-]{6,})$/i);
    if (ytVideoMatch) {
        const videoId = ytVideoMatch[1];
        await operationalReply(`▶️ *YOUTUBE VIDEO*\nhttps://www.youtube.com/watch?v=${videoId}\n\nI can provide the official video link. Downloading/rehosting the video is not part of this command.`);
        return;
    }
    // Persistent per-chat TTS toggle. Operational responses intentionally stay text.
    const ttsOnPhrases = ['switch on voice mode', 'turn on voice mode', 'enable voice replies', 'i want voice replies', 'reply with voice', 'start speaking', 'use voice replies'];
    const ttsOffPhrases = ['switch off voice mode', 'turn off voice mode', 'disable voice replies', 'stop speaking and reply with text', 'return to text mode', 'reply with text', 'stop voice replies'];
    if (['!tts on', '!tts enable'].includes(normalizedOperationalText) || ttsOnPhrases.includes(normalizedOperationalText)) {
        try {
            await setTTSMode(jid, true);
            await sendWithTyping(jid, { text: `🔊 *Voice replies enabled for this chat.*\nMy conversational/AI replies will be sent as voice notes. Use \`!tts off\` to return to text. Operational notices remain text.` }, m);
        } catch (err) {
            await sendWithTyping(jid, { text: `⚠️ Could not save the TTS setting: ${err.message}` }, m);
        }
        return;
    }
    if (['!tts off', '!tts disable'].includes(normalizedOperationalText) || ttsOffPhrases.includes(normalizedOperationalText)) {
        try {
            await setTTSMode(jid, false);
            await sendWithTyping(jid, { text: '💬 *Text replies restored for this chat.*' }, m);
        } catch (err) {
            await sendWithTyping(jid, { text: `⚠️ Could not save the TTS setting: ${err.message}` }, m);
        }
        return;
    }
    if (['!tts', '!tts status', 'voice mode status', 'is voice mode on'].includes(normalizedOperationalText)) {
        const enabled = await getTTSMode(jid);
        const configured = !!(process.env.TTS_API_URL || 'https://kiprio.com/v1/tts/demo');
        await sendWithTyping(jid, { text: `🎙️ *Voice reply status:* ${enabled ? 'ON 🔊' : 'OFF 💬'}\nTTS provider: Kiprio (${configured ? 'endpoint configured' : 'not configured'})\nEndpoint: ${process.env.TTS_API_URL || 'https://kiprio.com/v1/tts/demo'}\nAPI key: ${process.env.TTS_API_KEY ? 'configured (X-API-Key)' : 'not required for demo endpoint'}\nPreference scope: this chat` }, m);
        return;
    }
    if (['!status', 'jarvis health', 'jarvis system status', 'check jarvis health', 'how healthy is jarvis'].includes(normalizedOperationalText)) {
        const memory = process.memoryUsage();
        const dbReady = mongoose.connection.readyState === 1;
        const waReady = !!(sock && sock.user);
        const aiConfigured = !!process.env.AI_ENDPOINT || true; // Existing AI bridge is configured in source.
        const checks = [waReady, dbReady, aiConfigured, true, memory.heapUsed / Math.max(memory.heapTotal, 1) < 0.9];
        const health = Math.round(checks.filter(Boolean).length / checks.length * 100);
        const bar = '█'.repeat(Math.round(health / 10)) + '░'.repeat(10 - Math.round(health / 10));
        const statusLabel = health >= 95 ? 'Excellent' : health >= 85 ? 'Healthy' : health >= 70 ? 'Degraded' : health >= 40 ? 'Unstable' : 'Critical';
        const statusText = `🩺 *JARVIS SYSTEM HEALTH*\n\n*Health:* ${health}% (${statusLabel})\n[${bar}]\n\nWhatsApp: ${waReady ? '🟢 Connected' : '🔴 Disconnected'}\nMongoDB: ${dbReady ? '🟢 Connected' : '🔴 Disconnected'}\nAI bridge: ${aiConfigured ? '🟢 Configured' : '🔴 Not configured'}\nMemory heap: ${Math.round(memory.heapUsed / 1024 / 1024)} MB / ${Math.round(memory.heapTotal / 1024 / 1024)} MB\nUptime: ${Math.floor(process.uptime() / 60)} minutes\n\n_Note: this is a lightweight process check, not a full synthetic service test._`;
        await sendWithTyping(jid, { text: statusText }, m);
        return;
    }

    if (['!healthgraph', 'send jarvis health graph', 'show jarvis health graph', 'jarvis health graph'].includes(normalizedOperationalText)) {
        try {
            const memory = process.memoryUsage();
            const wa = sock && sock.user ? 100 : 0;
            const db = mongoose.connection.readyState === 1 ? 100 : 0;
            const heap = Math.max(0, Math.min(100, Math.round((1 - memory.heapUsed / Math.max(memory.heapTotal, 1)) * 100)));
            const chartConfig = { type: 'line', data: { labels: ['WhatsApp', 'Database', 'Memory headroom'], datasets: [{ label: 'Health (%)', data: [wa, db, heap], borderColor: '#00d9ff', backgroundColor: 'rgba(0,217,255,0.2)', fill: true, tension: 0.35 }] }, options: { title: { display: true, text: 'JARVIS AI — Current Health Snapshot' }, legend: { display: false }, scales: { yAxes: [{ ticks: { min: 0, max: 100 } }] } } };
            const chartUrl = 'https://quickchart.io/chart';
            const response = await axios.post(chartUrl, { chart: chartConfig, width: 900, height: 500, format: 'png', backgroundColor: '#07111f' }, { responseType: 'arraybuffer', timeout: 15000 });
            await sock.sendMessage(jid, { image: Buffer.from(response.data), caption: '📈 *JARVIS AI health snapshot*\nCurrent service checks; this is a snapshot, not a historical moving graph.' }, { quoted: m });
        } catch (error) {
            recordJarvisEventLog('ERROR', 'Health graph generation failed', error.message);
            await sendWithTyping(jid, { text: '⚠️ I could not generate the health graph right now. Please try again shortly.' }, m);
        }
        return;
    }

    // Rename a group by ID: !groupname <group-id> <new name>. Only the bot's
    // own WhatsApp group-admin status is required by WhatsApp for this action.
    const groupNameMatch = rawMsgCheck.match(/^!groupname\s+(\d{5,}-(?:\d+)?@g\.us|[0-9-]+@g\.us)\s+([\s\S]+)$/i);
    if (groupNameMatch) {
        const targetGroupJid = groupNameMatch[1].includes('@g.us') ? groupNameMatch[1] : `${groupNameMatch[1]}@g.us`;
        const newSubject = groupNameMatch[2].trim().slice(0, 100);
        try {
            if (!sock?.user) throw new Error('WhatsApp is not connected.');
            const metadata = await sock.groupMetadata(targetGroupJid);
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const botParticipant = metadata.participants?.find(x => x.id === sock.user.id || x.id?.split(':')[0] === botJid.split('@')[0]);
            if (!botParticipant?.admin) throw new Error('Jarvis must be a group admin to change this group name.');
            await sock.groupUpdateSubject(targetGroupJid, newSubject);
            recordJarvisEventLog('INFO', 'Group subject updated', `${targetGroupJid} -> ${newSubject}`);
            await sendWithTyping(jid, { text: `✅ Group name updated to *${newSubject}*.\nGroup ID: ${targetGroupJid}` }, m);
        } catch (error) {
            await sendWithTyping(jid, { text: `❌ Could not update group name: ${error.message}` }, m);
        }
        return;
    }

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
    const isOwner = String(sender || '').includes(OWNER_NUMBER) || (m.key.fromMe && ownerUtilityCommands.has(earlyCommand));
     
  
    // ============================================================
// 🗓️ PHASE 3 — DEPARTMENT TIMETABLE SYSTEM
// ============================================================

const departmentTimetables = {
    science: {
        name: "SCIENCE DEPARTMENT",
        emoji: "🔬",
        image: "https://i.postimg.cc/9f7K6kfy/IMG-20260920-004437-377.png"
    },

    commercial: {
        name: "COMMERCIAL DEPARTMENT",
        emoji: "💼",
        image: "https://i.postimg.cc/rpr3BHp1/IMG-20260920-004448-295.png"
    },

    art: {
        name: "ART DEPARTMENT",
        emoji: "📖",
        image: "https://i.postimg.cc/MGQNCLGb/IMG-20260920-004500-164.png"
    }
};

const timetableText = body.trim().toLowerCase();

let selectedDepartment = null;

// ============================================================
// 🔬 SCIENCE
// ============================================================
if (
    /\bscience\b/.test(timetableText) &&
    /\b(timetable|schedule|class|classes)\b/.test(timetableText)
) {
    selectedDepartment = departmentTimetables.science;
}

// ============================================================
// 💼 COMMERCIAL
// ============================================================
else if (
    /\b(commercial|commerce)\b/.test(timetableText) &&
    /\b(timetable|schedule|class|classes)\b/.test(timetableText)
) {
    selectedDepartment = departmentTimetables.commercial;
}

// ============================================================
// 📖 ART
// ============================================================
else if (
    /\b(art|arts)\b/.test(timetableText) &&
    /\b(timetable|schedule|class|classes)\b/.test(timetableText)
) {
    selectedDepartment = departmentTimetables.art;
}

// ============================================================
// 🗓️ GENERAL TIMETABLE REQUEST
// ============================================================

const isGeneralTimetableRequest = [
    /^!timetable$/i,
    /^timetable$/i,
    /^show timetable$/i,
    /^show me the timetable$/i,
    /^send timetable$/i,
    /^send me the timetable$/i,
    /^what is the timetable\??$/i,
    /^what's the timetable\??$/i,
    /^what is the schedule\??$/i,
    /^class timetable$/i
].some(pattern => pattern.test(timetableText));

if (isGeneralTimetableRequest && !selectedDepartment) {
    await sendWithTyping(
        jid,
        {
            text:
`🗓️ *TUTORIAL TIMETABLE*

Please specify your department:

🔬 *Science Department*
💼 *Commercial Department*
📖 *Art Department*

You can ask:

• "Science timetable"
• "Commercial timetable"
• "Art timetable"

🤖 *JARVIS AI*
_Powered by ${POWERED_BY}_`
        },
        m
    );

    return;
}

// ============================================================
// 📸 SEND DEPARTMENT TIMETABLE
// ============================================================

if (selectedDepartment) {
    try {
        const response = await axios.get(
            selectedDepartment.image,
            {
                responseType: "arraybuffer"
            }
        );

        await sendWithTyping(
            jid,
            {
                image: Buffer.from(response.data),
                caption:
`🗓️ *${selectedDepartment.emoji} ${selectedDepartment.name}*

📚 Here is your tutorial timetable.

🤖 *JARVIS AI*
_Powered by ${POWERED_BY}_`
            },
            m
        );

        return;

    } catch (err) {
        console.log(
            "❌ Timetable System Error:",
            err.message
        );

        await sock.sendMessage(
            jid,
            {
                text:
`❌ Sorry, I couldn't load the *${selectedDepartment.name}* timetable right now.

Please try again later.`
            },
            { quoted: m }
        );

        return;
    }
}

    // ============================================================
// 🕐 JARVIS TIME SYSTEM — AFRICA/LAGOS
// ------------------------------------------------------------
// Uses the server's clock and converts it to Nigeria time.
// No external API call is required.
// ============================================================

const timeQueryPatterns = [
    /^!time$/i,
    /^time$/i,
    /^time now$/i,
    /^what time is it\??$/i,
    /^what's the time\??$/i,
    /^what is the time\??$/i,
    /^what is the current time\??$/i,
    /^what's the current time\??$/i,
    /^current time\??$/i,
    /^tell me the time\??$/i,
    /^jarvis,?\s+what time is it\??$/i,
    /^jarvis,?\s+what's the time\??$/i,
    /^jarvis,?\s+what is the time\??$/i
];

const isTimeQuery = timeQueryPatterns.some(
    pattern => pattern.test(body.trim())
);

if (isTimeQuery) {
    try {
        const now = new Date();

        const nigeriaTime = now.toLocaleTimeString("en-NG", {
            timeZone: "Africa/Lagos",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });

        const nigeriaDate = now.toLocaleDateString("en-NG", {
            timeZone: "Africa/Lagos",
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        });

        const timeReply =
`🕐 *Current Time*

🇳🇬 *Nigeria:* ${nigeriaTime}

📅 ${nigeriaDate}

🤖 *JARVIS AI*
_Powered by ${POWERED_BY}_`;

        await sendWithTyping(
            jid,
            { text: timeReply },
            m
        );

        return;

    } catch (err) {
        console.log("❌ Time System Error:", err.message);

        await sock.sendMessage(
            jid,
            {
                text: "❌ I couldn't determine the current time."
            },
            { quoted: m }
        );

        return;
    }
}

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
            await askAIWithMemory(
                jid,
                sender,
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
            await askAIWithMemory(
                jid,
                sender,
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
            await askAIWithMemory(
                jid,
                sender,
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
        

    let command = text.split(/ +/)[0];
const args = body.trim().split(/ +/).slice(1);


// ============================================================
// 🧠 JARVIS LIVE QUIZ COMMAND SYSTEM
// ------------------------------------------------------------
// Usage:
//
// !quiz Mathematics
// !quiz English
// !quiz Chemistry
// !quiz Physics
// !quiz Biology
// !quiz Commerce
// !quiz Government
// !quiz Economics
// !quiz Accounting
// !quiz Literature in English
// !quiz Geography
// !quiz Civic Education
// !quiz CRK
// !quiz IRK
// !quiz Insurance
// !quiz History
//
// The actual subject → ALOC slug mapping is handled by
// quizEngine.js.
// ============================================================

if (
    command === "!quiz"
) {

    try {

        // ----------------------------------------------------
        // QUIZ MUST BE STARTED INSIDE A GROUP
        // ----------------------------------------------------

        if (
            !jid ||
            !jid.endsWith("@g.us")
        ) {

            await sendWithTyping(
                jid,
                {
                    text:
`❌ *QUIZ COMMAND*

The live quiz can only be started inside a WhatsApp group.

Example:

*!quiz Mathematics*`
                },
                m
            );

            return;

        }


        // ----------------------------------------------------
        // SUBJECT WAS NOT PROVIDED
        // ----------------------------------------------------

        if (
            !args.length
        ) {

            const subjects =
                quizEngine
                    .getAvailableSubjects()
                    .map(
                        subject =>
                            `• ${subject.name}`
                    )
                    .join("\n");


            await sendWithTyping(
                jid,
                {
                    text:
`🧠 *JARVIS LIVE QUIZ*

Please specify the subject you want to quiz.

📚 *AVAILABLE SUBJECTS*

${subjects}

Example:

*!quiz Mathematics*

*!quiz Government*

*!quiz Literature in English*`
                },
                m
            );

            return;

        }


        // ----------------------------------------------------
        // SUPPORT SUBJECT NAMES CONTAINING SPACES
        // ----------------------------------------------------
        //
        // !quiz Literature in English
        // !quiz Civic Education
        // !quiz Financial Accounting
        //
        // Everything after !quiz is treated as the
        // requested subject.
        // ----------------------------------------------------

        const requestedSubject =
            args
                .join(" ")
                .trim();


        console.log(
            "🧠 QUIZ COMMAND RECEIVED:",
            requestedSubject
        );


        // ----------------------------------------------------
        // RESOLVE SUBJECT THROUGH quizEngine.js
        // ----------------------------------------------------

        const resolvedSubject =
            quizEngine.resolveSubject(
                requestedSubject
            );


        if (
            !resolvedSubject
        ) {

            const subjects =
                quizEngine
                    .getAvailableSubjects()
                    .map(
                        subject =>
                            `• ${subject.name}`
                    )
                    .join("\n");


            await sendWithTyping(
                jid,
                {
                    text:
`❌ *UNKNOWN QUIZ SUBJECT*

I couldn't find:

*"${requestedSubject}"*

📚 *AVAILABLE SUBJECTS*

${subjects}

Example:

*!quiz Mathematics*

*!quiz English*

*!quiz Government*`
                },
                m
            );

            return;

        }


        // ----------------------------------------------------
        // START THE QUIZ
        // ----------------------------------------------------

        await sendWithTyping(
            jid,
            {
                text:
`⏳ *JARVIS QUIZ SYSTEM*

Preparing *${resolvedSubject.name}* questions...

📚 Subject:
*${resolvedSubject.name}*

🔗 ALOC:
\`${resolvedSubject.slug}\`

Please wait...`
            },
            m
        );


        const result =
            await quizEngine.fireQuiz(
                sock,
                {
                    subject:
                        resolvedSubject.slug,

                    groupJid:
                        jid
                }
            );


        // ----------------------------------------------------
        // QUIZ ENGINE ERROR
        // ----------------------------------------------------

        if (
            !result ||
            !result.success
        ) {

            console.log(
                "❌ QUIZ ENGINE FAILED:",
                result
            );


            await sendWithTyping(
                jid,
                {
                    text:
`❌ *QUIZ COULD NOT START*

Subject:
*${resolvedSubject.name}*

Reason:
${result?.error || "Unknown quiz engine error"}

Please check the ALOC configuration and try again.`
                },
                m
            );

            return;

        }


        // ----------------------------------------------------
        // SUCCESS
        // ----------------------------------------------------
        //
        // fireQuiz() already sends the first question.
        // We therefore do NOT send another question here.
        // ----------------------------------------------------

        console.log(
            `✅ QUIZ STARTED SUCCESSFULLY: ${result.subject} → ${result.subjectSlug}`
        );


        return;


    } catch (err) {

        console.log(
            "❌ QUIZ COMMAND ERROR:",
            err.message
        );


        await sock.sendMessage(
            jid,
            {
                text:
`⚠️ *QUIZ SYSTEM ERROR*

Something went wrong while starting the quiz.

Error:
${err.message}`
            },
            {
                quoted:
                    m
            }
        );


        return;

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
        const isTryingAdminAction = ["!kick", "!ban", "!unban", "!promote", "!mute", "!unmute", "!reset", "!add"].includes(command);

        if (!metadata || Date.now() - (metadata.lastFetch || 0) > 3000 || isTryingAdminAction) {
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
        // BAN MEMBER
        // =========================
        {
            name: "ban",
            patterns: [
                /^ban .+/i,
                /^ban (this )?(user|person|member)$/i,
                /^ban (him|her|them)$/i,
                /^permanently ban .+/i,
                /^block .+ from (this )?group$/i,
                /^prevent .+ from (re)?joining (this )?group$/i,
                /^do not allow .+ (back )?into (this )?group$/i
            ]
        },

        // =========================
        // UNBAN MEMBER
        // =========================
        {
            name: "unban",
            patterns: [
                /^unban .+/i,
                /^unban (this )?(user|person|member)$/i,
                /^unban (him|her|them)$/i,
                /^lift (the )?ban on .+/i,
                /^remove the ban on .+/i,
                /^allow .+ to rejoin (this )?group$/i,
                /^let .+ rejoin (this )?group$/i,
                /^allow .+ back into (this )?group$/i
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
        ban: "!ban",
        unban: "!unban",
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


    if (natural === "ban" || natural === "unban") {
        // If the natural-language request contains a phone number rather
        // than an @mention or quoted member, pass the number to the handler.
        const numberMatch = naturalText.match(/\+?\d[\d\s()-]{6,}/);
        if (numberMatch) {
            args.splice(0, args.length, numberMatch[0].replace(/\D/g, ""));
        }
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
        natural === "ban" ||
        natural === "unban" ||
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

                const aiReply = await askAIWithMemory(
                    jid,
                    sender,
                    body || `Please analyze this file: ${fileName}`,
                    base64Media
                );

                return sendAIReply(jid, `🎓 *GROUP STUDY ASSISTANT*\n\n${aiReply}`, m);

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
    const content = await askAIWithMemory(jid, sender, contentPrompt);

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
🔸 *!ban @user* - Ban member and block rejoining
🔸 *!unban @user* - Lift a member's ban
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

    const actualPrompt = prompt || "Analyze this image clearly.";
    const aiReply = await askAIWithMemory(
        jid,
        sender,
        actualPrompt,
        base64Image
    );

    return sendAIReply(jid, `🤖 *JARVIS AI*\n\n${aiReply}`, m);
}

// --- BAN / UNBAN MEMBER ---
if (command === "!ban" || command === "!unban") {
    if (!jid || !jid.endsWith("@g.us")) {
        return sock.sendMessage(jid, {
            text: "❌ !ban and !unban can only be used inside a WhatsApp group."
        }, { quoted: m });
    }

    if (!isStaff) {
        return sock.sendMessage(jid, {
            text: "❌ This command is restricted to group admins."
        }, { quoted: m });
    }

    const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
        m.message?.imageMessage?.contextInfo ||
        m.message?.videoMessage?.contextInfo ||
        m.message?.documentMessage?.contextInfo ||
        {};
    let target = contextInfo.mentionedJid?.[0] || contextInfo.participant || null;

    if (!target && args[0]) {
        const digits = String(args[0]).replace(/[^0-9]/g, '');
        if (digits.length >= 7) {
            const normalized = digits.startsWith('0')
                ? `234${digits.slice(1)}`
                : digits;
            target = `${normalized}@s.whatsapp.net`;
        }
    }

    if (!target) {
        const verb = command === "!ban" ? "ban" : "unban";
        return sock.sendMessage(jid, {
            text: `❌ Please mention the member, reply to their message, or provide their phone number.\n\nExample: *!${verb} @user*`
        }, { quoted: m });
    }

    if (areJidsSameUser(target, sock.user?.id || '') || target.includes(OWNER_NUMBER)) {
        return sock.sendMessage(jid, {
            text: "❌ I can't ban or unban the bot or its owner."
        }, { quoted: m });
    }

    try {
        if (command === "!ban") {
            const existingGroupBans = await Ban.find({ groupJid: jid }).lean();
            const alreadyBanned = existingGroupBans.find(entry =>
                areJidsSameUser(entry.userJid, target)
            );

            if (alreadyBanned) {
                return sock.sendMessage(jid, {
                    text: `ℹ️ @${target.split('@')[0]} is already banned from this group.`,
                    mentions: [target]
                }, { quoted: m });
            }

            await Ban.updateOne(
                { groupJid: jid, userJid: target },
                { $set: { bannedBy: sender, createdAt: new Date() } },
                { upsert: true }
            );

            // Remove them now if they are currently in the group.
            const targetIsMember = (metadata?.participants || []).some(p =>
                areJidsSameUser(p.id || p.phoneNumber || '', target)
            );

            if (targetIsMember) {
                try {
                    await sock.groupParticipantsUpdate(jid, [target], "remove");
                } catch (removeErr) {
                    // Keep the ban record even if immediate removal fails:
                    // rejoin enforcement will still apply if the database is available.
                    console.log("❌ Ban recorded but immediate removal failed:", removeErr.message);
                    return sock.sendMessage(jid, {
                        text: `⚠️ The ban for @${target.split('@')[0]} was saved, but I couldn't remove them. Please confirm that JARVIS is a group admin.`,
                        mentions: [target]
                    }, { quoted: m });
                }
            }

            return sock.sendMessage(jid, {
                text: `🚫 *MEMBER BANNED*\n\n@${target.split('@')[0]} has been banned from this group. If they rejoin, I will attempt to remove them automatically.\n\nUse *!unban @user* to lift this ban.`,
                mentions: [target]
            }, { quoted: m });
        }

        const existingGroupBans = await Ban.find({ groupJid: jid }).lean();
        const matchingBan = existingGroupBans.find(entry =>
            areJidsSameUser(entry.userJid, target)
        );
        const result = matchingBan
            ? await Ban.deleteOne({ _id: matchingBan._id })
            : { deletedCount: 0 };

        if (!result.deletedCount) {
            return sock.sendMessage(jid, {
                text: `ℹ️ @${target.split('@')[0]} does not have an active ban in this group.`,
                mentions: [target]
            }, { quoted: m });
        }

        return sock.sendMessage(jid, {
            text: `✅ *BAN LIFTED*\n\n@${target.split('@')[0]} is no longer banned from this group. They may rejoin if they have the group link or an admin adds them.`,
            mentions: [target]
        }, { quoted: m });

    } catch (err) {
        console.log("❌ Ban/Unban Error:", err.message);
        return sock.sendMessage(jid, {
            text: "❌ The ban operation failed because the database or WhatsApp group action returned an error. Please try again."
        }, { quoted: m });
    }
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

        // ============================================================
        // OWNER COMMAND: LIST GROUP IDS
        // !groupids and !getgroupids
        // In a group, return that group's ID. In DM/self-chat, list groups.
        // ============================================================
if (command === "!groupids" || command === "!getgroupids") {
    if (!isOwner) {
        recordJarvisEventLog('WARN', 'Unauthorized group-ID command attempt', `Chat: ${jid}; Sender: ${sender || 'unknown'}`);
        return sock.sendMessage(jid, {
            text: "❌ This command is restricted to the Jarvis owner."
        }, { quoted: m });
    }

    if (jid && jid.endsWith('@g.us')) {
        let groupName = jid;
        try {
            const currentMetadata = await sock.groupMetadata(jid);
            groupName = currentMetadata.subject || jid;
        } catch (err) {
            recordJarvisEventLog('WARN', 'Could not fetch current group name', `${jid}: ${err.message}`);
        }
        recordJarvisEventLog('INFO', 'Group ID requested inside a group', `${groupName} | ${jid}`);
        return sock.sendMessage(jid, {
            text: `📌 *GROUP ID*\n\nGroup: *${groupName}*\nID: ${jid}`
        }, { quoted: m });
    }

    try {
        if (typeof sock.groupFetchAllParticipating !== 'function') {
            throw new Error('This Baileys version does not expose groupFetchAllParticipating().');
        }
        const allGroups = await sock.groupFetchAllParticipating();
        const entries = Object.entries(allGroups || {})
            .filter(([groupJid]) => groupJid.endsWith('@g.us'))
            .map(([groupJid, group]) => ({
                jid: groupJid,
                name: group?.subject || groupJid,
                size: Array.isArray(group?.participants) ? group.participants.length : 0
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        recordJarvisEventLog('INFO', 'Group-ID list requested', `Groups returned: ${entries.length}`);
        if (!entries.length) {
            return sock.sendMessage(jid, {
                text: 'No participating WhatsApp groups were returned by the connection.'
            }, { quoted: m });
        }

        const header = `📚 *JARVIS GROUP IDS*\nGroups found: ${entries.length}\n\n`;
        const rows = entries.map((group, i) =>
            `${i + 1}. *${group.name}*\nMembers: ${group.size}\nID: ${group.jid}`
        );
        let chunk = header;
        for (const row of rows) {
            if ((chunk + row + '\n\n').length > 3300) {
                await sock.sendMessage(jid, { text: chunk.trim() });
                chunk = '📚 *JARVIS GROUP IDS (CONTINUED)*\n\n';
            }
            chunk += row + '\n\n';
        }
        if (chunk.trim()) await sock.sendMessage(jid, { text: chunk.trim() });
        return;
    } catch (err) {
        recordJarvisEventLog('ERROR', 'Failed to retrieve group IDs', err.message);
        return sock.sendMessage(jid, {
            text: `❌ Could not retrieve group IDs.\nReason: ${err.message}`
        }, { quoted: m });
    }
}

        // ============================================================
        // OWNER COMMAND: ADD META AI TO A GROUP
        // Usage: !addxxjarvis meta <groupID>
        // ============================================================
if (command === "!addxxjarvis") {
    const requestedBot = String(args[0] || '').toLowerCase();
    const targetGroupJid = String(args[1] || (jid && jid.endsWith('@g.us') ? jid : '')).trim();
    const META_AI_BOT_JID = '867051314767696@bot';

    if (requestedBot !== 'meta' || !targetGroupJid || !targetGroupJid.endsWith('@g.us')) {
        return sock.sendMessage(jid, {
            text: 'Usage: !addxxjarvis meta <groupID>\nExample: !addxxjarvis meta 120363431046443143@g.us'
        }, { quoted: m });
    }

    recordJarvisEventLog('INFO', 'Meta AI add request started', `Requester: ${sender || 'unknown'}; Chat: ${jid}; Target group: ${targetGroupJid}; Bot ID: ${META_AI_BOT_JID}`);
    try {
        if (!sock || !sock.user) throw new Error('WhatsApp socket is not connected.');
        if (typeof sock.groupMetadata !== 'function') throw new Error('groupMetadata() is unavailable in this Baileys version.');
        if (typeof sock.groupParticipantsUpdate !== 'function') throw new Error('groupParticipantsUpdate() is unavailable in this Baileys version.');

        const targetMetadata = await sock.groupMetadata(targetGroupJid);
        const groupName = targetMetadata.subject || targetGroupJid;

        // Allow the Jarvis owner OR a WhatsApp admin of the target group.
        // This also lets an admin issue the command in a private chat with Jarvis.
        const normalizeJid = value => String(value || '').trim().toLowerCase().replace(/:\d+(?=@)/, '');
        const digitsFromJid = value => {
            const bare = normalizeJid(value).split('@')[0];
            return bare.replace(/\D/g, '');
        };
        const requesterJid = normalizeJid(sender);
        const requesterDigits = digitsFromJid(sender);
        const ownerDigits = String(OWNER_NUMBER || '').replace(/\D/g, '');
        const requesterIsOwner = Boolean(isOwner) || Boolean(ownerDigits && requesterDigits === ownerDigits);
        const participants = Array.isArray(targetMetadata.participants) ? targetMetadata.participants : [];
        const requesterParticipant = participants.find(participant => {
            const participantIds = [participant?.id, participant?.jid, participant?.phoneNumber, participant?.lid]
                .map(normalizeJid).filter(Boolean);
            if (requesterJid && participantIds.includes(requesterJid)) return true;
            // Phone-number comparison supports common @s.whatsapp.net / device-suffix formats.
            // Do not use digits-only matching for LID identifiers.
            if (requesterDigits && requesterJid.endsWith('@s.whatsapp.net')) {
                return participantIds.some(id => id.endsWith('@s.whatsapp.net') && digitsFromJid(id) === requesterDigits);
            }
            return false;
        });
        const requesterIsGroupAdmin = Boolean(requesterParticipant && (requesterParticipant.admin === 'admin' || requesterParticipant.admin === 'superadmin'));

        if (!requesterIsOwner && !requesterIsGroupAdmin) {
            recordJarvisEventLog('WARN', 'Unauthorized Meta AI add attempt', `Requester: ${sender || 'unknown'}; Group: ${groupName} (${targetGroupJid}); Owner: ${requesterIsOwner}; Target-group admin: ${requesterIsGroupAdmin}`);
            return sock.sendMessage(jid, {
                text: `❌ You are not authorised to add Meta AI to *${groupName}*.\n\nOnly the Jarvis owner or an administrator of the target group can run this command. Send it privately to Jarvis or inside the target group.`
            }, { quoted: m });
        }

        recordJarvisEventLog('INFO', 'Meta AI add requester authorised', `Requester: ${sender || 'unknown'}; Method: ${requesterIsOwner ? 'Jarvis owner' : 'target-group admin'}; Group: ${groupName} (${targetGroupJid})`);
        recordJarvisEventLog('INFO', 'Submitting Meta AI group-add request', `Group: ${groupName}; Group ID: ${targetGroupJid}; Bot ID: ${META_AI_BOT_JID}`);

        const result = await sock.groupParticipantsUpdate(targetGroupJid, [META_AI_BOT_JID], 'add');
        const resultText = JSON.stringify(result);
        recordJarvisEventLog('INFO', 'Meta AI add API response received', resultText || 'Empty response');

        const responseItem = Array.isArray(result) ? result[0] : result;
        const status = String(responseItem?.status ?? responseItem?.code ?? '');
        const detail = String(responseItem?.content?.[0]?.attrs?.reason || responseItem?.message || '');
        let responseText;

        if (status === '200' || status === '201') {
            responseText = `✅ *Meta AI add request succeeded.*\n\nGroup: *${groupName}*\nGroup ID: ${targetGroupJid}\nWhatsApp status: ${status}`;
            recordJarvisEventLog('INFO', 'Meta AI add request reported success', `${groupName} (${targetGroupJid})`);
        } else if (status === '409') {
            responseText = `ℹ️ Meta AI may already be in the group.\nGroup ID: ${targetGroupJid}\nStatus: ${status}`;
            recordJarvisEventLog('WARN', 'Meta AI add returned already-present/conflict status', `${targetGroupJid}; ${detail}`);
        } else {
            responseText = `⚠️ WhatsApp did not confirm that Meta AI was added.\nGroup: *${groupName}*\nGroup ID: ${targetGroupJid}\nStatus: ${status || 'not provided'}${detail ? `\nDetails: ${detail}` : ''}\nCheck LIVE BOT EVENT LOGS for the response.`;
            recordJarvisEventLog('WARN', 'Meta AI add response did not confirm success', `Status: ${status || 'not provided'}; Details: ${detail}; Raw: ${resultText}`);
        }
        return sock.sendMessage(jid, { text: responseText }, { quoted: m });
    } catch (err) {
        const errorDetails = err?.data ? `${err.message}; data=${JSON.stringify(err.data)}` : (err?.message || String(err));
        recordJarvisEventLog('ERROR', 'Meta AI group-add request failed', `Group: ${targetGroupJid}; Bot: ${META_AI_BOT_JID}; Error: ${errorDetails}`);
        return sock.sendMessage(jid, {
            text: `❌ Meta AI could not be added.\nTarget group: ${targetGroupJid}\nReason: ${err.message || 'Unknown error'}\n\nSee LIVE BOT EVENT LOGS in the Jarvis dashboard for details.`
        }, { quoted: m });
    }
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
            `https://flexieduconsult-ai-link-wqnb.onrender.com/image?prompt=${encodeURIComponent(prompt)}`
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
// 🧾 RECENT BOT EVENT LOGS FOR THE WEB DASHBOARD
// ============================================================
app.get('/api/logs', (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, 100))
        : 40;
    res.json({ logs: jarvisEventLogs.slice(0, limit) });
});

// ============================================================
// 📡 WHATSAPP STATUS
// ============================================================

app.get('/api/status', (req, res) => {
    const connected = !!sock && !!sock.user;
    const memory = process.memoryUsage();
    const dbConnected = mongoose.connection.readyState === 1;
    const checks = [connected, dbConnected, true, memory.heapUsed / Math.max(memory.heapTotal, 1) < 0.9];
    const health = Math.round(checks.filter(Boolean).length / checks.length * 100);
    res.json({
        connected, online: connected, status: connected ? 'connected' : 'waiting',
        health, healthLabel: health >= 95 ? 'Excellent' : health >= 85 ? 'Healthy' : health >= 70 ? 'Degraded' : health >= 40 ? 'Unstable' : 'Critical',
        checks: { whatsapp: connected, mongodb: dbConnected, aiBridge: true, memoryHeadroom: Math.max(0, Math.min(100, Math.round((1 - memory.heapUsed / Math.max(memory.heapTotal, 1)) * 100))) },
        memory: { heapUsedMB: Math.round(memory.heapUsed / 1048576), heapTotalMB: Math.round(memory.heapTotal / 1048576), rssMB: Math.round(memory.rss / 1048576) },
        uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString()
    });
});


// ============================================================
// 🖼️ DASHBOARD LOOKUPS: WhatsApp profile pictures and group icons
// ============================================================
app.get('/api/profile-picture/:number', async (req, res) => {
    try {
        if (!sock?.user) return res.status(503).json({ error: 'WhatsApp is not connected.' });
        const number = String(req.params.number || '').replace(/\D/g, '');
        if (number.length < 7 || number.length > 15) return res.status(400).json({ error: 'Provide a valid international phone number without + or spaces.' });
        const jid = `${number}@s.whatsapp.net`;
        const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (!url) return res.status(404).json({ error: 'No profile picture is available for this number, or its privacy settings hide it.' });
        res.json({ number, jid, url });
    } catch (error) { res.status(500).json({ error: 'Could not fetch profile picture.' }); }
});

app.get('/api/group-icon/:jid', async (req, res) => {
    try {
        if (!sock?.user) return res.status(503).json({ error: 'WhatsApp is not connected.' });
        const raw = decodeURIComponent(req.params.jid);
        const jid = raw.endsWith('@g.us') ? raw : `${raw}@g.us`;
        if (!/^[0-9-]+@g\.us$/.test(jid)) return res.status(400).json({ error: 'Invalid WhatsApp group ID.' });
        const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (!url) return res.status(404).json({ error: 'No group icon is available, or its privacy settings hide it.' });
        res.json({ jid, url });
    } catch (error) { res.status(500).json({ error: 'Could not fetch group icon.' }); }
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

/* LIVE EVENT LOGS */
.event-log-list{
    display:flex;
    flex-direction:column;
    gap:8px;
    max-height:340px;
    overflow:auto;
}
.event-log-item{
    display:grid;
    grid-template-columns:82px 1fr;
    gap:10px;
    padding:10px 12px;
    border:1px solid rgba(255,255,255,.06);
    border-radius:10px;
    background:rgba(0,0,0,.18);
    font-size:12px;
    line-height:1.45;
    overflow-wrap:anywhere;
}
.event-log-time{color:var(--muted);font-size:10px;}
.event-log-message{color:var(--text);}
.event-log-item.error .event-log-message{color:#ff8094;}
.event-log-item.warn .event-log-message{color:#ffd166;}
.event-log-details{grid-column:2;color:var(--muted);font-size:10px;white-space:pre-wrap;}
.event-log-empty{color:var(--muted);font-size:12px;padding:12px;}

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
    width:100%;
    height:100vh;
    height:100dvh;
    overflow:hidden;
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
    min-height:0;
    min-width:0;
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
    min-height:0;
    height:100%;
    display:flex;
    flex-direction:column;
    overflow:hidden;
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
    flex:1 1 auto;
    min-height:0;
    overflow-y:auto;
    overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;
    overflow-wrap:anywhere;
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
    flex:0 0 auto;
    display:flex;
    gap:10px;
    padding:12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
    border-top:1px solid var(--border);
    background:rgba(5,12,22,.96);
    position:relative;
    z-index:2;
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
    font-size:16px;
    min-height:46px;
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
        grid-template-columns:minmax(0,1fr);
        height:100%;
        height:100dvh;
    }

    .conversation-header{
        flex:0 0 auto;
        padding:12px 14px;
    }

    .messages{
        padding:14px 12px;
    }

    .composer{
        padding:10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
    }

    .composer input{
        padding:12px;
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

    <section class="glass section event-log-section">
        <div class="section-title">
            <h3>LIVE BOT EVENT LOGS</h3>
            <span id="eventLogStatus">WAITING FOR EVENTS</span>
        </div>
        <div id="eventLogList" class="event-log-list">
            <div class="event-log-empty">Waiting for Jarvis activity...</div>
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

            <div id="messageLoadNotice" role="status" aria-live="polite" style="display:none;padding:5px 12px;font-size:11px;color:var(--muted);"></div>

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
    messagesRequestToken++;
    lastRenderedMessagesKey = '';

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

    messagesRequestToken++;
    lastRenderedMessagesKey = '';
    const notice = document.getElementById('messageLoadNotice');
    if(notice){ notice.textContent = ''; notice.style.display = 'none'; }

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

let messagesRequestToken = 0;
let lastRenderedMessagesKey = '';
let lastMessageLoadError = '';

function messageKey(messages){
    return JSON.stringify((messages || []).map(message => ({
        id: message.id || message.key || message.messageId || '',
        direction: message.direction || '',
        senderName: message.senderName || '',
        text: message.text || '',
        timestamp: message.timestamp || ''
    })));
}

async function loadMessages(){
    if(!selectedGroup) return;

    const jid = selectedGroup.jid;
    const requestToken = ++messagesRequestToken;

    try{
        const response = await fetch(
            '/api/groups/' + encodeURIComponent(jid) + '/messages',
            { cache: 'no-store' }
        );
        const data = await response.json();
        if(!response.ok) throw new Error(data.error || 'Unable to load messages');

        // Ignore a late response from a group that is no longer selected.
        if(!selectedGroup || selectedGroup.jid !== jid || requestToken !== messagesRequestToken) return;

        const messages = Array.isArray(data) ? data : (data.messages || []);
        renderMessages(messages);
        lastMessageLoadError = '';
        const notice = document.getElementById('messageLoadNotice');
        if(notice){ notice.textContent = ''; notice.style.display = 'none'; }
    }catch(error){
        if(requestToken !== messagesRequestToken) return;
        console.error('Unable to refresh messages:', error);
        // Keep the last conversation visible if a temporary refresh fails.
        if(!lastMessageLoadError){
            const notice = document.getElementById('messageLoadNotice');
            if(notice){ notice.textContent = 'Connection interrupted — keeping displayed messages.'; notice.style.display = 'block'; }
        }
        lastMessageLoadError = error.message || 'Message refresh failed';
    }
}

function renderMessages(messages){
    const box = document.getElementById('messages');
    if(!box) return;

    const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const key = messageKey(messages);

    // Avoid rebuilding the DOM on every 2.5-second poll if nothing changed.
    if(key === lastRenderedMessagesKey) return;

    if(!messages.length){
        box.innerHTML = '<div class="empty">No stored messages for this group yet.</div>';
        lastRenderedMessagesKey = key;
        return;
    }

    const html = messages.map(message => {
        const outgoing = message.direction === 'outgoing';
        const sender = (!outgoing && message.senderName)
            ? '<div class="sender">' + escapeHtml(message.senderName) + '</div>'
            : '';
        return '<div class="message ' + (outgoing ? 'outgoing' : 'incoming') + '">' +
            sender +
            '<div>' + escapeHtml(message.text || '') + '</div>' +
            '<div class="message-time">' + formatMessageTime(message.timestamp) + '</div>' +
            '</div>';
    }).join('');

    box.innerHTML = html;
    lastRenderedMessagesKey = key;

    // Follow new messages only if the user was already reading at the bottom.
    if(wasNearBottom){
        requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
    }
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
    if(!selectedGroup) return;

    const input = document.getElementById('messageInput');
    const button = document.getElementById('sendButton');
    const text = input.value.trim();
    const jid = selectedGroup.jid;
    if(!text || button.disabled) return;

    // Keep the composer visible and editable while the request is in flight.
    button.disabled = true;
    button.textContent = '…';

    try{
        const response = await fetch(
            '/api/groups/' + encodeURIComponent(jid) + '/messages',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            }
        );
        const data = await response.json();
        if(!response.ok) throw new Error(data.error || 'Unable to send message');

        // Clear only if the user hasn't edited the input while sending.
        if(input.value.trim() === text) input.value = '';
        if(selectedGroup && selectedGroup.jid === jid) await loadMessages();
    }catch(error){
        console.error(error);
        alert(error.message || 'Unable to send message');
        // Leave the unsent text in the input so the user can retry.
    }finally{
        button.disabled = false;
        button.textContent = '➤';
        input.focus({ preventScroll: true });
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
   LIVE BOT EVENT LOGS
============================================================ */
async function loadEventLogs(){
    const list = document.getElementById('eventLogList');
    const status = document.getElementById('eventLogStatus');
    if (!list || !status) return;

    try {
        const response = await fetch('/api/logs?limit=40', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load logs');
        const logs = Array.isArray(data.logs) ? data.logs : [];
        status.textContent = logs.length ? \`\${logs.length} RECENT EVENTS\` : 'WAITING FOR EVENTS';

        if (!logs.length) {
            list.innerHTML = '<div class="event-log-empty">No events yet. Meta AI and group command activity will appear here.</div>';
            return;
        }

        list.innerHTML = logs.map(entry => {
            const time = entry.time ? new Date(entry.time).toLocaleTimeString() : '--:--:--';
            const level = String(entry.level || 'INFO').toLowerCase();
            const message = escapeHtml(entry.message || 'Event');
            const details = entry.details ? \`<div class="event-log-details">\${escapeHtml(entry.details)}</div>\` : '';
            return \`<div class="event-log-item \${level}"><div class="event-log-time">\${escapeHtml(time)}<br>\${escapeHtml(level.toUpperCase())}</div><div class="event-log-message">\${message}</div>\${details}</div>\`;
        }).join('');
    } catch (error) {
        status.textContent = 'LOGS UNAVAILABLE';
        list.innerHTML = \`<div class="event-log-empty">\${escapeHtml(error.message || 'Unable to load logs')}</div>\`;
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
loadEventLogs();

setInterval(loadEventLogs, 3000);

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
app.post(
    "/webhook/trigger-quiz",
    express.json(),
    async (req, res) => {

        try {

            const {
                subject,
                groupJid
            } = req.body;


            if (!subject) {

                return res.status(400).json({
                    success: false,
                    error: "Quiz subject is required"
                });
            }


            const targetGroup =
                groupJid ||
                "12036342497643845@g.us";


            const result =
                await quizEngine.fireQuiz(
                    sock,
                    {
                        subject,
                        groupJid: targetGroup
                    }
                );


            if (!result.success) {

                return res.status(400).json(
                    result
                );
            }


            return res.json({
                success: true,
                message:
                    "Quiz started successfully",
                subject: result.subject,
                groupJid: result.groupJid
            });


        } catch (err) {

            console.log(
                "❌ Trigger Quiz Error:",
                err.message
            );


            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
    }
);

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
