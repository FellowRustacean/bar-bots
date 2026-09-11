const { getLogChannel } = require('../../storage/guildConfig');
const { pickRandomLine } = require('../../../shared/lib/messageLines');
const { buildHelpButton, newDropId } = require('../../../shared/lib/helpButton');

// "welcome"-Log-Channel (siehe /config welcome, storage/guildConfig.js) - das ist die tatsaechlich
// aktive Lobby (check-llm-geflaggt, wo die Charaktere mit echten Nutzern chatten), NICHT
// entry_channel_id (der separate Beitritts-/Regelwerk-Channel, kaum Aktivitaet - siehe Session-
// Debugging 02.09.).
function getLobbyChannelId(guildId) {
  return getLogChannel(guildId, 'welcome') ?? null;
}

async function canRunItemDrops(client) {
  for (const guild of client.guilds.cache.values()) {
    if (getLobbyChannelId(guild.id)) return true;
  }
  return false;
}

// Benedict laesst in der Lobby etwas fallen - erster Klick auf "Helfen" bekommt XP (siehe
// shared/lib/helpButton.js).
async function runItemDrops(client) {
  for (const guild of client.guilds.cache.values()) {
    const lobbyChannelId = getLobbyChannelId(guild.id);
    if (!lobbyChannelId) continue;

    const channel = await guild.channels.fetch(lobbyChannelId).catch(() => null);
    if (!channel) continue;

    const line = pickRandomLine('kellner', 'itemDropped');
    const dropId = newDropId();

    await channel.send({ content: line, components: buildHelpButton(dropId) });
    return;
  }
}

module.exports = { canRunItemDrops, runItemDrops };
