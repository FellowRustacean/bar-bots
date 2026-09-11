const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { revokeSilence, restoreSilence } = require('../../storage/stammgastSilence');

const data = new SlashCommandBuilder()
  .setName('stammgast')
  .setDescription('Gibt einem Stammgast das /silence-Recht oder nimmt es ihm')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((opt) => opt.setName('user').setDescription('Stammgast').setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName('silence')
      .setDescription('/silence-Recht an- oder abschalten')
      .setRequired(true)
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
  );

async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const status = interaction.options.getString('silence', true);

  if (status === 'off') {
    revokeSilence(interaction.guildId, user.id);
    await interaction.reply({ content: `${user} kann \`/silence\` nicht mehr nutzen.`, flags: MessageFlags.Ephemeral });
    return;
  }

  restoreSilence(interaction.guildId, user.id);
  await interaction.reply({ content: `${user} kann \`/silence\` wieder nutzen.`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
