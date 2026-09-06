const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getStammgastRoleId } = require('../../storage/roleSettings');
const { isSilenceRevoked } = require('../../storage/stammgastSilence');
const { sendModerationLog } = require('../../utils/logs/moderationLog');
const { logError } = require('../../utils/logs/errorLog');

const SILENCE_DURATION_MS = 8 * 60 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000; // Aufräumfrist für nie bestätigte/abgelehnte Anfragen

// Kurzlebiger Zwischenspeicher für Bestätigungen, wie pendingWarns in warns.js (Manager) - bewusst
// in-memory, übersteht keinen Bot-Neustart, handleButton() fängt das als "abgelaufen" ab.
const pendingSilences = new Map();

function sweepExpiredPending() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of pendingSilences) {
    if (entry.createdAt < cutoff) pendingSilences.delete(id);
  }
}

const data = new SlashCommandBuilder()
  .setName('silence')
  .setDescription('Stammgast-Recht: schaltet einen Nutzer für 8 Stunden stumm')
  .addUserOption((opt) => opt.setName('user').setDescription('Nutzer').setRequired(true));

function confirmationButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`silence_confirm:${id}`).setLabel('Bestätigen').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`silence_cancel:${id}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
  );
}

async function executeSilence(guild, moderator, targetUser) {
  const untilTimestamp = Math.floor((Date.now() + SILENCE_DURATION_MS) / 1000);

  try {
    await targetUser.send(
      `Du wurdest auf **${guild.name}** von einem Stammgast bis <t:${untilTimestamp}:f> stummgeschaltet.`
    );
  } catch (err) {
    // DMs deaktiviert - Stummschaltung trotzdem fortsetzen
  }

  const member = await guild.members.fetch(targetUser.id);
  await member.timeout(SILENCE_DURATION_MS, `Stammgast-/silence durch ${moderator.tag}`);

  await sendModerationLog(guild, {
    action: 'Stammgast-Silence',
    user: targetUser,
    moderator,
    reason: '8 Stunden Stummschaltung (Stammgast-Recht)',
    until: untilTimestamp,
  });

  return untilTimestamp;
}

async function execute(interaction) {
  const stammgastRoleId = getStammgastRoleId(interaction.guildId);

  if (!stammgastRoleId || !interaction.member.roles.cache.has(stammgastRoleId)) {
    await interaction.reply({
      content: 'Dieser Befehl ist nur für Stammgäste.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isSilenceRevoked(interaction.guildId, interaction.user.id)) {
    await interaction.reply({
      content: 'Dir wurde das `/silence`-Recht entzogen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: 'Du kannst dich nicht selbst stummschalten.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (targetUser.bot) {
    await interaction.reply({ content: 'Bots können nicht stummgeschaltet werden.', flags: MessageFlags.Ephemeral });
    return;
  }

  sweepExpiredPending();
  const id = interaction.id;
  pendingSilences.set(id, {
    guildId: interaction.guildId,
    moderatorId: interaction.user.id,
    targetUserId: targetUser.id,
    createdAt: Date.now(),
  });

  await interaction.reply({
    content:
      `${targetUser} für 8 Stunden stummschalten?\n` +
      '⚠️ Missbrauch kann zu Entzug dieses Rechts und weiteren Sanktionen führen.',
    components: [confirmationButtons(id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleButton(interaction) {
  const [action, id] = interaction.customId.split(':');
  const pending = pendingSilences.get(id);
  pendingSilences.delete(id);

  if (!pending) {
    await interaction.update({ content: 'Diese Anfrage ist abgelaufen. Bitte den Befehl erneut ausführen.', components: [] });
    return;
  }

  if (action === 'silence_cancel') {
    await interaction.update({ content: 'Abgebrochen.', components: [] });
    return;
  }

  const guild = await interaction.client.guilds.fetch(pending.guildId);
  const moderator = await interaction.client.users.fetch(pending.moderatorId);
  const targetUser = await interaction.client.users.fetch(pending.targetUserId);

  try {
    const untilTimestamp = await executeSilence(guild, moderator, targetUser);
    await interaction.update({ content: `${targetUser} wurde bis <t:${untilTimestamp}:f> stummgeschaltet.`, components: [] });
  } catch (err) {
    await logError(err, { context: '/silence ausführen', guildId: pending.guildId });
    await interaction.update({ content: `${targetUser} konnte nicht stummgeschaltet werden.`, components: [] });
  }
}

module.exports = { data, execute, handleButton };
