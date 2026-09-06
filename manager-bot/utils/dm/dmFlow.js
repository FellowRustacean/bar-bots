const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getDmThread } = require('../../storage/dmThreads');
const { enqueueOutboxMessage } = require('../../storage/outbox');
const { BOT_PERSONAS } = require('../personas/botPersonas');

const CONFIRM_PREFIX = 'dm_confirm:';
const CANCEL_PREFIX = 'dm_cancel:';

function confirmationButtons(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX}${messageId}`).setLabel('Senden').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${CANCEL_PREFIX}${messageId}`).setLabel('Verwerfen').setStyle(ButtonStyle.Secondary)
  );
}

// Wird aus messageCreate im Haupt-Handler aufgerufen, fuer JEDE Nachricht - prueft selbst, ob der
// Channel ueberhaupt ein bekannter DM-Thread ist (siehe /dm), sonst No-Op. Reagiert bewusst nicht
// auf leere Nachrichten (nur Anhang/Embed) - dafuer ist dieser Fluss nicht gedacht.
async function handlePotentialDmDraft(message) {
  if (message.author.bot || !message.content.trim()) return;
  if (!message.channel.isThread?.()) return;

  const mapping = getDmThread(message.channelId);
  if (!mapping) return;

  const persona = BOT_PERSONAS.find((p) => p.name === mapping.botName);

  await message.reply({
    content:
      `Als **${persona?.label ?? mapping.botName}** an <@${mapping.targetUserId}> senden?\n` +
      `> ${message.content.replaceAll('\n', '\n> ')}`,
    components: [confirmationButtons(message.id)],
  });
}

async function handleButton(interaction) {
  const isConfirm = interaction.customId.startsWith(CONFIRM_PREFIX);
  const isCancel = interaction.customId.startsWith(CANCEL_PREFIX);
  if (!isConfirm && !isCancel) return false;

  // Dieselbe Berechtigung wie zum Anlegen des Threads (/dm) - verhindert, dass irgendwer mit
  // Zugriff auf den DM-Kanal versehentlich (oder mutwillig) eine fremde Nachricht bestaetigt.
  if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ content: 'Dafür fehlt dir die Berechtigung.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const originalMessageId = interaction.customId.slice(interaction.customId.indexOf(':') + 1);

  if (isCancel) {
    await interaction.update({ content: '❌ Verworfen.', components: [] });
    return true;
  }

  const mapping = getDmThread(interaction.channelId);
  if (!mapping) {
    await interaction.update({ content: '⚠️ Dieser Thread ist keinem DM-Auftrag mehr zugeordnet.', components: [] });
    return true;
  }

  const originalMessage = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
  if (!originalMessage) {
    await interaction.update({ content: '⚠️ Ursprüngliche Nachricht wurde nicht mehr gefunden.', components: [] });
    return true;
  }

  enqueueOutboxMessage({
    botName: mapping.botName,
    action: 'dm_send',
    guildId: mapping.guildId,
    channelId: interaction.channelId,
    content: originalMessage.content,
    targetUserId: mapping.targetUserId,
  });

  await interaction.update({ content: '✅ Bestätigt, wird gesendet...', components: [] });
  return true;
}

module.exports = { handlePotentialDmDraft, handleButton };
