const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js');
const { getTicketSettings, setPanelMessageId } = require('../../storage/ticketSettings');
const { TICKET_TYPES } = require('./ticketTypes');

function buildPanelMessage(applicationsEnabled) {
  const embed = new EmbedBuilder()
    .setTitle('Ticket erstellen')
    .setDescription('Wähle unten eine Kategorie aus, um ein Ticket zu erstellen.');

  const row = new ActionRowBuilder();
  for (const type of Object.values(TICKET_TYPES)) {
    if (type.key === 'application' && !applicationsEnabled) continue;
    row.addComponents(
      new ButtonBuilder().setCustomId(`ticket_open_${type.key}`).setLabel(type.label).setStyle(type.style)
    );
  }

  return { embeds: [embed], components: [row] };
}

async function syncTicketPanel(guild) {
  const settings = getTicketSettings(guild.id);
  if (!settings.channelId) return;

  const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const payload = buildPanelMessage(settings.applicationsEnabled);

  if (settings.panelMessageId) {
    const existing = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return;
    }
  }

  const message = await channel.send(payload);
  setPanelMessageId(guild.id, message.id);
}

module.exports = { buildPanelMessage, syncTicketPanel };
