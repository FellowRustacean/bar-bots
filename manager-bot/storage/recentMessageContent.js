const db = require('./db');

const upsertStmt = db.prepare(`
  INSERT INTO recent_message_content (message_id, guild_id, channel_id, author_id, author_tag, content, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(message_id) DO UPDATE SET content = excluded.content, created_at = excluded.created_at
`);
const getStmt = db.prepare(
  'SELECT author_id AS authorId, author_tag AS authorTag, content FROM recent_message_content WHERE message_id = ?'
);
const deleteStmt = db.prepare('DELETE FROM recent_message_content WHERE message_id = ?');
const deleteOlderThanStmt = db.prepare('DELETE FROM recent_message_content WHERE created_at < ?');

// ON CONFLICT DO UPDATE statt reinem INSERT, da eine bearbeitete Nachricht erneut hier landet
// (siehe messageUpdate-Handler) - der Löschungs-Log soll dann den zuletzt bekannten Inhalt zeigen,
// nicht den ursprünglichen.
function recordMessageContent(message) {
  upsertStmt.run(
    message.id,
    message.guildId,
    message.channelId,
    message.author.id,
    message.author.tag,
    message.content ?? '',
    Date.now()
  );
}

function getStoredMessageContent(messageId) {
  return getStmt.get(messageId) ?? null;
}

function deleteStoredMessageContent(messageId) {
  deleteStmt.run(messageId);
}

function cleanupOldMessageContent(cutoffMs) {
  deleteOlderThanStmt.run(cutoffMs);
}

module.exports = {
  recordMessageContent,
  getStoredMessageContent,
  deleteStoredMessageContent,
  cleanupOldMessageContent,
};
