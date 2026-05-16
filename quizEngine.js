const cron = require('node-cron');
const axios = require('axios');

// --- GLOBAL QUIZ STORAGE (RAM-SAFE) ---
let activeQuiz = {
    isActive: false,
    subject: "",
    answers: [], // Holds correct options: ['A', 'C', 'B', ...]
    text: ""
};

// Tracks individual student progress: userId -> { currentQuestionIndex, score }
const quizSessions = new Map();

// 🎯 SET YOUR EXAM GROUP JID HERE
const TARGET_GROUP_JID = "120363304523957291@g.us"; 

/**
 * Initializes the automated Saturday 8 PM WAT Cron Job
 * @param {Object} sock - The Baileys WhatsApp Socket instance
 */
function initializeQuizScheduler(sock) {
    // '0 20 * * 6' runs exactly at 20:00 (8:00 PM) on Saturday (Day 6)
    cron.schedule('0 20 * * 6', async () => {
        console.log("⏰ Saturday 8PM WAT: Initiating Automated Quiz Protocol...");
        
        try {
            if (!sock) return console.log("⚠️ Quiz Scheduler: WhatsApp Socket is inactive.");

            // Clear previous week's data to free up memory
            quizSessions.clear();

            // Call your AI Link server to compile questions
            const res = await axios.post('https://flexieduconsult-ai-link.onrender.com/generate-quiz');
            
            if (res.data?.success) {
                activeQuiz.isActive = true;
                activeQuiz.subject = res.data.subject;
                activeQuiz.answers = res.data.answers;
                activeQuiz.text = res.data.quizText;

                const startMessage = 
                    `${activeQuiz.text}\n\n` +
                    `🏁 *THE MOCK EXAM HAS COMMENCED!*\n` +
                    `👉 To answer *Question 1*, simply reply to this message or type your choice (*A*, *B*, *C*, or *D*).\n` +
                    `⚠️ JARVIS will mark it, tag you, and automatically push you to the next question. You have 30 minutes!`;

                await sock.sendMessage(TARGET_GROUP_JID, { text: startMessage });
                console.log(`✅ Automated weekly quiz for ${activeQuiz.subject} successfully broadcast.`);
            }
        } catch (err) {
            console.log("❌ Quiz Scheduler Error:", err.message);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Lagos" // Strictly locks it to Nigeria time regardless of hosting location
    });
}

/**
 * Validates and scores student answers live in the group chat
 */
async function handleLiveMarking(sock, jid, sender, incomingText, msgObj) {
    // If there is no active quiz, or the message is not from the exam group, ignore it
    if (!activeQuiz.isActive || jid !== TARGET_GROUP_JID) return false;

    const cleanInput = incomingText.toUpperCase().trim();
    
    // Validate if the input is a single character choice option
    if (!["A", "B", "C", "D"].includes(cleanInput) || cleanInput.length !== 1) return false;

    // Set up or fetch student's profile state
    if (!quizSessions.has(sender)) {
        quizSessions.set(sender, { currentQuestionIndex: 0, score: 0 });
    }

    const session = quizSessions.get(sender);
    const currentIndex = session.currentQuestionIndex;

    // If student has already completed all questions, ignore further typing
    if (currentIndex >= activeQuiz.answers.length) return false;

    const correctAnswer = activeQuiz.answers[currentIndex];
    const userTag = sender.split('@')[0];
    let feedback = "";

    // Score comparison logic
    if (cleanInput === correctAnswer) {
        session.score += 1;
        feedback = `✅ *@${userTag}*, *CORRECT!*`;
    } else {
        feedback = `❌ *@${userTag}*, *INCORRECT!* (You chose ${cleanInput})`;
    }

    // Shift user index forward to the next question
    session.currentQuestionIndex += 1;
    const nextQuestionNum = session.currentQuestionIndex + 1;

    if (session.currentQuestionIndex < activeQuiz.answers.length) {
        feedback += `\n➡️ Moving to *Question ${nextQuestionNum}*. Type your next choice!`;
    } else {
        // End of test for this specific student
        const percentage = (session.score / activeQuiz.answers.length) * 100;
        feedback += `\n\n🏁 *QUIZ COMPLETED!*\n🏆 Your Final Score: *${session.score}/${activeQuiz.answers.length}* (${percentage}%)\n\n_Keep preparing with Flexi Digital Academy!_`;
    }

    // Reply and tag the user explicitly inside the group
    await sock.sendMessage(jid, { 
        text: feedback, 
        mentions: [sender] 
    }, { quoted: msgObj });

    // Save updated student progress state back to map cache
    quizSessions.set(sender, session);
    return true; // Returns true to tell the main bot to intercept and stop standard AI processing
}

module.exports = {
    initializeQuizScheduler,
    handleLiveMarking
};
      
