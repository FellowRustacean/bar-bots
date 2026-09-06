const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration } = require('../../utils/duration');
const { sendModerationLog } = require('../../utils/logs/moderationLog');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord-Limit: 28 Tage

const data = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Schaltet einen Nutzer für einen bestimmten Zeitraum stumm')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((opt) => opt.setName('user').setDescription('Stummzuschaltender Nutzer').setRequired(true))
  .addStringOption((opt) =>
    opt.setName('zeitraum').setDescription('Dauer, z. B. 1d12h30m').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('grund').setDescription('Grund für die Stummschaltung').setRequired(true)
  );

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

  if (durationMs > MAX_TIMEOUT_MS) {
    await interaction.reply({
      content: 'Der Zeitraum darf maximal 28 Tage betragen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const untilTimestamp = Math.floor((Date.now() + durationMs) / 1000);

  try {
    await user.send(
      `Du wurdest auf **${interaction.guild.name}** aufgrund von **${grund}** bis <t:${untilTimestamp}:f> stummgeschaltet.`
    );
  } catch (err) {
    // Nutzer hat DMs deaktiviert - Stummschaltung trotzdem fortsetzen
  }

  try {
    const member = await interaction.guild.members.fetch(user.id);
    await member.timeout(durationMs, grund);
    await sendModerationLog(interaction.guild, {
      action: 'Mute',
      user,
      moderator: interaction.user,
      reason: grund,
      until: untilTimestamp,
    });
    await interaction.reply({
      content: `${user} wurde bis <t:${untilTimestamp}:f> stummgeschaltet. Grund: ${grund}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `${user} konnte nicht stummgeschaltet werden. Stelle sicher, dass der Bot die Berechtigung **Zeitüberschreitung für Mitglieder** hat und seine Rolle über der des Nutzers steht.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
