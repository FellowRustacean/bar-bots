const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { enqueueOutboxMessage } = require('../../storage/outbox');
const { BOT_PERSONAS, findPersonaByAuthorId, personaChoices } = require('../../utils/personas/botPersonas');
const { waitForOutboxJob } = require('../../utils/outbox/waitForOutboxJob');

const data = new SlashCommandBuilder()
  .setName('message')
  .setDescription('Sendet, bearbeitet oder löscht eine Nachricht als einer der Bots')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('send')
      .setDescription('Sendet eine neue Nachricht in diesen Kanal')
      .addStringOption((opt) =>
        opt
          .setName('character')
          .setDescription('Als welcher Bot soll die Nachricht gesendet werden?')
          .setRequired(true)
          .addChoices(...personaChoices())
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Bearbeitet eine Nachricht eines der Bots')
      .addStringOption((opt) =>
        opt.setName('message_id').setDescription('ID der zu bearbeitenden Nachricht').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Löscht eine Nachricht eines der Bots')
      .addStringOption((opt) =>
        opt.setName('message_id').setDescription('ID der zu löschenden Nachricht').setRequired(true)
      )
  );

// Holt frische Nachrichteninhalte (umgeht den discord.js-Cache, der nach edit() veraltet bleibt),
// fällt aber auf den Cache-Stand zurück, falls das zu lange dauert - showModal() muss innerhalb
// des 3-Sekunden-Interaktionsfensters aufgerufen werden.
async function fetchFreshMessage(channel, messageId) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), 1500));
  const fresh = await Promise.race([
    channel.messages.fetch({ message: messageId, force: true }).catch(() => null),
    timeout,
  ]);
  if (fresh) return fresh;
  return channel.messages.fetch(messageId).catch(() => null);
}

function buildTextModal(customId, defaultValue) {
  const input = new TextInputBuilder()
    .setCustomId('message_content')
    .setLabel('Nachricht (Markdown)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(2000)
    .setRequired(true);

  if (defaultValue) input.setValue(defaultValue);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Nachricht')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'send') {
    const character = interaction.options.getString('character', true);
    await interaction.showModal(buildTextModal(`message_send_modal:${character}`));
    return;
  }

  if (subcommand === 'edit') {
    const messageId = interaction.options.getString('message_id', true);
    const message = await fetchFreshMessage(interaction.channel, messageId);

    if (!message) {
      await interaction.reply({ content: 'Nachricht wurde nicht gefunden.', flags: MessageFlags.Ephemeral });
      return;
    }

    const persona = findPersonaByAuthorId(message.author.id);
    if (!persona) {
      await interaction.reply({
        content: 'Ich kann nur Nachrichten eines unserer Bots bearbeiten.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(
      buildTextModal(`message_edit_modal:${persona.name}:${messageId}`, message.content)
    );
    return;
  }

  if (subcommand === 'delete') {
    const messageId = interaction.options.getString('message_id', true);
    const message = await interaction.channel.messages.fetch(messageId).catch(() => null);

    if (!message) {
      await interaction.reply({ content: 'Nachricht wurde nicht gefunden.', flags: MessageFlags.Ephemeral });
      return;
    }

    const persona = findPersonaByAuthorId(message.author.id);
    if (!persona) {
      await interaction.reply({
        content: 'Ich kann nur Nachrichten eines unserer Bots löschen.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const jobId = enqueueOutboxMessage({
      botName: persona.name,
      action: 'delete',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId,
    });

    const job = await waitForOutboxJob(jobId);

    if (job?.status === 'done') {
      await interaction.editReply({ content: `Nachricht wurde als ${persona.label} gelöscht.` });
    } else {
      await interaction.editReply({
        content: `Die Nachricht konnte nicht gelöscht werden${job?.error ? ` (${job.error})` : ''}.`,
      });
    }
  }
}

async function handleModalSubmit(interaction) {
  const content = interaction.fields.getTextInputValue('message_content');

  if (interaction.customId.startsWith('message_send_modal:')) {
    const character = interaction.customId.split(':')[1];
    const persona = BOT_PERSONAS.find((p) => p.name === character);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const jobId = enqueueOutboxMessage({
      botName: character,
      action: 'send',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      content,
    });

    const job = await waitForOutboxJob(jobId);

    if (job?.status === 'done') {
      await interaction.editReply({ content: `Nachricht wurde als ${persona?.label ?? character} gesendet.` });
    } else {
      await interaction.editReply({
        content: `Die Nachricht konnte nicht gesendet werden${job?.error ? ` (${job.error})` : ''}.`,
      });
    }
    return;
  }

  if (interaction.customId.startsWith('message_edit_modal:')) {
    const [, character, messageId] = interaction.customId.split(':');
    const persona = BOT_PERSONAS.find((p) => p.name === character);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const jobId = enqueueOutboxMessage({
      botName: character,
      action: 'edit',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId,
      content,
    });

    const job = await waitForOutboxJob(jobId);

    if (job?.status === 'done') {
      await interaction.editReply({ content: `Nachricht wurde als ${persona?.label ?? character} bearbeitet.` });
    } else {
      await interaction.editReply({
        content: `Die Nachricht konnte nicht bearbeitet werden${job?.error ? ` (${job.error})` : ''}.`,
      });
    }
  }
}

module.exports = { data, execute, handleModalSubmit };
