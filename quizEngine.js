const axios = require("axios");

const ALOC_URL =
    "https://questions.aloc.com.ng/api/v2/q";

const QUIZ_DURATION_MS =
    30 * 60 * 1000;

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
const POLL_DURATION_MS = 30 * 1000;
let pollVoteAggregator = null;
let explainQuizAnswer = null;

function configurePollQuiz({ aggregateVotes, explainAnswer } = {}) {
    pollVoteAggregator = typeof aggregateVotes === 'function' ? aggregateVotes : null;
    explainQuizAnswer = typeof explainAnswer === 'function' ? explainAnswer : null;
}

function optionLabel(letter, value) {
    return `${letter}. ${cleanHTML(value || 'N/A')}`.slice(0, 180);
}

async function sendPollQuestion(sock, groupJid, quiz, prefix = '') {
    const options = ['a', 'b', 'c', 'd'];
    const values = options.map((key, index) => optionLabel(String.fromCharCode(65 + index), quiz.option?.[key]));
    const prompt = `${prefix}${String(quiz.subject).toUpperCase()} — ${cleanHTML(quiz.question)}`.slice(0, 250);
    const sent = await sock.sendMessage(groupJid, {
        poll: { name: prompt, values, selectableCount: 1 }
    });
    quiz.pollMessage = sent?.message || null;
    quiz.pollMessageKey = sent?.key || null;
    quiz.pollUpdates = [];
    quiz.pollStartedAt = Date.now();
    quiz.pollClosed = false;
    quiz.pollTimer = setTimeout(() => closePollQuestion(sock, groupJid), POLL_DURATION_MS);
    if (typeof quiz.pollTimer.unref === 'function') quiz.pollTimer.unref();
    activeQuizzes.set(groupJid, quiz);
    return sent;
}

async function startPollQuiz(sock, groupJid, resolved, firstQuestion = null) {
    const question = firstQuestion || await fetchQuiz(resolved.slug);
    const quiz = {
        mode: 'poll', subject: resolved.name, subjectSlug: resolved.slug,
        question: cleanHTML(question.question), option: question.option || {},
        answer: normalizeAnswer(question.answer), solution: cleanHTML(question.solution),
        startedAt: Date.now(), questionNumber: 1
    };
    await sock.sendMessage(groupJid, { text: `🏁 *${resolved.name.toUpperCase()} POLL QUIZ*\n\nYou have *30 seconds* to vote. One vote per participant. No individual student scores are collected.` });
    await sendPollQuestion(sock, groupJid, quiz);
    return { success: true, subject: resolved.name, subjectSlug: resolved.slug, groupJid, mode: 'poll', durationSeconds: 30 };
}

function aggregatePollCounts(sock, quiz) {
    if (!pollVoteAggregator || !quiz.pollMessage || !quiz.pollUpdates?.length) return null;
    try {
        const rows = pollVoteAggregator({ message: quiz.pollMessage, pollUpdates: quiz.pollUpdates }, sock.user?.id);
        if (rows && typeof rows.then === 'function') return rows;
        return rows;
    } catch (error) {
        console.warn('[QUIZ POLL] Vote aggregation failed:', error.message);
        return null;
    }
}

async function closePollQuestion(sock, groupJid) {
    const quiz = activeQuizzes.get(groupJid);
    if (!quiz || quiz.mode !== 'poll' || quiz.pollClosed) return;
    quiz.pollClosed = true;
    if (quiz.pollTimer) clearTimeout(quiz.pollTimer);
    let rows = await aggregatePollCounts(sock, quiz);
    let counts = new Map();
    if (Array.isArray(rows)) {
        for (const row of rows) {
            const name = String(row.name || '').toUpperCase();
            const match = name.match(/^([A-D])\./);
            if (match) counts.set(match[1], Array.isArray(row.voters) ? row.voters.length : Number(row.votes || 0));
        }
    }
    const totalVotes = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const correct = quiz.answer;
    const correctOption = quiz.option?.[correct.toLowerCase()] || '';
    let explanation = quiz.solution || '';
    if (explainQuizAnswer) {
        try {
            const generated = await explainQuizAnswer({ subject: quiz.subject, question: quiz.question, options: quiz.option, answer: correct, solution: quiz.solution });
            if (generated) explanation = String(generated).slice(0, 1800);
        } catch (error) { console.warn('[QUIZ POLL] AI explanation failed:', error.message); }
    }
    if (activeQuizzes.get(groupJid) !== quiz) return;
    const tally = ['A','B','C','D'].map(letter => `${letter}: ${counts.get(letter) || 0}`).join('  |  ');
    const voteStatus = pollVoteAggregator
        ? `📊 Votes: ${totalVotes}\n${tally}`
        : '📊 Vote totals could not be decrypted by this Baileys build; the answer and explanation are still shown.';
    await sock.sendMessage(groupJid, { text: `⏱️ *VOTING CLOSED — QUESTION ${quiz.questionNumber}*\n\n${voteStatus}\n\n✅ *Correct answer: ${correct}*\n${cleanHTML(correctOption)}\n\n📖 *Explanation*\n${explanation || 'No explanation was supplied by ALOC.'}` });
    try {
        const next = await fetchQuiz(quiz.subjectSlug);
        if (activeQuizzes.get(groupJid) !== quiz) return;
        const nextQuiz = { ...quiz, question: cleanHTML(next.question), option: next.option || {}, answer: normalizeAnswer(next.answer), solution: cleanHTML(next.solution), questionNumber: quiz.questionNumber + 1 };
        delete nextQuiz.pollMessage; delete nextQuiz.pollMessageKey; delete nextQuiz.pollUpdates; delete nextQuiz.pollTimer; delete nextQuiz.pollClosed;
        await sendPollQuestion(sock, groupJid, nextQuiz, `QUESTION ${nextQuiz.questionNumber} — `);
    } catch (error) {
        activeQuizzes.delete(groupJid);
        await sock.sendMessage(groupJid, { text: `⚠️ I couldn't load the next ALOC question. The poll quiz has ended.\n${String(error.message).slice(0, 300)}` });
    }
}

