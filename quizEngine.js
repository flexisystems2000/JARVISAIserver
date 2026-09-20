const axios = require("axios");
const fs = require("fs");
const path = require("path");

const ALOC_URL = "https://questions.aloc.com.ng/api/v2/q";
const QUIZ_DURATION_MS = 30 * 60 * 1000;

const SCORE_FILE = path.join(__dirname, "scores.json");

// Each group has its own active quiz
const activeQuizzes = new Map();

// Load saved scores
let scores = {};

try {
    if (fs.existsSync(SCORE_FILE)) {
        const raw = fs.readFileSync(SCORE_FILE, "utf8");
        scores = raw.trim() ? JSON.parse(raw) : {};
    }
} catch (err) {
    console.log("⚠️ Quiz score file error:", err.message);
    scores = {};
}


// ===============================
// SAVE SCORES
// ===============================

async function saveScores() {
    try {
        await fs.promises.writeFile(
            SCORE_FILE,
            JSON.stringify(scores, null, 2),
            "utf8"
        );
    } catch (err) {
        console.log("❌ Quiz score save error:", err.message);
    }
}


// ===============================
// CLEAN HTML
// ===============================

function cleanHTML(text) {
    if (!text) return "";

    return String(text)
        .replace(/<sup>(.*?)<\/sup>/gi, "^($1)")
        .replace(/<sub>(.*?)<\/sub>/gi, "_($1)")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/?[^>]+>/g, "")
        .trim();
}


// ===============================
// NORMALIZE ANSWER
// ===============================

function normalizeAnswer(answer) {
    return String(answer || "")
        .toUpperCase()
        .trim();
}


// ===============================
// USER IDENTIFICATION
// ===============================

function getUserKey(sender) {
    if (!sender) return null;

    const value = String(sender);

    const phone = value
        .split("@")[0]
        .replace(/[^0-9]/g, "");

    return phone || value;
}


function getUserTag(sender) {
    return String(sender || "").split("@")[0];
}


// ===============================
// ALOC TOKEN
// ===============================

function getAlocToken() {
    return process.env.ALOC_TOKEN || "";
}


// ===============================
// FETCH QUESTION FROM ALOC
// ===============================

async function fetchQuiz(subject) {

    const normalizedSubject = String(subject || "")
        .toLowerCase()
        .trim();

    if (!normalizedSubject) {
        throw new Error("Quiz subject is required.");
    }

    const token = getAlocToken();

    if (!token) {
        throw new Error(
            "ALOC_TOKEN is not configured on the server."
        );
    }

    const response = await axios.get(ALOC_URL, {
        params: {
            subject: normalizedSubject
        },

        headers: {
            AccessToken: token
        },

        timeout: 10000
    });

    const question = response.data?.data;

    if (!question?.question) {
        throw new Error(
            "ALOC returned an empty question."
        );
    }

    return question;
}


// ===============================
// SEND QUESTION
// ===============================

