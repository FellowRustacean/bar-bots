const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration } = require('../../utils/duration');
const { addTempban } = require('../../storage/tempbans');
const { sendModerationLog } = require('../../utils/logs/moderationLog');
const { addBanRecord } = require('../../storage/bans');

const data = new SlashCommandBuilder()
  .setName('tempban')
  .setDescription('Bannt einen Nutzer für einen bestimmten Zeitraum')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((opt) => opt.setName('user').setDescription('Zu bannender Nutzer').setRequired(true))
  .addStringOption((opt) =>
    opt.setName('zeitraum').setDescription('Dauer, z. B. 1d12h30m').setRequired(true)
  )
  .addStringOption((opt) => opt.setName('grund').setDescription('Grund für den Bann').setRequired(true));

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const zeitraumStr = interaction.options.getString('zeitraum', true);
  const grund = interaction.options.getString('grund', true);

  const durationMs = parseDuration(zeitraumStr);
  if (!durationMs) {
    await interaction.reply({
      content: 'Ungültiger Zeitraum. Format: `_d_h_m`, z. B. `1d12h30m`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const unbanAt = Date.now() + durationMs;
  const unbanTimestamp = Math.floor(unbanAt / 1000);

  try {
    await user.send(
      `Du wurdest von **${interaction.guild.name}** aufgrund von **${grund}** bis <t:${unbanTimestamp}:f> gebannt.`
    );
  } catch (err) {
    // Nutzer hat DMs deaktiviert oder keinen gemeinsamen Server (mehr) - Bann trotzdem fortsetzen
  }

  try {
    await interaction.guild.members.ban(user.id, { reason: grund });
    addTempban(interaction.guildId, user.id, unbanAt);
    addBanRecord(interaction.guildId, user.id, user.username);
    await sendModerationLog(interaction.guild, {
      action: 'Temp-Bann',
      user,
      moderator: interaction.user,
      reason: grund,
      until: unbanTimestamp,
    });
    await interaction.reply({
      content: `${user} wurde bis <t:${unbanTimestamp}:f> gebannt. Grund: ${grund}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `${user} konnte nicht gebannt werden. Stelle sicher, dass der Bot die Berechtigung **Bannen** hat und seine Rolle über der des Nutzers steht.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
