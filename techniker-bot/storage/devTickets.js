const db = require('./db');

const STATUSES = ['open', 'done', 'postponed', 'closed'];

const insertStmt = db.prepare(`
  INSERT INTO dev_tickets (thread_id, guild_id, title, status, created_at)
  VALUES (?, ?, ?, 'open', ?)
`);
const getStmt = db.prepare('SELECT * FROM dev_tickets WHERE thread_id = ?');
const setStatusStmt = db.prepare('UPDATE dev_tickets SET status = ? WHERE thread_id = ?');
const setControlMessageIdStmt = db.prepare('UPDATE dev_tickets SET control_message_id = ? WHERE thread_id = ?');
const searchByTitleStmt = db.prepare(`
  SELECT thread_id AS threadId, title FROM dev_tickets
  WHERE guild_id = ? AND title LIKE ? ESCAPE '\\'
  ORDER BY created_at DESC
  LIMIT 25
`);
const listStmt = db.prepare(`
  SELECT thread_id AS threadId, title, status, created_at AS createdAt FROM dev_tickets
  WHERE guild_id = ? AND status = ?
  ORDER BY created_at DESC
  LIMIT ? OFFSET ?
`);
const countStmt = db.prepare('SELECT COUNT(*) AS count FROM dev_tickets WHERE guild_id = ? AND status = ?');

function escapeLike(str) {
  return str.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toTicket(row) {
  if (!row) return null;
  return {
    threadId: row.thread_id,
    guildId: row.guild_id,
    title: row.title,
    status: row.status,
    controlMessageId: row.control_message_id,
    createdAt: row.created_at,
  };
}

function createTicket({ threadId, guildId, title, createdAt }) {
  insertStmt.run(threadId, guildId, title, createdAt);
}

function getTicket(threadId) {
  return toTicket(getStmt.get(threadId));
}

function setStatus(threadId, status) {
  setStatusStmt.run(status, threadId);
}

function setControlMessageId(threadId, messageId) {
  setControlMessageIdStmt.run(messageId, threadId);
}

function searchTicketsByTitle(guildId, query) {
  return searchByTitleStmt.all(guildId, `%${escapeLike(query)}%`);
}

function listTickets(guildId, status, offset, limit) {
  return listStmt.all(guildId, status, limit, offset).map(toTicket);
}

function countTickets(guildId, status) {
  return countStmt.get(guildId, status)?.count ?? 0;
}

module.exports = {
  STATUSES,
  createTicket,
  getTicket,
  setStatus,
  setControlMessageId,
  searchTicketsByTitle,
  listTickets,
  countTickets,
};
