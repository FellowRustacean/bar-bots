const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');

const { addFaq, getFaq, getAllFaqs, updateFaq, removeFaq } = require('../../storage/faq');

const PER_PAGE = 10;

const data = new SlashCommandBuilder()
  .setName('faq')
  .setDescription('Häufig gestellte Fragen')
  .addSubcommand((sub) =>
    sub
      .setName('frage')
      .setDescription('Zeigt die Antwort auf eine häufig gestellte Frage')
      .addIntegerOption((opt) =>
        opt.setName('frage').setDescription('Frage').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) => sub.setName('add').setDescription('Fügt einen neuen FAQ-Eintrag hinzu (nur Admins)'))
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Bearbeitet einen bestehenden FAQ-Eintrag (nur Admins)')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('FAQ-Eintrag').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Entfernt einen FAQ-Eintrag (nur Admins)')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('FAQ-Eintrag').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Listet alle FAQ-Einträge auf (nur Admins)')
      .addIntegerOption((opt) => opt.setName('page').setDescription('Seite').setRequired(true).setMinValue(1))
  );

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildFaqModal(customId, defaults = {}) {
  const questionInput = new TextInputBuilder()
    .setCustomId('faq_question')
    .setLabel('Frage')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(200)
    .setRequired(true);

  if (defaults.question) questionInput.setValue(defaults.question);

  const answerInput = new TextInputBuilder()
    .setCustomId('faq_answer')
    .setLabel('Antwort')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setRequired(true);

  if (defaults.answer) answerInput.setValue(defaults.answer);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('FAQ-Eintrag')
    .addComponents(
      new ActionRowBuilder().addComponents(questionInput),
      new ActionRowBuilder().addComponents(answerInput)
    );
}

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

async function autocomplete(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if ((subcommand === 'edit' || subcommand === 'remove') && !isAdmin(interaction)) {
    await interaction.respond([]);
    return;
  }

  const focused = String(interaction.options.getFocused()).toLowerCase();
  const matches = getAllFaqs(interaction.guildId)
    .filter((entry) => entry.question.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(
    matches.map((entry) => ({ name: truncate(entry.question, 100), value: entry.id }))
  );
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (subcommand === 'frage') {
    const id = interaction.options.getInteger('frage', true);
    const entry = getFaq(id, guildId);

    if (!entry) {
      await interaction.reply({
        content: 'Diese Frage wurde nicht gefunden. Bitte wähle einen Vorschlag aus der Liste.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `**${entry.question}**\n\n${entry.answer}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Du benötigst die Berechtigung **Administrator**.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'add') {
    await interaction.showModal(buildFaqModal('faq_add_modal'));
    return;
  }

  if (subcommand === 'edit') {
    const id = interaction.options.getInteger('id', true);
    const entry = getFaq(id, guildId);

    if (!entry) {
      await interaction.reply({ content: 'Dieser FAQ-Eintrag wurde nicht gefunden.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.showModal(buildFaqModal(`faq_edit_modal:${id}`, entry));
    return;
  }

  if (subcommand === 'remove') {
    const id = interaction.options.getInteger('id', true);
    const removed = removeFaq(id, guildId);

    await interaction.reply({
      content: removed ? '✅ Der FAQ-Eintrag wurde entfernt.' : 'Dieser FAQ-Eintrag wurde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'list') {
    const page = interaction.options.getInteger('page', true);
    const all = getAllFaqs(guildId);

    if (all.length === 0) {
      await interaction.reply({ content: 'Es gibt noch keine FAQ-Einträge.', flags: MessageFlags.Ephemeral });
      return;
    }

    const totalPages = Math.ceil(all.length / PER_PAGE);

    if (page > totalPages) {
      await interaction.reply({
        content: `Ungültige Seite. Es gibt aktuell ${totalPages} Seite(n).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const start = (page - 1) * PER_PAGE;
    const pageEntries = all.slice(start, start + PER_PAGE);
    const lines = pageEntries.map((entry) => `**#${entry.id} - ${entry.question}**\n${entry.answer}`);

    await interaction.reply({
      content: `📖 **FAQ** (Seite ${page}/${totalPages})\n\n${lines.join('\n\n')}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

async function handleModalSubmit(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Du benötigst die Team-Stufe **Administrator**.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const question = interaction.fields.getTextInputValue('faq_question').trim();
  const answer = interaction.fields.getTextInputValue('faq_answer').trim();

  if (interaction.customId === 'faq_add_modal') {
    const id = addFaq(interaction.guildId, question, answer);
    await interaction.reply({ content: `✅ FAQ-Eintrag **#${id}** wurde hinzugefügt.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId.startsWith('faq_edit_modal:')) {
    const id = Number(interaction.customId.split(':')[1]);
    const updated = updateFaq(id, interaction.guildId, question, answer);

    await interaction.reply({
      content: updated ? '✅ Der FAQ-Eintrag wurde aktualisiert.' : 'Dieser FAQ-Eintrag wurde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute, autocomplete, handleModalSubmit };
