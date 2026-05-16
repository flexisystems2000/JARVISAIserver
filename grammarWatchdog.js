const axios = require('axios');

/**
 * 🕵️‍♂️ JARVIS GEMINI GRAMMAR WATCHDOG
 *
 * Fully AI Powered:
 * ✅ Gemini Backend Server
 *
 * Features:
 * ✅ Spelling correction
 * ✅ Grammar correction
 * ✅ Sentence reconstruction
 * ✅ Nigerian English awareness
 * ✅ Anti-spam
 * ✅ Cooldown protection
 * ✅ WhatsApp-friendly behavior
 * ✅ Smart AI validation
 */

// =========================
// USER COOLDOWNS
// =========================

const grammarCooldowns = new Map();

// =========================
// CASUAL CHAT FILTERS
// =========================

const casualSlangPatterns = [

    /^abi\b/i,
    /^abeg\b/i,
    /^omo\b/i,
    /^omoh\b/i,
    /^lol\b/i,
    /^lmao\b/i,
    /^guy\b/i,
    /^bro\b/i,
    /^pls\b/i,
    /^na wa/i
];

/**
 * Auto-correct grammar intelligently
 * @param {string} textInput
 * @param {string} sender
 * @returns {Promise<string|null>}
 */

async function autoCorrectGrammar(
    textInput,
    sender = 'unknown'
) {

    // =========================
    // BASIC FILTERS
    // =========================

    if (!textInput) {
        return null;
    }

    textInput = textInput.trim();

    // Ignore short chats
    if (textInput.split(/\s+/).length < 4) {
        return null;
    }

    // Ignore commands
    if (textInput.startsWith('!')) {
        return null;
    }

    // Ignore links
    if (
        textInput.includes('http') ||
        textInput.includes('.com') ||
        textInput.includes('chat.whatsapp')
    ) {
        return null;
    }

    // Ignore emoji/symbol spam
    const plainText =
        textInput.replace(/[^\w\s]/gi, '');

    if (plainText.length < 5) {
        return null;
    }

    // Ignore weird non-language messages
    if (!/[a-zA-Z]/.test(textInput)) {
        return null;
    }

    // =========================
    // CASUAL CHAT FILTER
    // =========================

    const isCasualChat =
        casualSlangPatterns.some(pattern =>
            pattern.test(textInput)
        );

    if (isCasualChat) {
        return null;
    }

    // =========================
    // USER COOLDOWN
    // =========================

    const now = Date.now();

    if (
        grammarCooldowns.has(sender) &&
        now - grammarCooldowns.get(sender) < 900000
    ) {
        return null;
    }

    try {

        // =========================
        // GEMINI BACKEND REQUEST
        // =========================

        const aiResponse = await axios.post(

            'https://flexieduconsult-ai-link.onrender.com/grammar',

            {
                text: textInput
            },

            {
                timeout: 20000
            }
        );

        // =========================
        // RESPONSE EXTRACTION
        // =========================

        const aiText =
            aiResponse.data?.reply?.trim();

        const correctionType =
            aiResponse.data?.type || 'grammar';

        // =========================
        // VALIDATION
        // =========================

        if (!aiText) {
            return null;
        }

        // Prevent AI chatbot responses
        if (
            aiText.toLowerCase().includes('as an ai') ||
            aiText.toLowerCase().includes('grammar check') ||
            aiText.toLowerCase().includes('corrected version') ||
            aiText.toLowerCase().includes('here is')
        ) {
            return null;
        }

        // Ignore identical output
        if (
            aiText.trim().toLowerCase() ===
            textInput.trim().toLowerCase()
        ) {
            return null;
        }

        // Ignore tiny responses
        if (aiText.length < 3) {
            return null;
        }

        // =========================
        // FORMAT RESPONSE
        // =========================

        let finalReply;

        if (correctionType === 'spelling') {

            finalReply =
`📝 *Spelling Correction* 📝

You had a spelling error.

👉 *${aiText}*`;
        }

        else {

            finalReply =
`📝 *Grammar Correction* 📝

👉 *${aiText}*`;
        }

        // =========================
        // SAVE COOLDOWN
        // =========================

        grammarCooldowns.set(
            sender,
            now
        );

        return finalReply;

    } catch (err) {

        console.log(
            '🕵️‍♂️ Gemini Grammar Skip:',
            err.response?.data || err.message
        );

        return null;
    }
}

module.exports = {
    autoCorrectGrammar
};