function getPollCreationMessage(key) {
    if (!key?.remoteJid || !key?.id) return undefined;
    const quiz = activeQuizzes.get(key.remoteJid);
    if (quiz?.mode === 'poll' && quiz.pollMessageKey?.id === key.id) return quiz.pollMessage;
    return undefined;
}

async function handlePollUpdates(sock, updates = []) {
    if (!Array.isArray(updates)) return;
    for (const item of updates) {
        const update = item?.update || {};
        const pollUpdates = update.pollUpdates;
        if (!Array.isArray(pollUpdates) || !pollUpdates.length) continue;
        const key = item?.key || pollUpdates[0]?.pollUpdateMessageKey;
        const jid = key?.remoteJid;
        if (!jid) continue;
        const quiz = activeQuizzes.get(jid);
        if (!quiz || quiz.mode !== 'poll' || quiz.pollClosed || quiz.pollMessageKey?.id !== key?.id) continue;
        for (const vote of pollUpdates) {
            const voteKey = vote.pollUpdateMessageKey || {};
            const voter = voteKey.participant || voteKey.participantAlt || voteKey.remoteJid || voteKey.id || JSON.stringify(vote).slice(0, 80);
            const existingIndex = quiz.pollUpdates.findIndex(previous => {
                const previousKey = previous.pollUpdateMessageKey || {};
                const previousVoter = previousKey.participant || previousKey.participantAlt || previousKey.remoteJid || previousKey.id || JSON.stringify(previous).slice(0, 80);
                return previousVoter === voter;
            });
            if (existingIndex >= 0) quiz.pollUpdates[existingIndex] = vote;
            else if (quiz.pollUpdates.length < 2000) quiz.pollUpdates.push(vote);
        }
    }
}


// =====================================================
// WHATSAPP CHANNEL NATIVE QUIZ
// =====================================================
// Uses the same ALOC token, endpoint, subject map and question
// normalisation as group quizzes. Channel quizzes intentionally
// do not publish answer keys, explanations, vote totals or scores.
// The correct option is supplied only as the native quiz metadata
// required by WhatsApp's newsletter quiz message type.
// =====================================================

const activeChannelQuizzes = new Map();

function getChannelCorrectOption(question, values) {
    const answer = normalizeAnswer(question?.answer);
    const match = answer.match(/^([A-D])(?:\b|[.)\s:-])/);
    if (!match) return null;
    const index = match[1].charCodeAt(0) - 65;
    return values[index] ? values[index] : null;
}

async function sendChannelQuizQuestion(sock, channelJid, quiz, prefix = '') {
    if (!String(channelJid || '').endsWith('@newsletter')) {
        throw new Error('A valid WhatsApp Channel JID is required.');
    }

    const optionKeys = ['a', 'b', 'c', 'd'];
    const values = optionKeys.map((key, index) =>
        optionLabel(String.fromCharCode(65 + index), quiz.option?.[key])
    );
    if (values.some(value => !value || /\. N\/A$/.test(value))) {
        throw new Error('ALOC did not provide all four answer options for the Channel quiz.');
    }

    const correctAnswer = getChannelCorrectOption(quiz, values);
    if (!correctAnswer) {
        throw new Error('ALOC returned an answer that could not be mapped to options A–D.');
    }

    const name = `${prefix}${String(quiz.subject).toUpperCase()} — ${cleanHTML(quiz.question)}`.slice(0, 250);
    const sent = await sock.sendMessage(channelJid, {
        poll: {
            name,
            values,
            correctAnswer,
            pollType: 1
        }
    });

    quiz.channelMessageKey = sent?.key || null;
    quiz.channelMessage = sent?.message || null;
    quiz.channelStartedAt = Date.now();
    quiz.channelTimer = setTimeout(
        () => advanceChannelQuiz(sock, channelJid),
        POLL_DURATION_MS
    );
    if (typeof quiz.channelTimer.unref === 'function') quiz.channelTimer.unref();
    activeChannelQuizzes.set(channelJid, quiz);
    return sent;
}

