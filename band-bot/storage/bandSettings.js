const db = require('./db');

const getStmt = db.prepare(
  `SELECT
    band_voice_channel_id AS channelId,
    band_vote_message_id AS voteMessageId,
    band_player_message_id AS playerMessageId
  FROM guild_settings WHERE guild_id = ?`
);
const setVoteMessageStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, band_vote_message_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET band_vote_message_id = excluded.band_vote_message_id
`);
const setPlayerMessageStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, band_player_message_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET band_player_message_id = excluded.band_player_message_id
`);

function getBandVoiceChannelId(guildId) {
  return getStmt.get(guildId)?.channelId ?? null;
}

function getBandVoteMessageId(guildId) {
  return getStmt.get(guildId)?.voteMessageId ?? null;
}

function setBandVoteMessageId(guildId, messageId) {
  setVoteMessageStmt.run(guildId, messageId);
}

// "Player-Nachricht" = das kombinierte Embed (Jetzt läuft + Bewertung + Skip) - loeste die
// vorherigen zwei getrennten Nachrichten (Skip allein) ab.
function getBandPlayerMessageId(guildId) {
  return getStmt.get(guildId)?.playerMessageId ?? null;
}

function setBandPlayerMessageId(guildId, messageId) {
  setPlayerMessageStmt.run(guildId, messageId);
}

module.exports = {
  getBandVoiceChannelId,
  getBandVoteMessageId,
  setBandVoteMessageId,
  getBandPlayerMessageId,
  setBandPlayerMessageId,
};
