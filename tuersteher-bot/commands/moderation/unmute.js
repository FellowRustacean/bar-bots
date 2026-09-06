const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendModerationLog } = require('../../utils/logs/moderationLog');

const data = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Hebt die Stummschaltung eines Nutzers auf')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((opt) => opt.setName('user').setDescription('Nutzer, dessen Stummschaltung aufgehoben wird').setRequired(true))
  .addStringOption((opt) => opt.setName('grund').setDescription('Grund für die Aufhebung').setRequired(false));

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const grund = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

  try {
    const member = await interaction.guild.members.fetch(user.id);

    if (!member.communicationDisabledUntilTimestamp) {
      await interaction.reply({
        content: `${user} ist aktuell nicht stummgeschaltet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await member.timeout(null, grund);

    await sendModerationLog(interaction.guild, {
      action: 'Entmutet',
      user,
      moderator: interaction.user,
      reason: grund,
    });

    await interaction.reply({
      content: `${user} wurde entstummt. Grund: ${grund}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `${user} konnte nicht entstummt werden. Stelle sicher, dass der Bot die Berechtigung **Zeitüberschreitung für Mitglieder** hat.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
