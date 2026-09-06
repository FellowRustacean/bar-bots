const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { enqueueOutboxMessage } = require('../../storage/outbox');
const { BOT_PERSONAS, personaChoices } = require('../../utils/personas/botPersonas');
const { waitForOutboxJob } = require('../../utils/outbox/waitForOutboxJob');

// Nur ein "." als Start-Nachricht - der eigentliche Inhalt kommt danach per /message (im neu
// erstellten Post-Thread, der ab dann wie jeder andere Kanal als Ziel für /message send dient).
const PLACEHOLDER_CONTENT = '.';

const data = new SlashCommandBuilder()
  .setName('forum')
  .setDescription('Erstellt einen Forum-Post als einer der Bots')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('post')
      .setDescription('Erstellt einen neuen Forum-Post (danach per /message weiterschreiben)')
      .addStringOption((opt) =>
        opt
          .setName('character')
          .setDescription('Als welcher Bot soll der Post erstellt werden?')
          .setRequired(true)
          .addChoices(...personaChoices())
      )
      .addChannelOption((opt) =>
        opt
          .setName('forum')
          .setDescription('Forum-Kanal')
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(true)
      )
      .addStringOption((opt) => opt.setName('title').setDescription('Titel des Posts').setRequired(true))
  );

async function execute(interaction) {
  const character = interaction.options.getString('character', true);
  const forum = interaction.options.getChannel('forum', true);
  const title = interaction.options.getString('title', true);
  const persona = BOT_PERSONAS.find((p) => p.name === character);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const jobId = enqueueOutboxMessage({
    botName: character,
    action: 'forum_post',
    guildId: interaction.guildId,
    channelId: forum.id,
    title,
    content: PLACEHOLDER_CONTENT,
  });

  const job = await waitForOutboxJob(jobId);

  if (job?.status === 'done') {
    await interaction.editReply({
      content: `Forum-Post wurde als ${persona?.label ?? character} erstellt: <#${job.result_message_id}>`,
    });
    return;
  }

  await interaction.editReply({
    content: `Der Forum-Post konnte nicht erstellt werden${job?.error ? ` (${job.error})` : ''}.`,
  });
}

module.exports = { data, execute };
