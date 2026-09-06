const db = require('./db');

const getStmt = db.prepare('SELECT thread_id AS threadId FROM voice_channel_log_threads WHERE channel_id = ?');
const insertStmt = db.prepare(`
  INSERT INTO voice_channel_log_threads (channel_id, guild_id, thread_id, created_at)
  VALUES (?, ?, ?, ?)
`);
const markDeletedStmt = db.prepare('UPDATE voice_channel_log_threads SET deleted_at = ? WHERE channel_id = ?');
const dueForCleanupStmt = db.prepare(`
  SELECT channel_id AS channelId, guild_id AS guildId, thread_id AS threadId
  FROM voice_channel_log_threads
  WHERE deleted_at IS NOT NULL AND deleted_at <= ?
`);
const deleteRecordStmt = db.prepare('DELETE FROM voice_channel_log_threads WHERE channel_id = ?');

function getThreadId(channelId) {
  return getStmt.get(channelId)?.threadId ?? null;
}

function saveThreadId(channelId, guildId, threadId) {
  insertStmt.run(channelId, guildId, threadId, Date.now());
}

// Markiert den zugehörigen Voice-Channel als gelöscht (nur relevant, wenn er tatsächlich einen
// Thread hat - kein zusätzlicher Check nötig, ein UPDATE ohne Treffer ist einfach ein No-Op).
function markVoiceChannelDeleted(channelId, deletedAt) {
  markDeletedStmt.run(deletedAt, channelId);
}

function getThreadsDueForCleanup(cutoff) {
  return dueForCleanupStmt.all(cutoff);
}

function deleteThreadRecord(channelId) {
  deleteRecordStmt.run(channelId);
}

module.exports = {
  getThreadId,
  saveThreadId,
  markVoiceChannelDeleted,
  getThreadsDueForCleanup,
  deleteThreadRecord,
};
