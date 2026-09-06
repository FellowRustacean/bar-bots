const db = require('./db');

const addStmt = db.prepare(
  'INSERT INTO tickets (channel_id, team_channel_id, guild_id, user_id, type, number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

const SELECT_FIELDS = `channel_id AS channelId, team_channel_id AS teamChannelId, guild_id AS guildId,
       user_id AS userId, type, number, logging_enabled AS loggingEnabled`;

const getByUserChannelStmt = db.prepare(`SELECT ${SELECT_FIELDS} FROM tickets WHERE channel_id = ?`);
const getByTeamChannelStmt = db.prepare(`SELECT ${SELECT_FIELDS} FROM tickets WHERE team_channel_id = ?`);
const removeStmt = db.prepare('DELETE FROM tickets WHERE channel_id = ?');
const setLoggingEnabledStmt = db.prepare('UPDATE tickets SET logging_enabled = ? WHERE channel_id = ?');

const linkRelayStmt = db.prepare(
  'INSERT OR REPLACE INTO ticket_message_relays (message_id, channel_id, paired_message_id, paired_channel_id) VALUES (?, ?, ?, ?)'
);
const getRelayPartnerStmt = db.prepare(
  'SELECT paired_message_id AS messageId, paired_channel_id AS channelId FROM ticket_message_relays WHERE message_id = ?'
);
const removeRelaysForChannelsStmt = db.prepare(
  'DELETE FROM ticket_message_relays WHERE channel_id = ? OR channel_id = ?'
);

function addTicket({ channelId, teamChannelId, guildId, userId, type, number }) {
  addStmt.run(channelId, teamChannelId, guildId, userId, type, number, Date.now());
}

function normalize(row) {
  if (!row) return null;
  return { ...row, loggingEnabled: !!row.loggingEnabled };
}

function getTicketByUserChannel(channelId) {
  return normalize(getByUserChannelStmt.get(channelId));
}

function getTicketByTeamChannel(channelId) {
  return normalize(getByTeamChannelStmt.get(channelId));
}

// Findet ein Ticket unabhängig davon, ob die Anfrage aus dem Nutzer- oder dem Team-Channel kam.
function getTicketByEitherChannel(channelId) {
  const userSide = getTicketByUserChannel(channelId);
  if (userSide) return { ticket: userSide, side: 'user' };

  const teamSide = getTicketByTeamChannel(channelId);
  if (teamSide) return { ticket: teamSide, side: 'team' };

  return null;
}

function removeTicket(channelId) {
  removeStmt.run(channelId);
}

function setLoggingEnabled(channelId, enabled) {
  setLoggingEnabledStmt.run(enabled ? 1 : 0, channelId);
}

// Speichert die Verknüpfung in beide Richtungen, damit die Gegenstelle unabhängig davon
// gefunden wird, auf welcher Seite die Reaktion tatsächlich passiert.
function linkRelayedMessages(messageIdA, channelIdA, messageIdB, channelIdB) {
  linkRelayStmt.run(messageIdA, channelIdA, messageIdB, channelIdB);
  linkRelayStmt.run(messageIdB, channelIdB, messageIdA, channelIdA);
}

function getRelayPartner(messageId) {
  return getRelayPartnerStmt.get(messageId) ?? null;
}

function removeRelaysForChannels(channelIdA, channelIdB) {
  removeRelaysForChannelsStmt.run(channelIdA, channelIdB ?? channelIdA);
}

module.exports = {
  addTicket,
  getTicketByUserChannel,
  getTicketByTeamChannel,
  getTicketByEitherChannel,
  removeTicket,
  setLoggingEnabled,
  linkRelayedMessages,
  getRelayPartner,
  removeRelaysForChannels,
};
