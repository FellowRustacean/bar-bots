const { getVoiceSettings } = require('../../storage/voiceSettings');
const { pickRandomLine } = require('../../../shared/lib/messageLines');

// Variiert bewusst zwischen "Tisch abwischen", "Boden fegen" und kleinen Deko-Handlungen, damit
// es sich nicht wie derselbe Satz in Schleife anfühlt. Textbausteine liegen in
// shared/data/messages/kellner.json (Key "tableWipe") - wird bei jedem Aufruf frisch gelesen,
// eine Aenderung dort greift sofort ohne Neustart (siehe messageLines.js).

const MIN_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60_000;

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function randomWipeMessage() {
  return pickRandomLine('kellner', 'tableWipe');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "Tische" sind schlicht die aktuell existierenden Voice-Channels in der konfigurierten Tisch-
// Kategorie (entstehen automatisch durch Beitreten des Erstellungs-Channels, siehe
// customVoice.js) - bewusst direkt aus Discords aktuellem Kanal-Zustand gelesen statt aus der
// eigenen voice_channels-Tabelle, damit es keine Diskrepanz zwischen beidem geben kann. Der
// Erstellungs-Channel selbst zählt nicht als Tisch.
//
// Bewusst KEIN Check auf die letzte Nachricht mehr - ein Tisch gilt immer als abzuwischen,
// unabhängig davon, wer zuletzt dort geschrieben hat (auch wenn das der Kellner selbst war).
async function findAllTables(client) {
  const tables = [];

  for (const guild of client.guilds.cache.values()) {
    const settings = getVoiceSettings(guild.id);
    if (!settings?.voiceCategoryId) continue;

    const allChannels = await guild.channels.fetch().catch(() => null);
    if (!allChannels) continue;

    const tableChannels = allChannels.filter(
      (channel) =>
        channel &&
        channel.parentId === settings.voiceCategoryId &&
        channel.id !== settings.voiceChannelId &&
        channel.isVoiceBased()
    );

    tables.push(...tableChannels.values());
  }

  return tables;
}

async function canRunWipeTables(client) {
  const tables = await findAllTables(client);
  return tables.length > 0;
}

// Wischt alle Tische durch, mit 30-60s zufälliger Pause zwischen den Tischen - pro Tisch genau
// eine zufällige Nachricht aus dem Pool (keine Pause vor dem allerersten Tisch).
async function runWipeTables(client) {
  const tables = await findAllTables(client);

  for (let i = 0; i < tables.length; i++) {
    if (i > 0) await sleep(randomDelay());
    await tables[i].send(`*${randomWipeMessage()}*`).catch(() => {});
  }
}

module.exports = { canRunWipeTables, runWipeTables };
