const db = require('./db');

const ensureStmt = db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)');
const getStmt = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
const setChannelStmt = db.prepare('UPDATE guild_settings SET ticket_channel_id = ? WHERE guild_id = ?');
const setCategoryStmt = db.prepare('UPDATE guild_settings SET ticket_category_id = ? WHERE guild_id = ?');
const setApplicationsStmt = db.prepare(
  'UPDATE guild_settings SET ticket_applications_enabled = ? WHERE guild_id = ?'
);
const setPanelMessageStmt = db.prepare('UPDATE guild_settings SET ticket_panel_message_id = ? WHERE guild_id = ?');
const incrementCounterStmt = db.prepare(
  'UPDATE guild_settings SET ticket_counter = ticket_counter + 1 WHERE guild_id = ? RETURNING ticket_counter AS ticketCounter'
);

function getTicketSettings(guildId) {
  ensureStmt.run(guildId);
  const row = getStmt.get(guildId);
  return {
    channelId: row.ticket_channel_id,
    categoryId: row.ticket_category_id,
    applicationsEnabled: !!row.ticket_applications_enabled,
    panelMessageId: row.ticket_panel_message_id,
  };
}

function setTicketChannel(guildId, channelId) {
  ensureStmt.run(guildId);
  setChannelStmt.run(channelId, guildId);
}

function setTicketCategory(guildId, categoryId) {
  ensureStmt.run(guildId);
  setCategoryStmt.run(categoryId, guildId);
}

function setApplicationsEnabled(guildId, enabled) {
  ensureStmt.run(guildId);
  setApplicationsStmt.run(enabled ? 1 : 0, guildId);
}

function setPanelMessageId(guildId, messageId) {
  ensureStmt.run(guildId);
  setPanelMessageStmt.run(messageId, guildId);
}

function getNextTicketNumber(guildId) {
  ensureStmt.run(guildId);
  return incrementCounterStmt.get(guildId).ticketCounter;
}

module.exports = {
  getTicketSettings,
  setTicketChannel,
  setTicketCategory,
  setApplicationsEnabled,
  setPanelMessageId,
  getNextTicketNumber,
};
