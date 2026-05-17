const axios = require('axios');

// =====================================================
// GLOBAL QUIZ STORAGE
// =====================================================

let activeQuiz = {
    isActive: false,
    subject: "",
    answers: [],
    questions: [],
    text: "",
    startedAt: null
};

// =====================================================
// STUDENT SESSIONS
// sender -> { currentQuestionIndex, score }
// =====================================================

const quizSessions = new Map();

// =====================================================
// QUIZ SETTINGS
// =====================================================

const TARGET_GROUP_JID =
    "12036342497643845@g.us";

const QUIZ_DURATION_MS =
    30 * 60 * 1000; // 30 Minutes

// =====================================================
// AUTO QUIZ CLEANUP TIMER
// =====================================================

setInterval(() => {

    if (
        activeQuiz.isActive &&
        activeQuiz.startedAt &&
        Date.now() - activeQuiz.startedAt >
        QUIZ_DURATION_MS
    ) {

        console.log("🛑 Quiz expired automatically.");

        activeQuiz = {
            isActive: false,
            subject: "",
            answers: [],
            questions: [],
            text: "",
            startedAt: null
        };

        quizSessions.clear();
    }

}, 60000);

// =====================================================
// EXTRACT QUESTIONS FROM QUIZ BLOCK
// =====================================================

function extractQuestions(quizText) {

    try {

        const cleaned =
            quizText
                .replace(/\r/g, "")
                .trim();

        const matches =
            cleaned.match(
                /\d+\.\s[\s\S]*?(?=(\n\d+\.\s)|$)/g
            );

        return matches || [];

    } catch {

        return [];
    }
}

// =====================================================
// FIRE QUIZ
// =====================================================

async function fireQuiz(sock, quizData) {

    try {

        if (!sock) {

            return {
                success: false,
                error: "WhatsApp socket inactive"
            };
        }

        // =========================
        // RESET OLD DATA
        // =========================

        quizSessions.clear();

        // =========================
        // LOAD NEW QUIZ
        // =========================

        activeQuiz.isActive = true;

        activeQuiz.subject =
            quizData.subject || "General Quiz";

        activeQuiz.answers =
            Array.isArray(quizData.answers)
                ? quizData.answers
                : [];

        activeQuiz.text =
            quizData.quizText || "";

        activeQuiz.questions =
            extractQuestions(
                activeQuiz.text
            );

        activeQuiz.startedAt =
            Date.now();

        // =========================
        // SAFETY CHECK
        // =========================

        if (
            !activeQuiz.answers.length ||
            !activeQuiz.questions.length
        ) {

            console.log(
                "❌ Invalid quiz payload"
            );

            return {
                success: false,
                error: "Invalid quiz payload"
            };
        }

        // =========================
        // START MESSAGE
        // =========================

        const startMessage =
`📚 *${activeQuiz.subject.toUpperCase()} MOCK TEST* 📚

🏁 *THE QUIZ HAS STARTED*

🧠 Total Questions:
${activeQuiz.answers.length}

⏰ Duration:
30 Minutes

📌 HOW TO ANSWER:
Simply reply with:
A
B
C
or
D

⚠️ JARVIS will mark your answer instantly and move you to the next question automatically.

━━━━━━━━━━━━━━━

${activeQuiz.questions[0]}`;

        // =========================
        // SEND TO GROUP
        // =========================

        await sock.sendMessage(
            TARGET_GROUP_JID,
            {
                text: startMessage
            }
        );

        console.log(
            `✅ Quiz Broadcasted: ${activeQuiz.subject}`
        );

        return {
            success: true
        };

    } catch (err) {

        console.log(
            "❌ fireQuiz Error:",
            err.message
        );

        return {
            success: false,
            error: err.message
        };
    }
}

// =====================================================
// LIVE MARKING ENGINE
// =====================================================

async function handleLiveMarking(
    sock,
    jid,
    sender,
    incomingText,
    msgObj
) {

    try {

        // =========================
        // QUIZ ACTIVE CHECK
        // =========================

        if (!activeQuiz.isActive) {
            return false;
        }

        // =========================
        // GROUP CHECK
        // =========================

        if (jid !== TARGET_GROUP_JID) {
            return false;
        }

        // =========================
        // CLEAN INPUT
        // =========================

        const cleanInput =
            incomingText
                .toUpperCase()
                .trim();

        // =========================
        // VALID OPTION CHECK
        // =========================

        if (
            !["A", "B", "C", "D"]
                .includes(cleanInput)
        ) {

            return false;
        }

        // =========================
        // CREATE SESSION
        // =========================

        if (!quizSessions.has(sender)) {

            quizSessions.set(sender, {

                currentQuestionIndex: 0,

                score: 0
            });
        }

        const session =
            quizSessions.get(sender);

        const currentIndex =
            session.currentQuestionIndex;

        // =========================
        // QUIZ FINISHED
        // =========================

        if (
            currentIndex >=
            activeQuiz.answers.length
        ) {

            return true;
        }

        // =========================
        // ANSWER CHECK
        // =========================

        const correctAnswer =
            activeQuiz.answers[currentIndex]
                ?.toUpperCase()
                ?.trim();

        const userTag =
            sender.split("@")[0];

        let feedback = "";

        if (
            cleanInput === correctAnswer
        ) {

            session.score++;

            feedback =
`✅ *@${userTag}* CORRECT!

🎯 Your Answer:
${cleanInput}`;
        }

        else {

            feedback =
`❌ *@${userTag}* INCORRECT

👉 Your Answer:
${cleanInput}

✅ Correct Answer:
${correctAnswer}`;
        }

        // =========================
        // MOVE TO NEXT QUESTION
        // =========================

        session.currentQuestionIndex++;

        // =========================
        // MORE QUESTIONS LEFT
        // =========================

        if (
            session.currentQuestionIndex <
            activeQuiz.questions.length
        ) {

            const nextQuestion =
                activeQuiz.questions[
                    session.currentQuestionIndex
                ];

            feedback +=
`\n\n━━━━━━━━━━━━━━━

📌 NEXT QUESTION:

${nextQuestion}`;

        }

        // =========================
        // QUIZ FINISHED FOR USER
        // =========================

        else {

            const total =
                activeQuiz.answers.length;

            const percentage =
                Math.round(
                    (session.score / total) * 100
                );

            let grade = "F";

            if (percentage >= 80) {
                grade = "A";
            }

            else if (percentage >= 70) {
                grade = "B";
            }

            else if (percentage >= 60) {
                grade = "C";
            }

            else if (percentage >= 50) {
                grade = "D";
            }

            feedback +=
`\n\n🏁 *QUIZ COMPLETED*

📚 Subject:
${activeQuiz.subject}

🏆 Score:
${session.score}/${total}

📊 Percentage:
${percentage}%

🎖 Grade:
${grade}

_Keep practicing with Flexi Digital Academy 🚀_`;
        }

        // =========================
        // SAVE SESSION
        // =========================

        quizSessions.set(
            sender,
            session
        );

        // =========================
        // SEND FEEDBACK
        // =========================

        await sock.sendMessage(

            jid,

            {
                text: feedback,
                mentions: [sender]
            },

            {
                quoted: msgObj
            }
        );

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
// FORCE STOP QUIZ
// =====================================================

function stopQuiz() {

    activeQuiz = {

        isActive: false,
        subject: "",
        answers: [],
        questions: [],
        text: "",
        startedAt: null
    };

    quizSessions.clear();

    console.log("🛑 Quiz manually stopped.");
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    fireQuiz,

    handleLiveMarking,

    stopQuiz
};
