// In-memory Verwaltung aktiver Werwolf-Lobbys/-Spiele. Ein Spiel ist an einen
// Voice-Channel gebunden - pro Voice-Channel kann höchstens ein aktives Spiel laufen.

const games = new Map(); // voiceChannelId -> game
const tableCounters = new Map(); // guildId -> letzte vergebene Tischnummer

function getNextTableNumber(guildId) {
  const next = (tableCounters.get(guildId) ?? 0) + 1;
  tableCounters.set(guildId, next);
  return next;
}

function createGame(guildId, voiceChannelId, creatorId) {
  const game = {
    guildId,
    voiceChannelId,
    creatorId,
    phase: 'lobby', // 'lobby' | 'starting' | 'night' | 'day' | 'ended' | 'cancelled'
    mode: 'manual', // 'manual' | 'auto' - per /werwolf spiel umschaltbar, Standard: manuell
    players: [creatorId],
    assignments: null, // userId -> roleName (Map), erst nach /werwolf start gesetzt
    werewolfChannelId: null,
    createdAt: Date.now(),
  };

  games.set(voiceChannelId, game);
  return game;
}

function getGameByVoiceChannel(voiceChannelId) {
  return games.get(voiceChannelId) ?? null;
}

function getGameByCreator(userId) {
  for (const game of games.values()) {
    if (game.creatorId === userId && game.phase !== 'cancelled') return game;
  }
  return null;
}

function getGameForPlayer(userId) {
  for (const game of games.values()) {
    if (game.phase !== 'cancelled' && game.players.includes(userId)) return game;
  }
  return null;
}

// Es darf immer nur eine aktive Runde (Lobby oder laufendes Spiel) pro Server geben.
function getActiveGameForGuild(guildId) {
  for (const game of games.values()) {
    if (game.guildId === guildId && game.phase !== 'cancelled' && game.phase !== 'ended') return game;
  }
  return null;
}

function removeGame(voiceChannelId) {
  games.delete(voiceChannelId);
}

module.exports = {
  createGame,
  getGameByVoiceChannel,
  getGameByCreator,
  getGameForPlayer,
  getActiveGameForGuild,
  removeGame,
  getNextTableNumber,
};
