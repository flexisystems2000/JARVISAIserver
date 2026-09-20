const axios = require("axios");
const fs = require("fs");
const path = require("path");

const ALOC_URL =
    "https://questions.aloc.com.ng/api/v2/q";

const QUIZ_DURATION_MS =
    30 * 60 * 1000;

const SCORE_FILE =
    path.join(__dirname, "scores.json");


// =====================================================
// ALOC SUBJECT MASTER MAP
// =====================================================
// These mappings come from the subject mapping already
// used by your FlexiEduConsults WAEC selection system.
//
// Display name -> ALOC API subject slug
// =====================================================

const SUBJECTS = {

    "english": {
        name: "English Language",
        slug: "english"
    },

    "mathematics": {
        name: "Mathematics",
        slug: "mathematics"
    },

    "civic education": {
        name: "Civic Education",
        slug: "civiledu"
    },

    "civiceducation": {
        name: "Civic Education",
        slug: "civiledu"
    },

    "civic": {
        name: "Civic Education",
        slug: "civiledu"
    },

    "biology": {
        name: "Biology",
        slug: "biology"
    },

    "chemistry": {
        name: "Chemistry",
        slug: "chemistry"
    },

    "physics": {
        name: "Physics",
        slug: "physics"
    },

    "economics": {
        name: "Economics",
        slug: "economics"
    },

    "government": {
        name: "Government",
        slug: "government"
    },

    "commerce": {
        name: "Commerce",
        slug: "commerce"
    },

    "accounting": {
        name: "Financial Accounting",
        slug: "accounting"
    },

    "financial accounting": {
        name: "Financial Accounting",
        slug: "accounting"
    },

    "financialaccounting": {
        name: "Financial Accounting",
        slug: "accounting"
    },

    "literature": {
        name: "Literature in English",
        slug: "englishlit"
    },

    "literature in english": {
        name: "Literature in English",
        slug: "englishlit"
    },

    "literatureinenglish": {
        name: "Literature in English",
        slug: "englishlit"
    },

    "english literature": {
        name: "Literature in English",
        slug: "englishlit"
    },

    "englishlit": {
        name: "Literature in English",
        slug: "englishlit"
    },

    "geography": {
        name: "Geography",
        slug: "geography"
    },

    "crk": {
        name: "Christian Religious Knowledge (CRK)",
        slug: "crk"
    },

    "christian religious knowledge": {
        name: "Christian Religious Knowledge (CRK)",
        slug: "crk"
    },

    "christianreligiousknowledge": {
        name: "Christian Religious Knowledge (CRK)",
        slug: "crk"
    },

    "christian religious knowledge crk": {
        name: "Christian Religious Knowledge (CRK)",
        slug: "crk"
    },

    "irk": {
        name: "Islamic Religious Knowledge (IRK)",
        slug: "irk"
    },

    "islamic religious knowledge": {
        name: "Islamic Religious Knowledge (IRK)",
        slug: "irk"
    },

    "islamicreligiousknowledge": {
        name: "Islamic Religious Knowledge (IRK)",
        slug: "irk"
    },

    "insurance": {
        name: "Insurance",
        slug: "insurance"
    },

    "history": {
        name: "History",
        slug: "history"
    }

};


// =====================================================
// GROUP QUIZ STORAGE
// =====================================================

const activeQuizzes = new Map();


// =====================================================
// LOAD SAVED SCORES
// =====================================================

let scores = {};

try {

    if (fs.existsSync(SCORE_FILE)) {

        const raw =
            fs.readFileSync(
                SCORE_FILE,
                "utf8"
            );

        scores =
            raw.trim()
                ? JSON.parse(raw)
                : {};
    }

} catch (err) {

    console.log(
        "⚠️ Quiz score file error:",
        err.message
    );

    scores = {};
}


// =====================================================
// SAVE SCORES
// =====================================================

async function saveScores() {

    try {

        await fs.promises.writeFile(

            SCORE_FILE,

            JSON.stringify(
                scores,
                null,
                2
            ),

            "utf8"

        );

    } catch (err) {

        console.log(
            "❌ Quiz score save error:",
            err.message
        );

    }

}


