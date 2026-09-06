const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const {
  createPoll,
  setPollMessageId,
  getPoll,
  getPollOptions,
  getVoteCounts,
  castVote,
  closePoll,
  getExpiredPollIds,
} = require('../../storage/polls');

const POLL_DURATION_MS = 48 * 60 * 60 * 1000;
const MAX_OPTIONS = 10;

function buildPollModal() {
  const question = new TextInputBuilder()
    .setCustomId('poll_question')
    .setLabel('Frage')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(200)
    .setRequired(true);

  const options = new TextInputBuilder()
    .setCustomId('poll_options')
    .setLabel(`Optionen (eine pro Zeile, max. ${MAX_OPTIONS})`)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('poll_create_modal')
    .setTitle('Neue Umfrage')
    .addComponents(
      new ActionRowBuilder().addComponents(question),
      new ActionRowBuilder().addComponents(options)
    );
}

async function startPoll(interaction) {
  await interaction.showModal(buildPollModal());
}

function truncateLabel(label) {
  return label.length > 72 ? `${label.slice(0, 69)}...` : label;
}

// Stimm-Buttons zu je 5 pro Reihe, der Schließen-Button bekommt eine eigene letzte Reihe -
// bei maximal 10 Optionen (2 Reihen) bleibt so immer Platz, ohne Discords Limit von 5 Reihen/
// 25 Komponenten pro Nachricht zu sprengen.
function buildPollComponents(pollId, options, closed) {
  const rows = [];

  for (let i = 0; i < options.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const option of options.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_vote:${pollId}:${option.id}`)
          .setLabel(`${option.position + 1}. ${truncateLabel(option.label)}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(closed)
      );
    }
    rows.push(row);
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll_close:${pollId}`)
        .setLabel(closed ? 'Geschlossen' : 'Umfrage schließen')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(closed)
    )
  );

  return rows;
}

function buildPollEmbed(poll, options, counts, closed) {
  const totalVotes = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const barLength = 12;

  const lines = options.map((option) => {
    const count = counts[option.id] ?? 0;
    const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const filled = totalVotes > 0 ? Math.round((count / totalVotes) * barLength) : 0;
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    return `**${option.position + 1}. ${option.label}** — ${bar} ${count} (${percent}%)`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `${totalVotes} Stimme(n) insgesamt` })
    .setTimestamp();

  if (closed) {
    embed.setColor(0x999999).setAuthor({ name: '🔒 Umfrage geschlossen' });
  } else {
    embed.setColor(0x5865f2).addFields({ name: 'Schließt automatisch', value: `<t:${Math.floor(poll.closesAt / 1000)}:R>` });
  }

  return embed;
}

async function handlePollModalSubmit(interaction) {
  const question = interaction.fields.getTextInputValue('poll_question').trim();
  const rawOptions = interaction.fields.getTextInputValue('poll_options');

  const options = [
    ...new Set(
      rawOptions
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    ),
  ].slice(0, MAX_OPTIONS);

  if (options.length < 2) {
    await interaction.reply({
      content: 'Ich brauche mindestens 2 unterschiedliche Optionen (eine pro Zeile).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const closesAt = Date.now() + POLL_DURATION_MS;

  const pollId = createPoll({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    creatorId: interaction.user.id,
    question,
    options,
    closesAt,
  });

  const poll = getPoll(pollId);
  const pollOptions = getPollOptions(pollId);
  const counts = getVoteCounts(pollId);

  await interaction.reply({
    embeds: [buildPollEmbed(poll, pollOptions, counts, false)],
    components: buildPollComponents(pollId, pollOptions, false),
  });

  const message = await interaction.fetchReply();
  setPollMessageId(pollId, message.id);
}

async function handlePollVote(interaction, pollId, optionId) {
  const poll = getPoll(pollId);
  if (!poll || poll.closed) {
    await interaction.reply({ content: 'Diese Umfrage ist bereits geschlossen.', flags: MessageFlags.Ephemeral });
    return;
  }

  castVote(pollId, interaction.user.id, optionId);

  const pollOptions = getPollOptions(pollId);
  const counts = getVoteCounts(pollId);

  await interaction.update({
    embeds: [buildPollEmbed(poll, pollOptions, counts, false)],
    components: buildPollComponents(pollId, pollOptions, false),
  });
}

async function handlePollClose(interaction, pollId) {
  const poll = getPoll(pollId);
  if (!poll) {
    await interaction.reply({ content: 'Diese Umfrage gibt es nicht mehr.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (poll.closed) {
    await interaction.reply({ content: 'Die Umfrage ist bereits geschlossen.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.user.id !== poll.creatorId) {
    await interaction.reply({
      content: 'Nur der Ersteller der Umfrage kann sie schließen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  closePoll(pollId);

  const pollOptions = getPollOptions(pollId);
  const counts = getVoteCounts(pollId);

  await interaction.update({
    embeds: [buildPollEmbed(poll, pollOptions, counts, true)],
    components: buildPollComponents(pollId, pollOptions, true),
  });
}

// Läuft periodisch (siehe index.js) und schließt Umfragen, deren 48h-Frist abgelaufen ist -
// unabhängig davon, ob gerade jemand aktiv mit ihnen interagiert.
async function checkExpiredPolls(client) {
  for (const pollId of getExpiredPollIds()) {
    const poll = getPoll(pollId);
    if (!poll || poll.closed) continue;

    closePoll(pollId);

    if (!poll.messageId) continue;

    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel) continue;

    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (!message) continue;

    const pollOptions = getPollOptions(pollId);
    const counts = getVoteCounts(pollId);

    await message
      .edit({
        embeds: [buildPollEmbed(poll, pollOptions, counts, true)],
        components: buildPollComponents(pollId, pollOptions, true),
      })
      .catch(() => {});
  }
}

module.exports = {
  startPoll,
  handlePollModalSubmit,
  handlePollVote,
  handlePollClose,
  checkExpiredPolls,
};
