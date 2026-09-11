const db = require('./db');

const addStmt = db.prepare(`
  INSERT INTO reminders (user_id, channel_id, guild_id, comment, remind_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const listStmt = db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at ASC');
const deleteStmt = db.prepare('DELETE FROM reminders WHERE id = ?');
const dueStmt = db.prepare('SELECT * FROM reminders WHERE remind_at <= ?');

function addReminder({ userId, channelId, guildId, comment, remindAt }) {
  addStmt.run(userId, channelId, guildId, comment, remindAt, Date.now());
}

function listReminders(userId) {
  return listStmt.all(userId);
}

// Entfernt die n-te Erinnerung (1-basiert) aus der sortierten Liste des Nutzers.
function removeReminderAt(userId, index) {
  const reminders = listReminders(userId);
  const target = reminders[index - 1];
  if (!target) return null;
  deleteStmt.run(target.id);
  return target;
}

function getDueReminders(now) {
  return dueStmt.all(now);
}

function deleteReminder(id) {
  deleteStmt.run(id);
}

module.exports = { addReminder, listReminders, removeReminderAt, getDueReminders, deleteReminder };
