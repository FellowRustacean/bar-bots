const db = require('./db');

const createPollStmt = db.prepare(
  'INSERT INTO polls (guild_id, channel_id, creator_id, question, closed, created_at, closes_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
);
const setMessageIdStmt = db.prepare('UPDATE polls SET message_id = ? WHERE id = ?');
const addOptionStmt = db.prepare('INSERT INTO poll_options (poll_id, position, label) VALUES (?, ?, ?)');

const getPollStmt = db.prepare(`
  SELECT id, guild_id AS guildId, channel_id AS channelId, message_id AS messageId, creator_id AS creatorId,
         question, closed, created_at AS createdAt, closes_at AS closesAt
  FROM polls WHERE id = ?
`);
const getOptionsStmt = db.prepare('SELECT id, position, label FROM poll_options WHERE poll_id = ? ORDER BY position ASC');
const getVoteCountsStmt = db.prepare('SELECT option_id AS optionId, COUNT(*) AS count FROM poll_votes WHERE poll_id = ? GROUP BY option_id');
const setVoteStmt = db.prepare(`
  INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, voted_at = excluded.voted_at
`);
const closePollStmt = db.prepare('UPDATE polls SET closed = 1 WHERE id = ?');
const getExpiredPollIdsStmt = db.prepare('SELECT id FROM polls WHERE closed = 0 AND closes_at <= ?');

function createPoll({ guildId, channelId, creatorId, question, options, closesAt }) {
  const now = Date.now();
  const result = createPollStmt.run(guildId, channelId, creatorId, question, now, closesAt);
  const pollId = result.lastInsertRowid;
  options.forEach((label, index) => addOptionStmt.run(pollId, index, label));
  return pollId;
}

function setPollMessageId(pollId, messageId) {
  setMessageIdStmt.run(messageId, pollId);
}

function getPoll(pollId) {
  const row = getPollStmt.get(pollId);
  return row ? { ...row, closed: !!row.closed } : null;
}

function getPollOptions(pollId) {
  return getOptionsStmt.all(pollId);
}

function getVoteCounts(pollId) {
  const counts = {};
  for (const row of getVoteCountsStmt.all(pollId)) counts[row.optionId] = row.count;
  return counts;
}

function castVote(pollId, userId, optionId) {
  setVoteStmt.run(pollId, userId, optionId, Date.now());
}

function closePoll(pollId) {
  closePollStmt.run(pollId);
}

function getExpiredPollIds(now = Date.now()) {
  return getExpiredPollIdsStmt.all(now).map((row) => row.id);
}

module.exports = {
  createPoll,
  setPollMessageId,
  getPoll,
  getPollOptions,
  getVoteCounts,
  castVote,
  closePoll,
  getExpiredPollIds,
};
