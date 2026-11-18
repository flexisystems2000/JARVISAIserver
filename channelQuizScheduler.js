'use strict';

const TIME_ZONE = 'Africa/Lagos';
const SUBJECTS = [
  { name: 'Mathematics', slug: 'mathematics', weekdayCount: 30, saturdayCount: 10 },
  { name: 'Biology', slug: 'biology', weekdayCount: 30, saturdayCount: 10 },
  { name: 'Government', slug: 'government', weekdayCount: 30, saturdayCount: 10 },
  { name: 'Economics', slug: 'economics', weekdayCount: 30, saturdayCount: 10 },
  { name: 'Chemistry', slug: 'chemistry', weekdayCount: 30, saturdayCount: 10 },
  { name: 'Physics', slug: 'physics', weekdayCount: 30, saturdayCount: 10 },
  { name: 'CRK', slug: 'crk', weekdayCount: 30, saturdayCount: 10 },
  { name: 'Financial Accounting', slug: 'accounting', weekdayCount: 20, saturdayCount: 10 },
  { name: 'Commerce', slug: 'commerce', weekdayCount: 20, saturdayCount: 10 },
  { name: 'Literature in English', slug: 'englishlit', weekdayCount: 20, saturdayCount: 10 }
];
const WEEKDAYS = {
  1: [SUBJECTS[0]],
  2: [SUBJECTS[1], SUBJECTS[2]],
  3: [SUBJECTS[3], SUBJECTS[4]],
  4: [SUBJECTS[5], SUBJECTS[6]],
  5: SUBJECTS.slice(7)
};

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
function dayNumber(weekday) { return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 })[weekday]; }
function dateKey(p) { return `${p.year}-${p.month}-${p.day}`; }
function scheduleFor(date = new Date()) {
  const p = localParts(date); const day = dayNumber(p.weekday);
  if (day === 6) return { date: dateKey(p), day, hour: 9, minute: 0, interval: 3, subjects: SUBJECTS.map(s => ({ ...s, count: s.saturdayCount })), questionInterval: 3, answerInterval: 3 };
  if (day >= 1 && day <= 5) return { date: dateKey(p), day, hour: 10, minute: 0, interval: 4, subjects: WEEKDAYS[day].map(s => ({ ...s, count: s.weekdayCount })), questionInterval: 4, answerInterval: 5 };
  return null;
}

