const axios = require('axios');
const OpenAI = require('openai');

/**
 * 🕵️‍♂️ JARVIS HYBRID GRAMMAR WATCHDOG
 *
 * Layer 1:
 * ✅ LanguageTool
 * Fast spelling + grammar correction
 *
 * Layer 2:
 * ✅ OpenRouter AI Fallback
 * Deep sentence reconstruction
 *
 * Optimized for:
 * ✅ Render deployment
 * ✅ WhatsApp groups
 * ✅ Nigerian English
 * ✅ Low API usage
 * ✅ Broken sentence correction
 */

// =========================
// OPENROUTER CLIENT
// =========================

const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
});

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

    // Ignore emoji/symbol spam
    const plainText =
        textInput.replace(/[^\w\s]/gi, '');

    if (plainText.length < 5) {
        return null;
    }

    // Ignore weird non-English spam
    if (!/[a-zA-Z]/.test(textInput)) {
        return null;
    }

    try {

        // =========================
        // LAYER 1:
        // LANGUAGETOOL
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

        const matches =
            res.data?.matches || [];

        let correctedText = textInput;

        // Reverse sorting prevents offset corruption
        matches.sort((a, b) => b.offset - a.offset);

        for (const match of matches) {

            // Skip invalid replacements
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
        // OPENROUTER AI FALLBACK
        // =========================

        const ai =
            await openrouter.chat.completions.create({

                model: 'deepseek/deepseek-chat:free',

                messages: [

                    {
                        role: 'system',

                        content:
`You are a grammar correction engine.

Correct the user's sentence naturally.

RULES:
- Return ONLY the corrected sentence
- No explanations
- No quotation marks
- Preserve meaning
- Fix broken English naturally`
                    },

                    {
                        role: 'user',
                        content: textInput
                    }
                ]
            });

        const aiText =
            ai.choices?.[0]?.message?.content?.trim();

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
