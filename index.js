// ================= FLEXI TUTORS WHATSAPP BOT =================
// Smart Version (Gemini AI + Pairing Code + Smart Translate)

require('dotenv').config();

const CONFIG = { PREFIX: '.', GEMINI_API_KEY: process.env.GEMINI_API_KEY, OWNER_NUMBER: process.env.OWNER_NUMBER };

const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const axios = require('axios');

let linkWarnings = {};
let badWarnings = {};
let spamTracker = {};

// ================= NUMBER FORMAT =================
function formatNumber(num) {
  num = num.replace(/\D/g, '');
  if (num.startsWith('0')) num = '234' + num.slice(1);
  if (num.startsWith('234')) return num;
  return null;
}

// ================= GEMINI (UPGRADED) =================
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

// ================= SMART LANGUAGE CHECK (FAST LOCAL) =================
function isEnglish(text) {
  return /^[\x00-\x7F\s.,?!'"()\-]+$/.test(text);
}

// ================= BOT =================
async function startBot(io) {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const pino = require('pino'); // Add this at the very top of your file
const sock = makeWASocket({ 
  auth: state, 
  logger: pino({ level: 'silent' }), // This prevents unnecessary console spam/crashes
  browser: ["Ubuntu", "Chrome", "20.0.04"] 
});
  
  global.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection } = update;

      sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401; 
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => startBot(), 5000); // Only restart the socket logic
      }
    }

    if (connection === 'open') console.log('✅ Connected to WhatsApp');
  });
    

  // ================= PAIRING CODE =================
  if (!sock.authState.creds.registered) {
    const phoneNumber = formatNumber(CONFIG.OWNER_NUMBER);
    if (phoneNumber) {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`\n🔗 Pairing Code: ${code}\n`);
    }
  }

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!text || !from.endsWith('@g.us')) return;

    // ================= JARVIS MENTION REACTION =================
    if (text.toLowerCase().includes('jarvis')) {
      await sock.sendMessage(from, {
        react: {
          text: "🤖",
          key: msg.key
        }
      });
    }

    const metadata = await sock.groupMetadata(from);
    const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
    const isAdmin = admins.includes(sender);

    // ================= SMART AUTO TRANSLATE =================
    if (!text.startsWith(CONFIG.PREFIX)) {
      const english = isEnglish(text);

      if (!english) {
        const translated = await askAI(`Translate to English only:\n${text}`);
        await sock.sendMessage(from, { text: `🌐 Translation: ${translated}` });
        return;
      }
    }

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

    // ================= COMMANDS =================
    if (!text.startsWith(CONFIG.PREFIX)) return;

    if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only' });

    const cmd = text.slice(1).split(' ')[0];
    const args = text.split(' ').slice(1);

    switch (cmd) {
      case 'menu':
        await sock.sendMessage(from, {
          text: `🤖 FLEXI JARVIS\n\n.add .kick .ginfo .ai .menu`
        });
        break;

      case 'add':
        await sock.groupParticipantsUpdate(from, [`${args[0]}@s.whatsapp.net`], 'add');
        break;

      case 'kick':
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned) await sock.groupParticipantsUpdate(from, mentioned, 'remove');
        break;

      case 'ginfo':
        await sock.sendMessage(from, {
          text: `Group: ${metadata.subject}\nMembers: ${metadata.participants.length}`
        });
        break;

      case 'ai':
        const reply = await askAI(`Educational assistant:\n${args.join(' ')}`);
        await sock.sendMessage(from, { text: reply });
        break;
    }

  });
}

// ================= WEB =================
const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Jarvis AI Dashboard</title>
<style>
body { margin:0; font-family: Arial; background:#f4f8fc; }
header { background:#002b5c; color:white; padding:15px; text-align:center; font-size:18px; font-weight:bold; }
.container { padding:20px; max-width:500px; margin:auto; }
.card { background:white; padding:20px; border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
input { width:100%; padding:12px; margin-top:10px; border:1px solid #ccc; border-radius:6px; }
button { width:100%; padding:12px; margin-top:10px; background:#003f88; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; }
.code { margin-top:15px; padding:10px; background:#e6f0ff; border-radius:6px; text-align:center; font-weight:bold; }
.features { margin-top:20px; }
.features h3 { color:#003366; }
.features ul { padding-left:20px; }
footer { text-align:center; padding:15px; margin-top:20px; font-size:13px; color:#555; }
</style>
</head>
<body>
<header>🤖 JARVIS AI powered by Flexi edTech Digital Academy</header>
<div class="container">
<div class="card">
<h3>Connect WhatsApp</h3>
<input type="text" id="number" placeholder="Enter your WhatsApp number (234...)" />
<button onclick="getCode()">Get Pairing Code</button>
<div class="code" id="code">Your pairing code will appear here</div>

<div class="features">
<h3>Features of Jarvis AI</h3>
<ul>
<li>AI Educational Assistant (.ai)</li>
<li>Auto Language Translation</li>
<li>Antilink Protection</li>
<li>Antispam System</li>
<li>Antibadwords Filter</li>
<li>Group Management (.add, .kick, .ginfo)</li>
<li>Jarvis Smart Reactions 🤖</li>
</ul>
</div>

</div>
</div>

<footer>©2026 Flexi edTech Digital Academy. All rights reserved</footer>

<script>
async function getCode() {
  const number = document.getElementById('number').value;
  if (!number) return alert('Enter number');

  const res = await fetch('/pair?number=' + number);
  const data = await res.text();

  document.getElementById('code').innerText = data;
}
</script>

</body>
</html>`);
});

// ================= PAIRING ENDPOINT =================
app.get('/pair', async (req, res) => {
  try {
    const number = formatNumber(req.query.number);
    if (!number) return res.send('Invalid number');

    if (!global.sock) {
  return res.send('Bot is still starting up. Please refresh in 5 seconds.');
}
try {
  const code = await global.sock.requestPairingCode(number);
  res.send(`Your Pairing Code: ${code}`);
} catch (err) {
  res.send('Error: Bot is already linked or busy.');
}
    
  } catch (e) {
    console.error(e);
    res.send('Error generating pairing code');
  }
});

server.listen(3000, () => console.log('🌐 Running on 3000'));

startBot();
