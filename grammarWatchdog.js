const axios = require('axios');
const ollama = require('ollama');

/**
 * 🕵️‍♂️ JARVIS HYBRID GRAMMAR WATCHDOG
 *
 * Layer 1:
 * ✅ LanguageTool
 * Fast grammar/spelling correction
 *
 * Layer 2:
 * ✅ Ollama AI
 * Advanced sentence reconstruction
 *
 * Optimized for:
 * ✅ WhatsApp groups
 * ✅ Nigerian students
 * ✅ Low spam
 * ✅ No paid APIs
 * ✅ Broken English reconstruction
 */

/**
 * Auto-correct grammar and sentence structure
 * @param {string} textInput
 * @returns {Promise<string|null>}
 */
async function autoCorrectGrammar(textInput) {

    // =========================
    // SAFETY FILTERS
    // =========================

    if (!textInput) return null;

    textInput = textInput.trim();

    // Ignore short messages
    if (textInput.split(/\s+/).length <= 3) {
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

    // Ignore symbols/emojis spam
    const plainText = textInput.replace(/[^\w\s]/gi, '');

    if (plainText.length < 5) {
        return null;
    }

    // Ignore weird non-language messages
    if (!/[a-zA-Z]/.test(textInput)) {
        return null;
    }

    try {

        // =========================
        // LAYER 1:
        // LANGUAGETOOL CHECK
        // =========================

        const params = new URLSearchParams();

        params.append('text', textInput);
        params.append('language', 'auto');

        const res = await axios.post(
            'https://api.languagetoolplus.com/v2/check',
            params,
            {
                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded'
                },

                timeout: 7000
            }
        );

        const matches = res.data?.matches || [];

        let correctedText = textInput;

        // Reverse sort prevents offset corruption
        matches.sort((a, b) => b.offset - a.offset);

        for (const match of matches) {

            // Skip empty replacement suggestions
            if (!match.replacements?.length) {
                continue;
            }

            const replacement =
                match.replacements[0]?.value;

            if (
                replacement === undefined ||
                replacement === null
            ) {
                continue;
            }

            correctedText =
                correctedText.slice(0, match.offset) +
                replacement +
                correctedText.slice(match.offset + match.length);
        }

        // =========================
        // RETURN FAST FIX
        // =========================

        if (
            correctedText &&
            correctedText.trim().toLowerCase() !==
            textInput.trim().toLowerCase()
        ) {

            return correctedText;
        }

        // =========================
        // LAYER 2:
        // OLLAMA AI FALLBACK
        // =========================

        const ai = await ollama.chat({

            model: 'gemma:2b',

            messages: [

                {
                    role: 'system',

                    content:
                        `You are a grammar correction engine.

Correct the user's sentence naturally.

RULES:
- Return ONLY the corrected sentence
- Do not explain
- Do not add quotation marks
- Keep original meaning
- Fix broken English naturally`
                },

                {
                    role: 'user',
                    content: textInput
                }
            ]
        });

        const aiText =
            ai.message?.content?.trim();

        // =========================
        // AI VALIDATION
        // =========================

        if (
            aiText &&
            aiText.length > 3 &&
            aiText.toLowerCase() !==
            textInput.toLowerCase()
        ) {

            return aiText;
        }

        return null;

    } catch (err) {

        console.log(
            '🕵️‍♂️ Grammar Hybrid Skip:',
            err.response?.data || err.message
        );

        return null;
    }
}

module.exports = {
    autoCorrectGrammar
};