function createChannelQuizScheduler({ sockProvider, channelJid, quizEngine, askAI, StateModel, logger = console }) {
  let timer = null;
  let running = false;
  let stopped = false;
  const log = (...args) => logger.log('[CHANNEL QUIZ SCHEDULER]', ...args);
  const wait = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); if (t.unref) t.unref(); });
  const waitUntil = async timestamp => { const remaining = timestamp - Date.now(); if (remaining > 0) await wait(remaining); };
  async function save(state) {
    state.lastHeartbeat = new Date();
    if (StateModel) {
      const { _id, __v, ...persisted } = state;
      await StateModel.findOneAndUpdate({ date: state.date }, { $set: persisted }, { upsert: true, new: true });
    }
  }
  async function load(date) { return StateModel ? StateModel.findOne({ date }).lean() : null; }
  async function run(state, plan) {
    if (running) return;
    running = true; stopped = false;
    const heartbeat = setInterval(() => save(state).catch(error => logger.warn('[CHANNEL QUIZ] Could not persist heartbeat:', error.message)), 60_000);
    if (heartbeat.unref) heartbeat.unref();
    try {
      const sock = sockProvider();
      if (!sock?.user || typeof sock.sendMessage !== 'function') throw new Error('WhatsApp socket is not connected.');
      for (let si = state.subjectIndex || 0; si < plan.subjects.length; si++) {
        if (stopped) break;
        const subject = plan.subjects[si];
        state.subjectIndex = si; state.phase = state.phase || 'questions'; state.questions = state.questions || [];
        state.subjectName = subject.name; state.subjectSlug = subject.slug; state.questionCount = subject.count;
        await save(state);
        if (state.phase === 'questions') {
          let nextQuestionAt = state.questions.length
            ? Number(state.questions[state.questions.length - 1].sentAt || Date.now()) + plan.questionInterval * 60 * 1000
            : Date.now();
          for (let qi = state.questions.length; qi < subject.count; qi++) {
            if (stopped) break;
            const question = await quizEngine.fetchQuiz(subject.slug);
            await waitUntil(nextQuestionAt);
            const item = await quizEngine.publishScheduledChannelQuestion(sock, channelJid, subject, question, qi + 1);
            item.number = qi + 1; item.sentAt = Date.now(); state.questions.push(item); state.questionIndex = qi + 1;
            await save(state);
            nextQuestionAt = Date.now() + plan.questionInterval * 60 * 1000;
            log(`${subject.name}: published question ${qi + 1}/${subject.count}`);
          }
          if (stopped) break;
          await waitUntil(nextQuestionAt);
          state.phase = 'answers'; state.answerIndex = state.answerIndex || 0; await save(state);
          await sock.sendMessage(channelJid, { text: `📚 *${subject.name} question session completed.* JARVIS is now preparing the answers and explanations.` });
        }
        if (state.phase === 'answers') {
          let nextAnswerAt = state.lastAnswerSentAt
            ? Number(state.lastAnswerSentAt) + plan.answerInterval * 60 * 1000
            : Date.now();
          for (let ai = state.answerIndex || 0; ai < state.questions.length; ai++) {
            if (stopped) break;
            const item = state.questions[ai];
            const options = item.option || {};
            let explanation = '';
            try {
              explanation = await askAI(`Explain this ${subject.name} multiple-choice question to Nigerian secondary-school students in 3-5 clear sentences. State why the correct option is correct. Do not invent facts.\nQuestion: ${item.question}\nA: ${options.a || ''}\nB: ${options.b || ''}\nC: ${options.c || ''}\nD: ${options.d || ''}\nCorrect option: ${item.answer}\nALOC solution: ${item.solution || 'Not supplied'}`);
            } catch (error) { explanation = 'The correct option is shown above. An explanation could not be generated at this time.'; logger.warn('[CHANNEL QUIZ] Gemini explanation failed:', error.message); }
            await waitUntil(nextAnswerAt);
            await quizEngine.publishScheduledChannelAnswer(sock, channelJid, subject, item, explanation);
            item.answerSentAt = Date.now();
            state.lastAnswerSentAt = item.answerSentAt;
            state.answerIndex = ai + 1; await save(state);
            nextAnswerAt = item.answerSentAt + plan.answerInterval * 60 * 1000;
            log(`${subject.name}: published answer ${ai + 1}/${state.questions.length}`);
          }
          if (!stopped) await waitUntil(nextAnswerAt);
        }
        if (stopped) break;
        state.subjectIndex = si + 1; state.phase = 'questions'; state.questions = []; state.answerIndex = 0; state.questionIndex = 0; state.lastAnswerSentAt = null;
        await save(state);
      }
      if (!stopped) { state.status = 'completed'; state.completedAt = new Date(); await save(state); log(`Schedule ${state.date} completed.`); }
      else { state.status = 'paused'; await save(state); log(`Schedule ${state.date} paused.`); }
    } catch (error) {
      state.status = 'interrupted'; state.lastError = error.message; await save(state).catch(() => {});
      logger.error('[CHANNEL QUIZ SCHEDULER] Run interrupted:', error.stack || error.message);
    } finally { clearInterval(heartbeat); running = false; }
  }
  async function tick() {
    if (stopped || running) return;
    const now = new Date(); const plan = scheduleFor(now); if (!plan) return;
    const p = localParts(now); const startReached = Number(p.hour) > plan.hour || (Number(p.hour) === plan.hour && Number(p.minute) >= plan.minute);
    if (!startReached) return;
    let state;
    if (StateModel) {
      const staleBefore = new Date(Date.now() - 120_000);
      try {
        // Atomic daily claim: only one live process can own this schedule date.
        state = await StateModel.findOneAndUpdate({
          date: plan.date,
          status: { $ne: 'completed' },
          $or: [
            { status: { $ne: 'running' } },
            { lastHeartbeat: { $lt: staleBefore } },
            { lastHeartbeat: { $exists: false } }
          ]
        }, {
          $set: { status: 'running', lastHeartbeat: new Date() },
          $setOnInsert: { subjectIndex: 0, phase: 'questions', questions: [], answerIndex: 0, questionIndex: 0, createdAt: new Date() }
        }, { upsert: true, new: true }).lean();
      } catch (error) {
        if (error?.code === 11000) return; // a completed or currently-owned daily record already exists
        throw error;
      }
      if (!state) return;
    } else {
      state = await load(plan.date);
      if (state?.status === 'completed') return;
      if (state?.status === 'running' && state.lastHeartbeat && (Date.now() - new Date(state.lastHeartbeat).getTime()) < 120_000) return;
      state = state || { date: plan.date, subjectIndex: 0, phase: 'questions', questions: [], answerIndex: 0, questionIndex: 0, createdAt: new Date() };
      state.status = 'running'; await save(state);
    }
    await run(state, plan);
  }
  function start() { if (timer) return; stopped = false; timer = setInterval(() => tick().catch(e => logger.error('[CHANNEL QUIZ SCHEDULER]', e)), 30_000); if (timer.unref) timer.unref(); tick().catch(e => logger.error('[CHANNEL QUIZ SCHEDULER]', e)); log('Enabled; waiting for the Africa/Lagos schedule and a connected WhatsApp socket.'); }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick, get running() { return running; } };
}

module.exports = { createChannelQuizScheduler, scheduleFor, SUBJECTS, TIME_ZONE };
