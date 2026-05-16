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
 * ✅ 15-second cooldown
 * ✅ WhatsApp-friendly behavior
 * ✅ Smart AI validation
 */

// =========================
// USER COOLDOWNS
// =========================

const grammarCooldowns = new Map();

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

    // Ignore extremely short chats
    if (textInput.split(/\s+/).length < 2) {
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

    if (plainText.length < 4) {
        return null;
    }

    // Ignore non-language messages
    if (!/[a-zA-Z]/.test(textInput)) {
        return null;
    }

    // =========================
    // USER COOLDOWN
    // =========================

    const now = Date.now();

    if (
        grammarCooldowns.has(sender) &&
        now - grammarCooldowns.get(sender) < 15000
    ) {

        console.log(
            '⏳ Grammar cooldown active for:',
            sender
        );

        return null;
    }

    try {

        // =========================
        // DEBUG LOG
        // =========================

        console.log(
            '📤 Sending Grammar Request:',
            textInput
        );

        // =========================
        // GEMINI BACKEND REQUEST
        // =========================

        const aiResponse = await axios.post(

            'https://flexieduconsult-ai-link.onrender.com/grammar',

            {
                text: textInput
            },

            {
                timeout: 20000,

                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        // =========================
        // DEBUG RESPONSE
        // =========================

        console.log(
            '📥 Gemini Response:',
            aiResponse.data
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

            console.log(
                '❌ No AI reply returned'
            );

            return null;
        }

        // Prevent chatbot responses
        if (
            aiText.toLowerCase().includes('as an ai') ||
            aiText.toLowerCase().includes('grammar check') ||
            aiText.toLowerCase().includes('corrected version') ||
            aiText.toLowerCase().includes('here is')
        ) {

            console.log(
                '❌ Blocked chatbot response'
            );

            return null;
        }

        // Ignore identical responses
        if (
            aiText.trim().toLowerCase() ===
            textInput.trim().toLowerCase()
        ) {

            console.log(
                '❌ AI returned same text'
            );

            return null;
        }

        // Ignore weird responses
        if (
            aiText.length < 3 ||
            aiText.length > 300
        ) {

            console.log(
                '❌ Invalid AI response length'
            );

            return null;
        }

        // =========================
        // FORMAT RESPONSE
        // =========================

        let finalReply;

        if (
            correctionType
                .toLowerCase()
                .includes('spelling')
        ) {

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

        console.log(
            '✅ Grammar correction sent'
        );

        return finalReply;

    } catch (err) {

        console.log(
            '❌ FULL GRAMMAR ERROR:',
            {
                message: err.message,
                status: err.response?.status,
                data: err.response?.data
            }
        );

        return null;
    }
}

module.exports = {
    autoCorrectGrammar
};
