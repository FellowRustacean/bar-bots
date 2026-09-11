const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');

const MAX_COUNT = 100; // Discords bulkDelete erlaubt maximal 100 Nachrichten pro Aufruf
const DEFAULT_COUNT = 100; // wenn nur "user" angegeben ist, ohne eigene "count"-Vorgabe
const SCAN_LIMIT = 500; // Sicherheitsdeckel gegen endloses Zurueckscannen in ruhigen Kanaelen

const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Löscht die letzten Nachrichten in diesem Kanal (Bulk Delete)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((opt) =>
    opt
      .setName('count')
      .setDescription(`Anzahl Nachrichten (max. ${MAX_COUNT}, Standard bei nur "user": ${DEFAULT_COUNT})`)
      .setMinValue(1)
      .setMaxValue(MAX_COUNT)
      .setRequired(false)
  )
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Nur Nachrichten dieses Nutzers löschen').setRequired(false)
  );

// Scannt rueckwaerts durch den Kanal, bis "targetCount" Nachrichten DIESES Nutzers gefunden sind
// (oder SCAN_LIMIT erreicht ist) - "count" bezieht sich auf Treffer des Nutzers, nicht auf die
// rohe Kanal-Position, sonst waere die Angabe bei selten schreibenden Nutzern quasi wirkungslos.
async function collectUserMessages(channel, userId, targetCount) {
  const collected = [];
  let before;
  let scanned = 0;

  while (collected.length < targetCount && scanned < SCAN_LIMIT) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    for (const message of batch.values()) {
      if (message.author.id === userId) {
        collected.push(message);
        if (collected.length >= targetCount) break;
      }
    }

    before = batch.last().id;
    scanned += batch.size;
    if (batch.size < 100) break;
  }

  return collected;
}

async function logClear(interaction, channel, user, deletedCount) {
  const logChannelId = getLogChannel(interaction.guildId, 'moderation');
  if (!logChannelId) return;

  const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle('Clear')
    .addFields(
      { name: 'Kanal', value: `${channel}` },
      { name: 'Anzahl', value: `${deletedCount}` },
      { name: 'Nutzer', value: user ? `${user} (${user.tag})` : 'Alle' },
      { name: 'Teammitglied', value: `${interaction.user} (${interaction.user.tag})` }
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

async function execute(interaction) {
  const count = interaction.options.getInteger('count');
  const user = interaction.options.getUser('user');

  if (count === null && !user) {
    await interaction.reply({ content: '❌ Gib mindestens `count` oder `user` an.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased() || channel.isDMBased()) {
    await interaction.reply({ content: '❌ Das geht nur in einem Server-Textkanal.', flags: MessageFlags.Ephemeral });
    return;
  }

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: '❌ Mir fehlt die Berechtigung **Nachrichten verwalten** in diesem Kanal.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetCount = count ?? DEFAULT_COUNT;
  const toDelete = user ? await collectUserMessages(channel, user.id, targetCount) : [...(await channel.messages.fetch({ limit: targetCount })).values()];

  if (toDelete.length === 0) {
    await interaction.editReply({ content: 'Keine passenden Nachrichten gefunden.' });
    return;
  }

  // 2. Argument (true) filtert Nachrichten aelter als 14 Tage automatisch raus statt zu werfen -
  // Discord kann die per Bulk Delete grundsaetzlich nicht loeschen.
  const deleted = await channel.bulkDelete(toDelete, true).catch(() => null);
  if (!deleted) {
    await interaction.editReply({ content: '❌ Löschen fehlgeschlagen.' });
    return;
  }

  await interaction.editReply({
    content: `✅ ${deleted.size} Nachricht${deleted.size === 1 ? '' : 'en'} gelöscht${user ? ` von ${user}` : ''}.`,
  });

  await logClear(interaction, channel, user, deleted.size);
}

module.exports = { data, execute };
