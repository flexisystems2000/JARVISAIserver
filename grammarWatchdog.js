const axios = require('axios');
const Groq = require('groq-sdk');

/**
 * 🕵️‍♂️ JARVIS SMART GRAMMAR WATCHDOG
 *
 * Hybrid System:
 * ✅ LanguageTool (fast corrections)
 * ✅ Groq AI fallback
 *
 * Smart Features:
 * ✅ Anti-spam
 * ✅ Nigerian slang awareness
 * ✅ Cooldown protection
 * ✅ WhatsApp-friendly behavior
 * ✅ Serious grammar correction only
 */

// =========================
// GROQ CLIENT
// =========================

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
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

// =========================
// SERIOUS ERROR PATTERNS
// =========================

const seriousPatterns = [

    /\bgo school yesterday\b/i,
    /\bhave already did\b/i,
    /\bwas not knowing\b/i,
    /\bdoes people\b/i,
    /\bno understand\b/i,
    /\bwhy she no\b/i,
    /\bwere understanding\b/i,
    /\bhave wrote\b/i,
    /\bcan sings\b/i
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
        now - grammarCooldowns.get(sender) < 900000
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

        const languageToolChanged =
            correctedText.trim().toLowerCase() !==
            textInput.trim().toLowerCase();

        // Minor corrections only
        if (
            languageToolChanged &&
            matches.length <= 2
        ) {

            grammarCooldowns.set(sender, now);

            return correctedText;
        }

        // =========================
        // SERIOUS ERROR CHECK
        // =========================

        const hasSeriousIssue =
            seriousPatterns.some(pattern =>
                pattern.test(textInput)
            );

        // Avoid unnecessary AI calls
        if (
            !hasSeriousIssue &&
            matches.length < 3
        ) {
            return null;
        }

        // =========================
        // AI FALLBACK (GROQ)
        // =========================

        const ai =
            await groq.chat.completions.create({

                model: 'llama3-8b-8192',

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
