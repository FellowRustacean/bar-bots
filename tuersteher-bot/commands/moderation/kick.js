const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendModerationLog } = require('../../utils/logs/moderationLog');

const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kickt einen Nutzer vom Server')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((opt) => opt.setName('user').setDescription('Zu kickender Nutzer').setRequired(true))
  .addStringOption((opt) => opt.setName('grund').setDescription('Grund für den Kick').setRequired(true));

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const grund = interaction.options.getString('grund', true);

  try {
    await user.send(`Du wurdest von **${interaction.guild.name}** aufgrund von **${grund}** gekickt.`);
  } catch (err) {
    // Nutzer hat DMs deaktiviert oder keinen gemeinsamen Server (mehr) - Kick trotzdem fortsetzen
  }

  try {
    const member = await interaction.guild.members.fetch(user.id);
    await member.kick(grund);
    await sendModerationLog(interaction.guild, {
      action: 'Kick',
      user,
      moderator: interaction.user,
      reason: grund,
    });
    await interaction.reply({
      content: `${user} wurde gekickt. Grund: ${grund}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `${user} konnte nicht gekickt werden. Stelle sicher, dass der Bot die Berechtigung **Mitglieder kicken** hat und seine Rolle über der des Nutzers steht.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
