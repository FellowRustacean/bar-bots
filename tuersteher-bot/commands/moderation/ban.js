const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendModerationLog } = require('../../utils/logs/moderationLog');
const { addBanRecord } = require('../../storage/bans');

const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Bannt einen Nutzer permanent vom Server')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((opt) => opt.setName('user').setDescription('Zu bannender Nutzer').setRequired(true))
  .addStringOption((opt) => opt.setName('grund').setDescription('Grund für den Bann').setRequired(true));

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const grund = interaction.options.getString('grund', true);

  try {
    await user.send(`Du wurdest von **${interaction.guild.name}** aufgrund von **${grund}** permanent gebannt.`);
  } catch (err) {
    // Nutzer hat DMs deaktiviert oder keinen gemeinsamen Server (mehr) - Bann trotzdem fortsetzen
  }

  try {
    await interaction.guild.members.ban(user.id, { reason: grund });
    addBanRecord(interaction.guildId, user.id, user.username);
    await sendModerationLog(interaction.guild, {
      action: 'Bann',
      user,
      moderator: interaction.user,
      reason: grund,
    });
    await interaction.reply({
      content: `${user} wurde permanent gebannt. Grund: ${grund}`,
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