async function sendQuestion(
    sock,
    groupJid,
    quiz,
    prefix = ""
) {

    const questionText = cleanHTML(
        quiz.question
    );

    const text =
`${prefix}🧠 *${String(quiz.subject).toUpperCase()} QUIZ*

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


// ===============================
// START QUIZ
// ===============================

async function fireQuiz(sock, quizData = {}) {

    try {

        if (!sock) {
            return {
                success: false,
                error: "WhatsApp socket inactive"
            };
        }

        const subject = String(
            quizData.subject || "general"
        )
            .toLowerCase()
            .trim();

        if (!subject) {
            return {
                success: false,
                error: "Quiz subject is required"
            };
        }


        const groupJid =
            quizData.groupJid ||
            quizData.targetGroupJid ||
            "12036342497643845@g.us";


        // Don't start another quiz in same group
        if (activeQuizzes.has(groupJid)) {

            return {
                success: false,
                error: "A quiz is already active in this group."
            };
        }


        // Get first question
        const question =
            await fetchQuiz(subject);


        activeQuizzes.set(
            groupJid,
            {
                subject,

                question:
                    cleanHTML(
                        question.question
                    ),

                option:
                    question.option || {},

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
            activeQuizzes.get(groupJid),
            "🏁 *QUIZ STARTED*\n\n"
        );


        console.log(
            `✅ Quiz started: ${subject} → ${groupJid}`
        );


        return {
            success: true,
            subject,
            groupJid
        };

    } catch (err) {

        console.log(
            "❌ Quiz start error:",
            err.message
        );

        return {
            success: false,
            error: err.message
        };
    }
}


// ===============================
// LIVE ANSWER MARKING
// ===============================

async function handleLiveMarking(
    sock,
    jid,
    sender,
    incomingText,
    msgObj
) {

    try {

        const quiz =
            activeQuizzes.get(jid);


        // No quiz in this group
        if (!quiz) {
            return false;
        }


        // Check expiration
        if (
            quiz.startedAt &&
            Date.now() - quiz.startedAt >
                QUIZ_DURATION_MS
        ) {

            activeQuizzes.delete(jid);

            await sock.sendMessage(
                jid,
                {
                    text:
`⏰ *QUIZ SESSION EXPIRED*

The 30-minute quiz session has ended.`
                },
                {
                    quoted: msgObj
                }
            );

            return true;
        }


        const answer =
            normalizeAnswer(
                incomingText
            );


        // Only A-D should be treated as quiz answers
        if (
            !["A", "B", "C", "D"]
                .includes(answer)
        ) {
            return false;
        }


        const user =
            getUserKey(sender);


        if (!user) {
            return false;
        }


        const correctAnswer =
            normalizeAnswer(
                quiz.answer
            );


        // ===============================
        // CORRECT
        // ===============================

        if (
            answer === correctAnswer
        ) {

            scores[user] =
                (scores[user] || 0) + 1;


            await saveScores();


            await sock.sendMessage(
                jid,
                {
                    text:
`🎉 *@${getUserTag(sender)}* CORRECT!

🏆 +1 Point

📊 Total Score:
*${scores[user]}*`,
                    mentions: [sender]
                },
                {
                    quoted: msgObj
                }
            );

        }


        // ===============================
        // WRONG
        // ===============================

        else {

            await sock.sendMessage(
                jid,
                {
                    text:
`❌ *@${getUserTag(sender)}* INCORRECT

👉 Your Answer:
*${answer}*

✅ Correct Answer:
*${correctAnswer}*

📖 Solution:
${quiz.solution || "No solution provided."}`,
                    mentions: [sender]
                },
                {
                    quoted: msgObj
                }
            );
        }


        // ===============================
        // LOAD NEXT QUESTION
        // ===============================

        const subject =
            quiz.subject;


        try {

            const next =
                await fetchQuiz(subject);


            activeQuizzes.set(
                jid,
                {
                    subject,

                    question:
                        cleanHTML(
                            next.question
                        ),

                    option:
                        next.option || {},

                    answer:
                        normalizeAnswer(
                            next.answer
                        ),

                    solution:
                        cleanHTML(
                            next.solution
                        ),

                    // Keep original session timer
                    startedAt:
                        quiz.startedAt
                }
            );


            await sendQuestion(
                sock,
                jid,
                activeQuizzes.get(jid),
                "━━━━━━━━━━━━━━━\n\n📌 *NEXT QUESTION*\n\n"
            );


        } catch (err) {

            activeQuizzes.delete(jid);

            await sock.sendMessage(
                jid,
                {
                    text:
`⚠️ Your answer was recorded, but I couldn't load the next question.

Please start the quiz again.`
                },
                {
                    quoted: msgObj
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


// ===============================
// STOP QUIZ
// ===============================

function stopQuiz(groupJid = null) {

    if (groupJid) {

        activeQuizzes.delete(
            groupJid
        );

        console.log(
            `🛑 Quiz stopped: ${groupJid}`
        );

    } else {

        activeQuizzes.clear();

        console.log(
            "🛑 All quizzes stopped."
        );
    }
}


// ===============================
// EXPORTS
// ===============================

module.exports = {
    fireQuiz,
    handleLiveMarking,
    stopQuiz,
    fetchQuiz
};
