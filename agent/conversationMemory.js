'use strict';

function getConversationKey(chatJid, userJid) {
  return `${String(chatJid || 'unknown-chat')}::${String(userJid || 'unknown-user')}`;
}

function buildConversationRecords({ chatJid, userJid, userText, assistantText, interactionId }) {
  if (!chatJid || !userJid) return [];
  const conversationKey = getConversationKey(chatJid, userJid);
  const common = {
    conversationKey,
    userJid: String(userJid),
    chatJid: String(chatJid),
    ...(interactionId ? { interactionId: String(interactionId).slice(0, 200) } : {})
  };
  const records = [];
  if (typeof userText === 'string' && userText.trim()) {
    records.push({ ...common, role: 'user', content: userText.trim().slice(0, 12000) });
  }
  if (typeof assistantText === 'string' && assistantText.trim()) {
    records.push({ ...common, role: 'assistant', content: assistantText.trim().slice(0, 12000) });
  }
  return records;
}

async function saveConversationTurn(Model, input) {
  if (!Model) return false;
  const records = buildConversationRecords(input);
  if (!records.length) return false;
  if (input.interactionId && typeof Model.updateOne === 'function') {
    for (const record of records) {
      try {
        await Model.updateOne(
          { conversationKey: record.conversationKey, interactionId: record.interactionId, role: record.role },
          { $setOnInsert: record },
          { upsert: true }
        );
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
  } else if (typeof Model.insertMany === 'function') {
    await Model.insertMany(records, { ordered: true });
  }
  // Keep the existing bounded history policy: at most 200 recent records.
  if (typeof Model.find === 'function') {
    const oldRecords = await Model.find({ conversationKey: records[0].conversationKey })
      .sort({ createdAt: -1 }).skip(200).select('_id').lean();
    if (oldRecords.length && typeof Model.deleteMany === 'function') {
      await Model.deleteMany({ _id: { $in: oldRecords.map(item => item._id) } });
    }
  }
  return true;
}

async function getConversationContext(Model, chatJid, userJid, limit = 12) {
  if (!Model || !chatJid || !userJid || typeof Model.find !== 'function') return '';
  const messages = await Model.find({ conversationKey: getConversationKey(chatJid, userJid) })
    .sort({ createdAt: -1 })
    .limit(Math.max(2, Math.min(Number(limit) || 12, 20)))
    .lean();
  if (!messages.length) return '';
  return messages.reverse().map(item => `${item.role === 'assistant' ? 'JARVIS' : 'USER'}: ${item.content}`).join('\n');
}

module.exports = { getConversationKey, buildConversationRecords, saveConversationTurn, getConversationContext };
