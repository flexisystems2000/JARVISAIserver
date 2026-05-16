const axios = require('axios');

/**
 * Scans text via LanguageTool API and returns a corrected string if errors are found.
 * Optimized to skip short banter, links, and commands.
 * * @param {string} textInput - The raw message content from the chat
 * @returns {Promise<string|null>} - Returns the corrected text string, or null if text is fine
 */
async function autoCorrectGrammar(textInput) {
    // Skip empty values, short phrases (<= 3 words), links, and bot commands
    if (!textInput || textInput.split(/\s+/).length <= 3 || textInput.startsWith('!') || textInput.includes('http')) {
        return null;
    }

    try {
        const params = new URLSearchParams();
        params.append('text', textInput);
        params.append('language', 'en-NG'); // Optimized for Nigerian English educational contexts

        const res = await axios.post('https://api.languagetoolplus.com/v2/check', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 4000 // Tight timeout to keep your bot lightning fast
        });

        const matches = res.data?.matches || [];
        if (matches.length === 0) return null; // Grammar is completely clean!

        let correctedText = textInput;
        // Sort matches in reverse order so replacements don't break string indices
        matches.sort((a, b) => b.offset - a.offset);

        let errorCount = 0;
        for (const match of matches) {
            // Focus heavily on critical spelling and structural grammar rules
            if (match.rule.issueType === 'misspelling' || match.rule.issueType === 'grammar') {
                const replacement = match.replacements?.[0]?.value;
                if (replacement) {
                    correctedText = correctedText.substring(0, match.offset) + replacement + correctedText.substring(match.offset + match.length);
                    errorCount++;
                }
            }
        }

        // Only return the new string if modifications actually occurred
        return errorCount > 0 ? correctedText : null;
    } catch (err) {
        // Fail silently in the background if the free API tier is congested
        console.log("🕵️‍♂️ Grammar Engine Passive Skip:", err.message);
        return null;
    }
}

module.exports = {
    autoCorrectGrammar
};