// =====================================================
// NORMALIZE SUBJECT INPUT
// =====================================================

function normalizeSubjectInput(subject) {

    return String(
        subject || ""
    )
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");

}


// =====================================================
// RESOLVE SUBJECT
// =====================================================
// Converts things such as:
//
// Mathematics
// mathematics
// MATH
//
// into the exact ALOC slug.
//
// =====================================================

function resolveSubject(subject) {

    const normalized =
        normalizeSubjectInput(
            subject
        );


    if (!normalized) {

        return null;

    }


    // Direct master-map lookup

    if (
        SUBJECTS[
            normalized
        ]
    ) {

        return SUBJECTS[
            normalized
        ];

    }


    // Remove spaces and try again

    const compact =
        normalized.replace(
            /\s+/g,
            ""
        );


    if (
        SUBJECTS[
            compact
        ]
    ) {

        return SUBJECTS[
            compact
        ];

    }


    // Common short aliases

    const aliases = {

        eng: "english",

        maths: "mathematics",

        math: "mathematics",

        civic: "civic education",

        civics: "civic education",

        bio: "biology",

        chem: "chemistry",

        phy: "physics",

        econ: "economics",

        gov: "government",

        govt: "government",

        comm: "commerce",

        accounts: "accounting",

        account: "accounting",

        lit: "literature in english",

        literatureenglish:
            "literature in english",

        geo: "geography",

        christianreligion:
            "christian religious knowledge",

        christianreligious:
            "christian religious knowledge",

        muslimreligion:
            "islamic religious knowledge",

        islamicreligion:
            "islamic religious knowledge"

    };


    const alias =
        aliases[
            compact
        ];


    if (alias) {

        return SUBJECTS[
            alias
        ];

    }


    return null;

}


// =====================================================
// GET AVAILABLE SUBJECTS
// =====================================================

function getSubjects() {

    const uniqueSubjects =
        new Map();


    Object.values(
        SUBJECTS
    ).forEach(
        subject => {

            uniqueSubjects.set(
                subject.slug,
                subject
            );

        }
    );


    return Array.from(
        uniqueSubjects.values()
    );

}


// =====================================================
// CLEAN HTML
// =====================================================

function cleanHTML(text) {

    if (!text) {

        return "";

    }


    return String(text)

        .replace(
            /<sup>(.*?)<\/sup>/gi,
            "^($1)"
        )

        .replace(
            /<sub>(.*?)<\/sub>/gi,
            "_($1)"
        )

        .replace(
            /<br\s*\/?>/gi,
            "\n"
        )

        .replace(
            /<\/?[^>]+>/g,
            ""
        )

        .trim();

}


// =====================================================
// NORMALIZE ANSWER
// =====================================================

function normalizeAnswer(answer) {

    return String(
        answer || ""
    )
        .toUpperCase()
        .trim();

}


// =====================================================
// USER IDENTIFICATION
// =====================================================

function getUserKey(sender) {

    if (!sender) {

        return null;

    }


    const value =
        String(sender);


    const phone =
        value
            .split("@")[0]
            .replace(
                /[^0-9]/g,
                ""
            );


    return phone || value;

}


function getUserTag(sender) {

    return String(
        sender || ""
    ).split("@")[0];

}


// =====================================================
// ALOC TOKEN
// =====================================================

function getAlocToken() {

    return (
        process.env.ALOC_TOKEN ||
        ""
    );

}


// =====================================================
// FETCH QUESTION FROM ALOC
// =====================================================

async function fetchQuiz(subject) {

    const resolved =
        resolveSubject(
            subject
        );


    if (!resolved) {

        const available =
            getSubjects()
                .map(
                    item =>
                        `• ${item.name}`
                )
                .join("\n");


        throw new Error(

            `Unknown quiz subject: ${subject}\n\n` +

            `Available subjects:\n` +

            available

        );

    }


    const token =
        getAlocToken();


    if (!token) {

        throw new Error(
            "ALOC_TOKEN is not configured on the server."
        );

    }


    console.log(
        `📚 Fetching ALOC question: ${resolved.name} → ${resolved.slug}`
    );


    const response =
        await axios.get(
            ALOC_URL,
            {

                params: {

                    subject:
                        resolved.slug

                },

                headers: {

                    AccessToken:
                        token

                },

                timeout:
                    10000

            }
        );


    const question =
        response.data?.data;


    if (
        !question?.question
    ) {

        throw new Error(
            `ALOC returned an empty question for ${resolved.name}.`
        );

    }


    return {

        ...question,

        subject:
            resolved.name,

        subjectSlug:
            resolved.slug

    };

}


