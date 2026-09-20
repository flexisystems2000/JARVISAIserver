// ============================================================
// JARVIS AI — NATURAL LANGUAGE ROUTER 2.0
// ============================================================
//
// Converts ordinary human language into JARVIS intents.
//
// IMPORTANT:
// This module does NOT execute commands.
// It only determines what the user wants.
//
// Existing command handlers remain responsible for actually
// performing the requested action and checking permissions.
// ============================================================

const VALID_INTENTS = [
    "menu",
    "timetable",
    "listadmins",
    "listonline",
    "ginfo",
    "getjid",
    "image",
    "pay",
    "name",
    "kick",
    "promote",
    "add",
    "mute",
    "unmute",
    "reset",
    "define",
    "createfile",
    "vv",
    "ai"
];


// ============================================================
// NORMALIZE AI RESPONSE
// ============================================================

function cleanAIResponse(response) {

    if (!response) {
        return null;
    }

    let text =
        String(response)
            .trim();

    // Remove markdown code fences
    text =
        text
            .replace(/^```json/i, "")
            .replace(/^```/i, "")
            .replace(/```$/i, "")
            .trim();

    return text;
}


// ============================================================
// EXTRACT JSON
// ============================================================

function extractJSON(response) {

    const cleaned =
        cleanAIResponse(response);

    if (!cleaned) {
        return null;
    }

    try {
        return JSON.parse(cleaned);
    } catch (_) {}

    // Try to locate a JSON object inside
    const start =
        cleaned.indexOf("{");

    const end =
        cleaned.lastIndexOf("}");

    if (
        start !== -1 &&
        end !== -1 &&
        end > start
    ) {

        try {

            return JSON.parse(
                cleaned.slice(
                    start,
                    end + 1
                )
            );

        } catch (_) {}
    }

    return null;
}


// ============================================================
// LOCAL FALLBACK CLASSIFIER
// ============================================================
//
// This allows common requests to work even if the AI service
// temporarily fails.
// ============================================================

function localClassify(text) {

    const value =
        String(text || "")
            .toLowerCase()
            .trim();

    // --------------------------------------------------------
    // MENU / HELP
    // --------------------------------------------------------

    if (
        /\b(what can you do|what do you do|how do i use you|help me|show.*commands|your commands)\b/i
            .test(value)
    ) {
        return {
            intent: "menu",
            confidence: 0.98,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // ADMINS
    // --------------------------------------------------------

    if (
        (
            /\bwho\b.*\b(admin|admins|administrator|administrators|owner|owners|managers|moderators)\b/i
                .test(value)
            ||
            /\b(admin|admins|administrator|administrators)\b.*\b(list|show|tell|who)\b/i
                .test(value)
        )
    ) {
        return {
            intent: "listadmins",
            confidence: 0.95,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // ONLINE MEMBERS
    // --------------------------------------------------------

    if (
        /\b(who|which members|members)\b.*\b(online|active|available)\b/i
            .test(value)
    ) {
        return {
            intent: "listonline",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // GROUP INFORMATION
    // --------------------------------------------------------

    if (
        /\b(group|chat)\b.*\b(info|information|details|about)\b/i
            .test(value)
        ||
        /\b(tell|show)\b.*\b(about|details of)\b.*\b(this group|this chat)\b/i
            .test(value)
    ) {
        return {
            intent: "ginfo",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // TIMETABLE
    // --------------------------------------------------------

    if (
        /\b(timetable|schedule|class schedule|class timetable|classes)\b/i
            .test(value)
        &&
        /\b(show|send|give|tell|what|when|today|tomorrow|have|class)\b/i
            .test(value)
    ) {
        return {
            intent: "timetable",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // GROUP ID / JID
    // --------------------------------------------------------

    if (
        /\b(group|chat)\b.*\b(id|jid|identifier)\b/i
            .test(value)
    ) {
        return {
            intent: "getjid",
            confidence: 0.95,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // DICTIONARY
    // --------------------------------------------------------

    if (
        /\b(meaning|definition|define|dictionary)\b/i
            .test(value)
        ||
        /\bwhat does\b.+\bmean\b/i
            .test(value)
    ) {

        return {
            intent: "define",
            confidence: 0.94,
            arguments: {
                query: value
            }
        };
    }


    // --------------------------------------------------------
    // IMAGE GENERATION
    // --------------------------------------------------------

    if (
        /\b(generate|create|make|draw)\b/i
            .test(value)
        &&
        /\b(image|picture|photo|artwork|drawing)\b/i
            .test(value)
    ) {

        return {
            intent: "image",
            confidence: 0.95,
            arguments: {
                prompt: value
            }
        };
    }


    // --------------------------------------------------------
    // PAYMENT
    // --------------------------------------------------------

    if (
        /\b(pay|payment|subscribe|subscription|subscription fee)\b/i
            .test(value)
    ) {

        return {
            intent: "pay",
            confidence: 0.93,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // NAME
    // --------------------------------------------------------

    if (
        /\b(my name is|call me|save my name|remember my name)\b/i
            .test(value)
    ) {

        return {
            intent: "name",
            confidence: 0.98,
            arguments: {
                name: value
                    .replace(
                        /^(my name is|call me|save my name as|remember my name is?)\s*/i,
                        ""
                    )
                    .trim()
            }
        };
    }


    // --------------------------------------------------------
    // KICK / REMOVE
    // --------------------------------------------------------

    if (
        /\b(kick|remove|ban)\b/i
            .test(value)
    ) {

        return {
            intent: "kick",
            confidence: 0.91,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // PROMOTE
    // --------------------------------------------------------

    if (
        /\b(promote|make)\b/i.test(value)
        &&
        /\b(admin|administrator)\b/i.test(value)
    ) {

        return {
            intent: "promote",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // ADD / INVITE
    // --------------------------------------------------------

    if (
        /\b(add|invite)\b/i.test(value)
        &&
        (
            /\d{7,}/.test(value)
            ||
            /\b(person|member|someone|him|her|them)\b/i
                .test(value)
        )
    ) {

        return {
            intent: "add",
            confidence: 0.91,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // MUTE / LOCK
    // --------------------------------------------------------

    if (
        /\b(mute|lock|close|restrict)\b/i
            .test(value)
        &&
        /\b(group|chat|members|everyone)\b/i
            .test(value)
    ) {

        return {
            intent: "mute",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // UNMUTE / UNLOCK
    // --------------------------------------------------------

    if (
        /\b(unmute|unlock|open|restore)\b/i
            .test(value)
        &&
        /\b(group|chat|members|messaging|chatting)\b/i
            .test(value)
    ) {

        return {
            intent: "unmute",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // RESET WARNINGS
    // --------------------------------------------------------

    if (
        /\b(reset|clear|remove)\b/i
            .test(value)
        &&
        /\b(warning|warnings|strike|strikes)\b/i
            .test(value)
    ) {

        return {
            intent: "reset",
            confidence: 0.91,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // VIEW ONCE
    // --------------------------------------------------------

    if (
        /\b(view[- ]once)\b/i
            .test(value)
        &&
        /\b(save|download|open|show|reveal|get)\b/i
            .test(value)
    ) {

        return {
            intent: "vv",
            confidence: 0.94,
            arguments: {}
        };
    }


    // --------------------------------------------------------
    // GENERAL AI QUESTION
    // --------------------------------------------------------

    if (
        /\b(explain|tell me|help me|solve|why|how|what|who|can you|could you)\b/i
            .test(value)
    ) {

        return {
            intent: "ai",
            confidence: 0.80,
            arguments: {
                prompt: value
            }
        };
    }


    return null;
}


// ============================================================
// AI INTENT CLASSIFIER
// ============================================================

async function classifyWithAI(
    text,
    askAI
) {

    if (
        typeof askAI !== "function"
    ) {
        return null;
    }

    const prompt = `
You are the intent router for JARVIS AI, a WhatsApp group assistant.

Your job is NOT to answer the user.

Your job is to determine what the user is trying to do and map the request
to ONE of these existing JARVIS intents:

${VALID_INTENTS.join(", ")}

IMPORTANT RULES:

1. Return ONLY valid JSON.
2. Never return markdown.
3. Never invent an intent.
4. If the user is simply asking a normal question or wants an explanation,
   use "ai".
5. If the user is asking about group administrators, use "listadmins".
6. If the user is asking about online/active members, use "listonline".
7. If the user wants group information/details, use "ginfo".
8. If the user wants the timetable/schedule/classes, use "timetable".
9. If the user wants the group ID/JID, use "getjid".
10. If the user wants a definition/meaning of a word, use "define".
11. If the user wants an image/picture generated, use "image".
12. If the user wants payment/subscription information, use "pay".
13. If the user wants to save/change their name, use "name".
14. If the user wants somebody removed/kicked, use "kick".
15. If the user wants somebody promoted to admin, use "promote".
16. If the user wants somebody added/invited, use "add".
17. If the user wants the group locked/restricted, use "mute".
18. If the user wants the group opened/unlocked, use "unmute".
19. If the user wants warnings/strikes cleared, use "reset".
20. If the user wants a view-once message saved/downloaded, use "vv".
21. Use confidence between 0 and 1.
22. Do not execute anything.

Return exactly:

{
  "intent": "intent_name",
  "confidence": 0.00,
  "arguments": {
    "prompt": "",
    "name": "",
    "target": "",
    "duration": ""
  }
}

USER MESSAGE:
${text}
`;

    try {

        const response =
            await askAI(prompt);

        const parsed =
            extractJSON(response);

        if (!parsed) {
            return null;
        }

        if (
            !VALID_INTENTS.includes(
                parsed.intent
            )
        ) {
            return null;
        }

        const confidence =
            Number(parsed.confidence);

        if (
            !Number.isFinite(confidence)
        ) {
            return null;
        }

        return {
            intent:
                parsed.intent,

            confidence,

            arguments:
                parsed.arguments &&
                typeof parsed.arguments === "object"
                    ? parsed.arguments
                    : {}
        };

    } catch (err) {

        console.log(
            "❌ NLU AI CLASSIFIER ERROR:",
            err.message
        );

        return null;
    }
}


// ============================================================
// MAIN CLASSIFIER
// ============================================================

async function classifyIntent(
    text,
    askAI
) {

    const local =
        localClassify(text);

    // Strong local match:
    // no AI request required.
    if (
        local &&
        local.confidence >= 0.90
    ) {
        return {
            ...local,
            source: "local"
        };
    }


    // AI understands unusual human phrasing.
    const ai =
        await classifyWithAI(
            text,
            askAI
        );

    if (
        ai &&
        ai.confidence >= 0.82
    ) {
        return {
            ...ai,
            source: "ai"
        };
    }


    // Local weak fallback.
    if (local) {
        return {
            ...local,
            source: "local-fallback"
        };
    }


    return null;
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    classifyIntent,
    localClassify,
    classifyWithAI,
    VALID_INTENTS
};
