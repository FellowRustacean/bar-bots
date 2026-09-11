const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUserBadgeGroups } = require('../../storage/badges');

const PAGE_SIZE = 10;

const data = new SlashCommandBuilder()
  .setName('badges')
  .setDescription('Zeigt die Badges eines Nutzers')
  .addUserOption((opt) => opt.setName('user').setDescription('Nutzer (optional)').setRequired(false))
  .addIntegerOption((opt) => opt.setName('page').setDescription('Seite (Standard 1)').setRequired(false).setMinValue(1));

function formatGroup(group) {
  const emoji = group.emoji ?? '🏅';
  const countSuffix = group.count > 1 ? ` ×${group.count}` : '';
  const lastAwarded = `<t:${Math.floor(group.lastAwardedAt / 1000)}:D>`;
  return `${emoji} **${group.label ?? group.badgeKey}**${countSuffix} — zuletzt ${lastAwarded}`;
}

async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const requestedPage = interaction.options.getInteger('page') ?? 1;

  // Ein Eintrag pro Badge-TYP (nicht pro Vergabe) - bleibt also auch bei Badges, die mehrfach
  // wiederholt vergeben werden können, überschaubar, siehe storage/badges.js.
  const groups = getUserBadgeGroups(interaction.guildId, target.id);

  if (groups.length === 0) {
    await interaction.reply({ content: `${target} hat noch keine Badges.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageItems = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalAwards = groups.reduce((sum, g) => sum + g.count, 0);

  const embed = new EmbedBuilder()
    .setTitle(`Badges von ${target.username}`)
    .setDescription(pageItems.map(formatGroup).join('\n'))
    .setFooter({ text: `Seite ${page}/${totalPages} · ${groups.length} Badge-Typ(en) · ${totalAwards} insgesamt` });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