// =====================================================
// SEND QUESTION
// =====================================================

async function sendQuestion(
    sock,
    groupJid,
    quiz,
    prefix = ""
) {

    const questionText =
        cleanHTML(
            quiz.question
        );


    const text =

`${prefix}🧠 *${String(
    quiz.subject
).toUpperCase()} QUIZ*

${questionText}

A. ${quiz.option?.a || "N/A"}
B. ${quiz.option?.b || "N/A"}
C. ${quiz.option?.c || "N/A"}
D. ${quiz.option?.d || "N/A"}

👉 *Reply with A, B, C or D*

⏰ *Quiz session:* 30 minutes`;


    await sock.sendMessage(

        groupJid,

        {
            text
        }

    );

}


// =====================================================
// START QUIZ
// =====================================================

async function fireQuiz(
    sock,
    quizData = {}
) {

    try {

        if (!sock) {

            return {

                success: false,

                error:
                    "WhatsApp socket inactive"

            };

        }


        const requestedSubject =
            quizData.subject;


        const resolved =
            resolveSubject(
                requestedSubject
            );


        if (!resolved) {

            const subjects =
                getSubjects()
                    .map(
                        item =>
                            `• ${item.name}`
                    )
                    .join("\n");


            return {

                success: false,

                error:
                    `Invalid quiz subject.\n\nAvailable subjects:\n${subjects}`

            };

        }


        const groupJid =

            quizData.groupJid ||

            quizData.targetGroupJid ||

            "12036342497643845@g.us";


        // -----------------------------------------
        // Don't start another quiz in same group
        // -----------------------------------------

        if (
            activeQuizzes.has(
                groupJid
            )
        ) {

            return {

                success: false,

                error:
                    "A quiz is already active in this group."

            };

        }


        // -----------------------------------------
        // Get first question
        // -----------------------------------------

        const question =
            await fetchQuiz(
                resolved.slug
            );


        activeQuizzes.set(

            groupJid,

            {

                subject:
                    resolved.name,

                subjectSlug:
                    resolved.slug,

                question:
                    cleanHTML(
                        question.question
                    ),

                option:
                    question.option ||
                    {},

                answer:
                    normalizeAnswer(
                        question.answer
                    ),

                solution:
                    cleanHTML(
                        question.solution
                    ),

                startedAt:
                    Date.now()

            }

        );


        await sendQuestion(

            sock,

            groupJid,

            activeQuizzes.get(
                groupJid
            ),

            "🏁 *QUIZ STARTED*\n\n"

        );


        console.log(

            `✅ Quiz started: ${resolved.name} (${resolved.slug}) → ${groupJid}`

        );


        return {

            success: true,

            subject:
                resolved.name,

            subjectSlug:
                resolved.slug,

            groupJid

        };


    } catch (err) {

        console.log(

            "❌ Quiz start error:",

            err.message

        );


        return {

            success: false,

            error:
                err.message

        };

    }

}


// =====================================================
// LIVE ANSWER MARKING
// =====================================================

