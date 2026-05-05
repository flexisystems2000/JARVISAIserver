# 🤖 JARVIS AI WhatsApp Bot
**Powered by Flexi edTech Digital Academy**

A smart, production-ready WhatsApp bot built with Baileys, featuring AI replies, group moderation, and a web-based pairing dashboard.

---

## 🚀 Features

### 🤖 AI System
- Gemini-powered AI replies
- Triggered with **"jarvis"** in groups
- Works automatically in owner DM
- Smart non-spam response logic

### 🛡️ Moderation System (Watchdog)
- Anti-link protection
- Anti-insult / bad words filter
- Auto message deletion
- 3-strike warning system
- Auto-kick offenders

### 👮 Admin Commands
- `!ginfo` → Group info (name, members)
- `!add <number>` → Add user
- `!kick @user` → Remove user
- `!promote @user` → Make admin

### 🔁 Smart Queue System
- Handles failed group adds (privacy issues)
- Sends invite link via DM
- Simulates typing for realism
- Prevents WhatsApp bans/logouts

### ⚡ Performance & Stability
- Auto reconnect system
- Crash guards (prevents bot shutdown)
- Group metadata caching
- Background task processing

### 🌐 Web Dashboard
- Clean UI for pairing WhatsApp
- Generates pairing code instantly
- Mobile-friendly design

---

## 📦 Installation

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/jarvis-ai-bot.git
cd jarvis-ai-bot
