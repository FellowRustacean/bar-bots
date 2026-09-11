const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { adjustTotalXp, setTotalXp } = require('../../storage/xp');
const { formatNumber } = require('../../utils/format/number');

const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Bearbeitet die XP eines Nutzers')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Fügt einem Nutzer XP hinzu')
      .addUserOption((opt) => opt.setName('user').setDescription('Nutzer').setRequired(true))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('Menge').setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Entfernt XP von einem Nutzer')
      .addUserOption((opt) => opt.setName('user').setDescription('Nutzer').setRequired(true))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('Menge').setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Setzt die XP eines Nutzers auf einen festen Wert')
      .addUserOption((opt) => opt.setName('user').setDescription('Nutzer').setRequired(true))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('Menge').setRequired(true).setMinValue(0))
  );

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  let total;
  if (subcommand === 'add') {
    total = adjustTotalXp(interaction.guildId, user.id, amount);
  } else if (subcommand === 'remove') {
    total = adjustTotalXp(interaction.guildId, user.id, -amount);
  } else {
    total = setTotalXp(interaction.guildId, user.id, amount);
  }

  await interaction.reply({
    content: `${user} hat jetzt **${formatNumber(total)} XP**.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