async function handleLiveMarking(

    sock,

    jid,

    sender,

    incomingText,

    msgObj

) {

    try {

        const quiz =
            activeQuizzes.get(
                jid
            );


        // -----------------------------------------
        // No quiz in this group
        // -----------------------------------------

        if (!quiz) {

            return false;

        }


        // -----------------------------------------
        // Check expiration
        // -----------------------------------------

        if (

            quiz.startedAt &&

            Date.now() -
                quiz.startedAt >

                QUIZ_DURATION_MS

        ) {

            activeQuizzes.delete(
                jid
            );


            await sock.sendMessage(

                jid,

                {

                    text:

`⏰ *QUIZ SESSION EXPIRED*

The 30-minute quiz session has ended.`

                },

                {

                    quoted:
                        msgObj

                }

            );


            return true;

        }


        const answer =
            normalizeAnswer(
                incomingText
            );


        // -----------------------------------------
        // Only A-D are quiz answers
        // -----------------------------------------

        if (

            ![
                "A",
                "B",
                "C",
                "D"
            ].includes(
                answer
            )

        ) {

            return false;

        }


        const user =
            getUserKey(
                sender
            );


        if (!user) {

            return false;

        }


        const correctAnswer =
            normalizeAnswer(
                quiz.answer
            );


        // =================================================
        // CORRECT ANSWER
        // =================================================

        if (
            answer ===
            correctAnswer
        ) {

            scores[user] =
                (
                    scores[user] ||
                    0
                ) + 1;


            await saveScores();


            await sock.sendMessage(

                jid,

                {

                    text:

`🎉 *@${getUserTag(
    sender
)}* CORRECT!

🏆 +1 Point

📊 Total Score:
*${scores[user]}*`,

                    mentions:
                        [sender]

                },

                {

                    quoted:
                        msgObj

                }

            );

        }


        // =================================================
        // WRONG ANSWER
        // =================================================

        else {

            await sock.sendMessage(

                jid,

                {

                    text:

`❌ *@${getUserTag(
    sender
)}* INCORRECT

👉 Your Answer:
*${answer}*

✅ Correct Answer:
*${correctAnswer}*

📖 Solution:
${
    quiz.solution ||
    "No solution provided."
}`,

                    mentions:
                        [sender]

                },

                {

                    quoted:
                        msgObj

                }

            );

        }


        // =================================================
        // LOAD NEXT QUESTION
        // =================================================

        const subjectSlug =
            quiz.subjectSlug;


        try {

            const next =
                await fetchQuiz(
                    subjectSlug
                );


            activeQuizzes.set(

                jid,

                {

                    subject:
                        quiz.subject,

                    subjectSlug:
                        quiz.subjectSlug,

                    question:
                        cleanHTML(
                            next.question
                        ),

                    option:
                        next.option ||
                        {},

                    answer:
                        normalizeAnswer(
                            next.answer
                        ),

                    solution:
                        cleanHTML(
                            next.solution
                        ),

                    // Keep original timer

                    startedAt:
                        quiz.startedAt

                }

            );


            await sendQuestion(

                sock,

                jid,

                activeQuizzes.get(
                    jid
                ),

                "━━━━━━━━━━━━━━━\n\n" +
                "📌 *NEXT QUESTION*\n\n"

            );


        } catch (err) {

            activeQuizzes.delete(
                jid
            );


            await sock.sendMessage(

                jid,

                {

                    text:

`⚠️ Your answer was recorded, but I couldn't load the next question.

Please start the quiz again.`

                },

                {

                    quoted:
                        msgObj

                }

            );


            console.log(

                "❌ Next quiz question error:",

                err.message

            );

        }


        return true;


    } catch (err) {

        console.log(

            "❌ Live Marking Error:",

            err.message

        );


        return false;

    }

}


// =====================================================
// STOP QUIZ
// =====================================================

function stopQuiz(
    groupJid = null
) {

    if (groupJid) {

        activeQuizzes.delete(
            groupJid
        );


        console.log(

            `🛑 Quiz stopped: ${groupJid}`

        );

    }

    else {

        activeQuizzes.clear();


        console.log(
            "🛑 All quizzes stopped."
        );

    }

}


// =====================================================
// GET ACTIVE QUIZ
// =====================================================

function getActiveQuiz(
    groupJid
) {

    if (!groupJid) {

        return null;

    }


    return (
        activeQuizzes.get(
            groupJid
        ) || null
    );

}


// =====================================================
// GET SUBJECTS
// =====================================================

function getAvailableSubjects() {

    return getSubjects();

}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    fireQuiz,

    handleLiveMarking,

    stopQuiz,

    fetchQuiz,

    getActiveQuiz,

    getAvailableSubjects,

    resolveSubject,

    SUBJECTS,

    scores,

    saveScores

};
