const axios = require('axios');

/**
 * 🕵️‍♂️ JARVIS Grammar Watchdog
 * Automatically scans and corrects grammar/spelling issues
 * using LanguageTool API.
 *
 * Optimized for:
 * ✅ WhatsApp group chats
 * ✅ Nigerian English users
 * ✅ Fast execution
 * ✅ Low spam behavior
 */

/**
 * Auto-correct grammar and spelling mistakes
 * @param {string} textInput
 * @returns {Promise<string|null>}
 */
async function autoCorrectGrammar(textInput) {

    // =========================
    // SAFETY FILTERS
    // =========================

    // Ignore empty messages
    if (!textInput) return null;

    // Normalize spacing
    textInput = textInput.trim();

    // Ignore very short messages
    if (textInput.split(/\s+/).length <= 3) {
        return null;
    }

    // Ignore bot commands
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

    // Ignore mostly emojis/symbols
    const plainText = textInput.replace(/[^\w\s]/gi, '');
    if (plainText.length < 5) {
        return null;
    }

    try {

        // =========================
        // PREPARE REQUEST
        // =========================

        const params = new URLSearchParams();

        params.append('text', textInput);

        // Auto-detect English variations
        params.append('language', 'auto');

        // =========================
        // API CALL
        // =========================

        const res = await axios.post(
            'https://api.languagetoolplus.com/v2/check',
            params,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },

                // Slightly relaxed timeout
                timeout: 8000
            }
        );

        // =========================
        // PROCESS RESULTS
        // =========================

        const matches = res.data?.matches || [];

        // No issues found
        if (!matches.length) {
            return null;
        }

        let correctedText = textInput;

        // IMPORTANT:
        // Reverse sort prevents offset corruption
        matches.sort((a, b) => b.offset - a.offset);

        for (const match of matches) {

            // Skip if no replacement exists
            if (!match.replacements?.length) {
                continue;
            }

            const replacement =
                match.replacements[0].value;

            // Skip dangerous blank replacements
            if (
                replacement === undefined ||
                replacement === null
            ) {
                continue;
            }

            // Apply correction safely
            correctedText =
                correctedText.slice(0, match.offset) +
                replacement +
                correctedText.slice(match.offset + match.length);
        }

        // =========================
        // FINAL VALIDATION
        // =========================

        // Avoid spam if nothing changed
        if (
            correctedText.trim().toLowerCase() ===
            textInput.trim().toLowerCase()
        ) {
            return null;
        }

        return correctedText;

    } catch (err) {

        // Silent background failure
        console.log(
            "🕵️‍♂️ Grammar Engine Passive Skip:",
            err.response?.data || err.message
        );

        return null;
    }
}

module.exports = {
    autoCorrectGrammar
};
