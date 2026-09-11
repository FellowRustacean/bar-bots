const db = require('./db');

const getVoiceChannelStmt = db.prepare(`
  SELECT
    channel_id AS channelId,
    guild_id AS guildId,
    owner_id AS ownerId,
    table_number AS tableNumber
  FROM voice_channels
  WHERE channel_id = ?
`);

const getGuildVoiceChannelsStmt = db.prepare(`
  SELECT
    channel_id AS channelId,
    guild_id AS guildId,
    owner_id AS ownerId,
    table_number AS tableNumber
  FROM voice_channels
  WHERE guild_id = ?
`);

const createVoiceChannelStmt = db.prepare(`
  INSERT INTO voice_channels (
    channel_id,
    guild_id,
    owner_id,
    table_number
  )
  VALUES (?, ?, ?, ?)
`);

const deleteVoiceChannelStmt = db.prepare(`
  DELETE FROM voice_channels
  WHERE channel_id = ?
`);

const updateVoiceChannelOwnerStmt = db.prepare(`
  UPDATE voice_channels
  SET owner_id = ?
  WHERE channel_id = ?
`);

function getVoiceChannel(channelId) {
  return getVoiceChannelStmt.get(channelId);
}

function getGuildVoiceChannels(guildId) {
  return getGuildVoiceChannelsStmt.all(guildId);
}

function createVoiceChannel(channelId, guildId, ownerId, tableNumber) {
  createVoiceChannelStmt.run(
    channelId,
    guildId,
    ownerId,
    tableNumber
  );
}

function deleteVoiceChannel(channelId) {
  deleteVoiceChannelStmt.run(channelId);
}

function updateVoiceChannelOwner(channelId, ownerId) {
  updateVoiceChannelOwnerStmt.run(ownerId, channelId);
}

module.exports = {
  getVoiceChannel,
  getGuildVoiceChannels,
  createVoiceChannel,
  deleteVoiceChannel,
  updateVoiceChannelOwner,
};