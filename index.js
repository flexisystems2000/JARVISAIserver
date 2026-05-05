// ================= FLEXI TUTORS WHATSAPP BOT =================
// Smart Version (Gemini AI + Pairing Code + Smart Translate)

require('dotenv').config();

const CONFIG = { 
  PREFIX: '.', 
  GEMINI_API_KEY: process.env.GEMINI_API_KEY, 
  OWNER_NUMBER: process.env.OWNER_NUMBER 
};

const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const axios = require('axios');

let linkWarnings = {};
let badWarnings = {};
let spamTracker = {};

// ================= NUMBER FORMAT =================
function formatNumber(num) {
  if (!num || typeof num !== 'string') return null;
  num = num.replace(/\D/g, '');
  if (num.startsWith('0')) num = '234' + num.slice(1);
  if (num.startsWith('234')) return num;
  return null;
}

// ================= GEMINI AI =================
async function askAI(prompt) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { timeout: 10000 }
      );
      return res.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    } catch (e) {
      if (i === 1) return '⚠️ AI temporarily unavailable';
    }
  }
}

function isEnglish(text) {
  return /^[\x00-\x7F\s.,?!'"()\-]+$/.test(text);
}

// ================= BOT CORE =================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const pino = require('pino');

  // Fetch version to avoid 405 error
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`BT: Using WA version v${version.join('.')}, isLatest: ${isLatest}`);

  const sock = makeWASocket({ 
    version,
    auth: state, 
    logger: pino({ level: 'silent' }),
    browser: ["Mac OS", "Safari", "10.15.7"] 
  });
  
  global.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.output?.payload?.message || "Unknown";
      
      console.log(`❌ Connection Closed: ${reason} (Code: ${statusCode})`);

      if (statusCode !== 401) { 
        console.log("🔄 Retrying in 5 seconds...");
        if (global.sock) global.sock.ev.removeAllListeners(); 
        setTimeout(() => startBot(), 5000);
      } else {
        console.log("⚠️ Logged out. Please delete 'auth' folder and re-scan.");
      }
    }

    if (connection === 'open') console.log('✅ JARVIS IS ONLINE');
  });

  // ================= PAIRING CODE (OWNER) =================
  if (!sock.authState.creds.registered && CONFIG.OWNER_NUMBER) {
    const phoneNumber = formatNumber(CONFIG.OWNER_NUMBER);
    if (phoneNumber) {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n🔗 Default Owner Pairing Code: ${code}\n`);
      } catch (e) {
        console.log("Pairing request failed or number already paired.");
      }
    }
  }

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!text || !from.endsWith('@g.us')) return;

    if (text.toLowerCase().includes('jarvis')) {
      await sock.sendMessage(from, { react: { text: "🤖", key: msg.key } });
    }

    const metadata = await sock.groupMetadata(from);
    const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
    const isAdmin = admins.includes(sender);

    if (!text.startsWith(CONFIG.PREFIX)) {
      if (!isEnglish(text)) {
        const translated = await askAI(`Translate to English only:\n${text}`);
        await sock.sendMessage(from, { text: `🌐 Translation: ${translated}` });
        return;
      }
    }

    // Antispam, Antilink, and Badwords go here...
    // [Keep your existing logic for these as they were correct]
    
    // ================= ANTISPAM =================
    const now = Date.now();
    if (!spamTracker[sender]) spamTracker[sender] = [];

    spamTracker[sender].push(now);
    spamTracker[sender] = spamTracker[sender].filter(t => now - t < 3000);

    if (spamTracker[sender].length >= 5) {
      await sock.sendMessage(from, {
        text: `⚠️ Spam detected! Next spam = removal`,
        mentions: [sender]
      });

      if (spamTracker[sender].length >= 7) {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      }
    }

    // ================= ANTILINK =================
    const linkRegex = /(https?:\/\/|www\.|chat\.whatsapp\.com|wa\.me)/i;

    if (linkRegex.test(text)) {
      linkWarnings[sender] = (linkWarnings[sender] || 0) + 1;

      await sock.sendMessage(from, {
        text: `⚠️ Link warning (${linkWarnings[sender]}/3)`,
        mentions: [sender]
      });

      if (linkWarnings[sender] >= 3) {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      }
    }

    // ================= BAD WORDS =================
    const badWords = ['stupid','idiot','fool','nonsense','mad','dumb'];

    if (badWords.some(w => new RegExp(`\\b${w}\\b`, 'i').test(text))) {
      badWarnings[sender] = (badWarnings[sender] || 0) + 1;

      await sock.sendMessage(from, {
        text: `⚠️ Bad words (${badWarnings[sender]}/5)`,
        mentions: [sender]
      });

      if (badWarnings[sender] >= 5) {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      }
    }


    if (!text.startsWith(CONFIG.PREFIX)) return;
    if (!isAdmin) return;

    const cmd = text.slice(1).split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1);

    switch (cmd) {
      case 'menu':
        await sock.sendMessage(from, { text: `🤖 FLEXI JARVIS\n\n.add .kick .ginfo .ai .menu` });
        break;
      case 'ai':
        const reply = await askAI(`Educational assistant:\n${args.join(' ')}`);
        await sock.sendMessage(from, { text: reply });
        break;
      // Add other cases as needed
    }
  });
}

// ================= WEB SERVER =================
const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.send(`... Your Dashboard HTML ...`); // Keep your existing HTML here
});

app.get('/pair', async (req, res) => {
  try {
    const number = formatNumber(req.query.number);
    if (!number || !global.sock) return res.send('Error: Invalid number or Bot starting');
    const code = await global.sock.requestPairingCode(number);
    res.send(`Your Pairing Code: ${code}`);
  } catch (e) {
    res.send('Error generating pairing code. Check if number is valid.');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Dashboard running on port ${PORT}`);
  startBot().catch(err => console.error("Start Error:", err));
});
    
