// KEIN require('discord.js') hier - shared/lib-Dateien haben bewusst keine eigenen npm-
// Abhaengigkeiten (kein eigenes node_modules), siehe dmThreadFlow.js im selben Ordner. Discord.js
// akzeptiert bei components ohnehin rohe, API-konforme Objekte genauso wie Builder-Instanzen -
// deshalb hier direkt die rohe API-Struktur statt ActionRowBuilder/ButtonBuilder.

const { randomUUID } = require('crypto');

const CUSTOM_ID_PREFIX = 'item_drop_help:';
const MIN_XP = 50;
const MAX_XP = 100;

// Prozess-lokal (jede Nachricht wird nur von IHREM eigenen Bot-Prozess empfangen - Discord
// liefert Button-Interaktionen nur an die Anwendung, der die Nachricht gehoert). Der Check-and-
// Set passiert SYNCHRON, vor jedem await, damit zwei quasi-gleichzeitige Klicks innerhalb
// desselben Prozesses nicht beide durchkommen (Node ist single-threaded, zwischen den beiden
// Zeilen kann kein zweiter Klick dazwischenfunken).
const claimed = new Set();

function newDropId() {
  return randomUUID();
}

function buildHelpButton(dropId) {
  // type 1 = ActionRow, type 2 = Button; style 3 = Success (gruen).
  return [
    {
      type: 1,
      components: [{ type: 2, style: 3, label: 'Helfen', custom_id: `${CUSTOM_ID_PREFIX}${dropId}` }],
    },
  ];
}

function randomXp() {
  return MIN_XP + Math.floor(Math.random() * (MAX_XP - MIN_XP + 1));
}

// adjustTotalXp wird vom Aufrufer reingereicht (siehe itemDrops.js - cross-Prozess-Import aus
// manager-bot/storage/xp.js, dieselbe Stelle, die auch /xp add/remove nutzt). Bewusst NICHT
// addXp(): das zaehlt ins Tages-/Monatslimit (DAILY_CAP=1000) - dieser Bonus soll explizit
// AUSSERHALB davon liegen, auf Nutzerwunsch (siehe Session-Historie 02.09.).
async function handleHelpButtonClick(interaction, adjustTotalXp) {
  if (!interaction.customId.startsWith(CUSTOM_ID_PREFIX)) return false;

  const dropId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);
  if (claimed.has(dropId)) {
    await interaction.reply({ content: 'Da war schon jemand schneller!', ephemeral: true }).catch(() => {});
    return true;
  }
  claimed.add(dropId);

  const xpGained = randomXp();
  adjustTotalXp(interaction.guildId, interaction.user.id, xpGained);

  const displayName = interaction.member?.displayName ?? interaction.user.username;
  const originalContent = interaction.message.content;

  await interaction
    .update({
      content: `${originalContent}\n\n\u2705 **${displayName}** hat geholfen und **${xpGained} XP** bekommen!`,
      components: [],
    })
    .catch(() => {});

  return true;
}

module.exports = { buildHelpButton, handleHelpButtonClick, newDropId, CUSTOM_ID_PREFIX };
