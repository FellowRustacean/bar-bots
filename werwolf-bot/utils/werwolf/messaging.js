const { EmbedBuilder } = require('discord.js');
const { getTeam } = require('./roleDistribution');
const { MENTION_ME } = require('./commandMentions');

const TEAM_LABELS = { dorf: 'Das Dorf', werewolves: 'Werwölfe', solo: 'Solo-/Sub-Teams' };

// --- Haupt-Nachricht: statische Rollenliste, die bei Tod/Aufdeckung aktualisiert wird --------

function buildMainMessageEmbed(game) {
  const byTeam = { dorf: [], werewolves: [], solo: [] };
  for (const [userId, role] of game.assignments) {
    byTeam[getTeam(role)].push({ userId, role });
  }

  const alive = game.round?.alive ?? new Set(game.players);
  const revealed = game.round?.revealedRoles ?? new Set();

  const embed = new EmbedBuilder()
    .setTitle('🐺 Werwolf - Rollenverteilung')
    .setDescription(
      `Rollen werden aufgedeckt, sobald sie öffentlich bekannt werden (z. B. durch Tod). Nutze ${MENTION_ME}, um deine eigene Rolle zu sehen.`
    );

  for (const [team, label] of Object.entries(TEAM_LABELS)) {
    const entries = byTeam[team];
    if (entries.length === 0) continue;

    const lines = entries.map(({ userId, role }) => {
      const who = revealed.has(userId) ? `<@${userId}>` : '???';
      const status = alive.has(userId) ? '' : ' 💀';
      return `${role} - ${who}${status}`;
    });

    embed.addFields({ name: label, value: lines.join('\n') });
  }

  return embed;
}

async function sendMainMessage(client, game) {
  const channel = await client.channels.fetch(game.mainMessageChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const content = game.players.map((id) => `<@${id}>`).join(' ');
  const message = await channel.send({ content, embeds: [buildMainMessageEmbed(game)] }).catch(() => null);
  if (message) game.mainMessageId = message.id;
}

async function updateMainMessage(client, game) {
  if (!game.mainMessageId) return;

  const channel = await client.channels.fetch(game.mainMessageChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(game.mainMessageId).catch(() => null);
  if (!message) return;

  await message.edit({ embeds: [buildMainMessageEmbed(game)] }).catch(() => {});
}

// --- Erzähler-/Spielverlauf-Nachrichten: jedes Ereignis wird als eigene, neue Nachricht gesendet ---

async function updateNarration(client, game, content, components = []) {
  const channel = await client.channels.fetch(game.narratorChannelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ content, components }).catch(() => {});
}

// --- Beendungs-Nachricht: eigenständige, klar sichtbare Nachricht (nicht Teil des Verlaufs-Logs) ---

async function sendEndMessage(client, game, finalMessage) {
  const channel = await client.channels.fetch(game.narratorChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder().setTitle('🏁 Spielende').setDescription(finalMessage);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { buildMainMessageEmbed, sendMainMessage, updateMainMessage, updateNarration, sendEndMessage };
