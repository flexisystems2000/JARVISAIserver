'use strict';
function resolveWhatsAppDisplayName({ message, sender, groupMetadata, contacts, areJidsSameUser } = {}) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const pushName = clean(message?.pushName);
  if (pushName) return pushName;
  const participant = (groupMetadata?.participants || []).find(item => {
    const ids = [item?.id, item?.jid, item?.phoneNumber, item?.lid].filter(Boolean);
    return ids.some(id => {
      try { return typeof areJidsSameUser === 'function' ? areJidsSameUser(id, sender) : String(id) === String(sender); }
      catch (_) { return String(id) === String(sender); }
    });
  });
  const groupName = clean(participant?.notify || participant?.name || participant?.verifiedName);
  if (groupName) return groupName;
  const contact = contacts?.[sender];
  const contactName = clean(contact?.name || contact?.notify || contact?.verifiedName);
  return contactName || 'WhatsApp user';
}
module.exports = { resolveWhatsAppDisplayName };
