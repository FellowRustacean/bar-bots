const { getBartresenChannelId } = require('../../storage/barSettings');
const { pickRandomLine } = require('../../../shared/lib/messageLines');
const { buildHelpButton, newDropId } = require('../../../shared/lib/helpButton');

async function canRunItemDrops(client) {
  for (const guild of client.guilds.cache.values()) {
    if (getBartresenChannelId(guild.id)) return true;
  }
  return false;
}

// Quinn laesst am Tresen etwas fallen - erster Klick auf "Helfen" bekommt XP (siehe
// shared/lib/helpButton.js). Nachricht kommt direkt vom eigenen Client (kein Outbox-Umweg
// noetig, anders als bei orderDrink.js - dort "bestellt" ein ANDERER Bot, hier spricht Quinn
// als sie selbst).
async function runItemDrops(client) {
  for (const guild of client.guilds.cache.values()) {
    const bartresenChannelId = getBartresenChannelId(guild.id);
    if (!bartresenChannelId) continue;

    const channel = await guild.channels.fetch(bartresenChannelId).catch(() => null);
    if (!channel) continue;

    const line = pickRandomLine('barkeeper', 'itemDropped');
    const dropId = newDropId();

    await channel.send({ content: line, components: buildHelpButton(dropId) });
    return;
  }
}

module.exports = { canRunItemDrops, runItemDrops };
