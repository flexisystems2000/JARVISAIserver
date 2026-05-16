const axios = require('axios');
const OpenAI = require('openai');

/**
 * 🕵️‍♂️ JARVIS SMART GRAMMAR WATCHDOG
 *
 * Hybrid System:
 * ✅ LanguageTool (fast corrections)
 * ✅ OpenRouter AI fallback
 *
 * Smart Features:
 * ✅ Anti-spam
 * ✅ Nigerian slang awareness
 * ✅ Cooldown protection
 * ✅ WhatsApp-friendly behavior
 * ✅ Serious grammar correction only
 */

// =========================
// OPENROUTER CLIENT
// =========================

const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
});

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

    // Ignore very short chats
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
        now - grammarCooldowns.get(sender) < 300000
    ) {
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
                correctedText.slice(
                    match.offset + match.length
                );
        }

        // =========================
        // FAST FIX VALIDATION
        // =========================

        if (
            correctedText &&
            correctedText.trim().toLowerCase() !==
            textInput.trim().toLowerCase()
        ) {

            // Set cooldown
            grammarCooldowns.set(sender, now);

            return correctedText;
        }

        // =========================
        // AI FALLBACK
        // =========================

        const ai =
            await openrouter.chat.completions.create({

                model: 'deepseek/deepseek-chat:free',

                messages: [

                    {
                        role: 'system',

                        content:
`You are an advanced English grammar correction engine.

Your task is to completely fix broken English sentences naturally.

RULES:
- Return ONLY the corrected sentence
- No explanations
- No quotation marks
- Fix tense errors correctly
- Fix sentence structure fully
- Preserve original meaning
- Sound natural in standard English

EXAMPLES:

Input: He go school yesterday
Output: He went to school yesterday.

Input: Is there anyone that know how today date are
Output: Does anyone know today's date?

Input: She no understand wetin teacher talk
Output: She did not understand what the teacher said.`
                    },

                    {
                        role: 'user',
                        content: textInput
                    }
                ],

                temperature: 0.2,

                max_tokens: 60
            });

        const aiText =
            ai.choices?.[0]?.message?.content?.trim();

        // =========================
        // AI VALIDATION
        // =========================

        if (!aiText) {
            return null;
        }

        // Prevent chatbot behavior
        if (
            aiText.toLowerCase().includes('corrected version') ||
            aiText.toLowerCase().includes('grammar check') ||
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

        // Basic sanity check
        if (aiText.length < 3) {
            return null;
        }

        // Set cooldown
        grammarCooldowns.set(sender, now);

        return aiText;

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