async function startChannelQuiz(sock, channelJid, resolved, firstQuestion = null) {
    if (!sock || typeof sock.sendMessage !== 'function') {
        return { success: false, error: 'WhatsApp socket inactive.' };
    }
    if (!String(channelJid || '').endsWith('@newsletter')) {
        return { success: false, error: 'A valid WhatsApp Channel JID is required.' };
    }
    if (activeChannelQuizzes.has(channelJid)) {
        return { success: false, error: 'A Channel quiz is already active. Use !channelquiz off first.' };
    }

    const question = firstQuestion || await fetchQuiz(resolved.slug);
    const quiz = {
        mode: 'channel-quiz',
        subject: resolved.name,
        subjectSlug: resolved.slug,
        question: cleanHTML(question.question),
        option: question.option || {},
        answer: normalizeAnswer(question.answer),
        // Kept in memory for internal validation only. Never posted.
        solution: cleanHTML(question.solution),
        startedAt: Date.now(),
        questionNumber: 1
    };

    await sendChannelQuizQuestion(sock, channelJid, quiz);
    return {
        success: true,
        mode: 'channel-quiz',
        subject: resolved.name,
        subjectSlug: resolved.slug,
        channelJid,
        durationSeconds: POLL_DURATION_MS / 1000,
        answerPublished: false
    };
}

async function advanceChannelQuiz(sock, channelJid) {
    const current = activeChannelQuizzes.get(channelJid);
    if (!current || current.mode !== 'channel-quiz') return;
    if (current.channelTimer) clearTimeout(current.channelTimer);

    try {
        const next = await fetchQuiz(current.subjectSlug);
        if (activeChannelQuizzes.get(channelJid) !== current) return;
        const nextQuiz = {
            ...current,
            question: cleanHTML(next.question),
            option: next.option || {},
            answer: normalizeAnswer(next.answer),
            solution: cleanHTML(next.solution),
            questionNumber: current.questionNumber + 1
        };
        delete nextQuiz.channelMessageKey;
        delete nextQuiz.channelMessage;
        delete nextQuiz.channelTimer;
        await sendChannelQuizQuestion(sock, channelJid, nextQuiz, `QUESTION ${nextQuiz.questionNumber} — `);
    } catch (error) {
        if (activeChannelQuizzes.get(channelJid) === current) {
            activeChannelQuizzes.delete(channelJid);
        }
        console.warn('[CHANNEL QUIZ] Stopped because the next ALOC question could not be published:', error.message);
    }
}

function stopChannelQuiz(channelJid = null) {
    if (channelJid) {
        const current = activeChannelQuizzes.get(channelJid);
        if (current?.channelTimer) clearTimeout(current.channelTimer);
        activeChannelQuizzes.delete(channelJid);
        return;
    }
    for (const current of activeChannelQuizzes.values()) {
        if (current?.channelTimer) clearTimeout(current.channelTimer);
    }
    activeChannelQuizzes.clear();
}

function getActiveChannelQuiz(channelJid) {
    return channelJid ? (activeChannelQuizzes.get(channelJid) || null) : null;
}

async function fireChannelQuiz(sock, quizData = {}) {
    const resolved = resolveSubject(quizData.subject);
    if (!resolved) {
        const subjects = getSubjects().map(item => `• ${item.name}`).join('\n');
        return { success: false, error: `Invalid quiz subject.\n\nAvailable subjects:\n${subjects}` };
    }
    return startChannelQuiz(sock, quizData.channelJid, resolved);
}



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

async function fireQuiz(sock, quizData = {}) {
    if (!sock) return { success: false, error: "WhatsApp socket inactive" };
    const resolved = resolveSubject(quizData.subject);
    if (!resolved) {
        const subjects = getSubjects().map(item => `• ${item.name}`).join("\n");
        return { success: false, error: `Invalid quiz subject.\n\nAvailable subjects:\n${subjects}` };
    }
    const groupJid = quizData.groupJid || quizData.targetGroupJid || "12036342497643845@g.us";
    if (activeQuizzes.has(groupJid)) return { success: false, error: "A quiz is already active in this group." };
    // Poll-only quiz mode: the system records only aggregate poll votes for
    // revealing the answer. It does not identify, rank, or score students.
    return startPollQuiz(sock, groupJid, resolved);
}


async function handleLiveMarking() {
    // Individual text-answer scoring is intentionally disabled. Quiz answers
    // are collected only as aggregate WhatsApp poll results.
    return false;
}


function stopQuiz(
    groupJid = null
) {

    if (groupJid) {
        const current = activeQuizzes.get(groupJid);
        if (current?.pollTimer) clearTimeout(current.pollTimer);
        activeQuizzes.delete(groupJid);


        console.log(

            `🛑 Quiz stopped: ${groupJid}`

        );

    }

    else {
        for (const current of activeQuizzes.values()) if (current?.pollTimer) clearTimeout(current.pollTimer);
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


    configurePollQuiz,
    handlePollUpdates,
    getPollCreationMessage,
    closePollQuestion,
    POLL_DURATION_MS,
    fireChannelQuiz,
    stopChannelQuiz,
    getActiveChannelQuiz,
    advanceChannelQuiz

};
