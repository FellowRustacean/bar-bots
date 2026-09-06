const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getSnacks } = require('../../utils/snacks/snacks');
const { isTableChannel } = require('../../storage/voiceSettings');
const { createSnackOrder } = require('../../storage/snackOrders');
const { getBartresenChannelId } = require('../../storage/barSettings');
const { pickRandomLine } = require('../../../shared/lib/messageLines');

const MIN_DELAY_MS = 2 * 60 * 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;

// Kellner-Bot (Benedict) - liefert den Snack tatsächlich aus (siehe kellner bot/utils/snackDelivery),
// deshalb wird er hier schon in der Bestätigung erwähnt statt nur "ich" (Quinn nimmt nur auf).
const KELLNER_USER_ID = '1541047126652616774';

// "{kellner} bringt dir..." statt "{snack} kommt/kommen..." - so muss das Verb nie mit der
// (Einzahl- oder Mehrzahl-)Form des Snack-Namens übereinstimmen (siehe utils/drinks/serving.js
// für dasselbe Prinzip bei Artikeln). Textbausteine liegen in
// shared/data/messages/barkeeper.json (Key "snackOrderTaken") - wird bei jedem Aufruf frisch
// gelesen, eine Aenderung dort greift sofort ohne Neustart (siehe messageLines.js).

const data = new SlashCommandBuilder()
  .setName('snack')
  .setDescription('Bestellt einen Snack am Tresen (du musst an einem Tisch sitzen)')
  .addStringOption((opt) =>
    opt
      .setName('snack')
      .setDescription('Welcher Snack?')
      .setRequired(true)
      .setAutocomplete(true)
  );

async function autocomplete(interaction) {
  const bartresenChannelId = getBartresenChannelId(interaction.guildId);

  // Wie bei /getränk: außerhalb des Tresens gibt es nichts zu bestellen, statt der Snackliste nur
  // einen Hinweis als einzigen Vorschlag anzeigen. execute() prüft den Kanal ohnehin nochmal.
  if (interaction.channelId !== bartresenChannelId) {
    await interaction.respond([{ name: 'Gehe an den Bartresen', value: 'Gehe an den Bartresen' }]);
    return;
  }

  const snacks = getSnacks();
  const focused = interaction.options.getFocused().toLowerCase();

  const matches = snacks.filter((name) => name.toLowerCase().includes(focused)).slice(0, 25);

  await interaction.respond(matches.map((name) => ({ name, value: name })));
}

function randomOrderTakenLine(user, snackName, tableChannel) {
  const template = pickRandomLine('barkeeper', 'snackOrderTaken');
  return template
    .replace(/\{snack\}/g, snackName)
    .replace(/\{user\}/g, `${user}`)
    .replace(/\{kellner\}/g, `<@${KELLNER_USER_ID}>`)
    .replace(/\{table\}/g, `${tableChannel}`);
}

function randomDeliveryDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

async function execute(interaction) {
  const bartresenChannelId = getBartresenChannelId(interaction.guildId);
  if (!bartresenChannelId) {
    await interaction.reply({
      content: 'Es ist noch kein Tresen-Kanal konfiguriert. Ein Admin kann das über `/config setchannel bartresen <Kanal>` einrichten.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.channelId !== bartresenChannelId) {
    await interaction.reply({
      content: `Gehe an den Tresen: <#${bartresenChannelId}>`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel || !isTableChannel(voiceChannel, interaction.guildId)) {
    await interaction.reply({
      content: 'Dafür musst du an einem Tisch sitzen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const snackName = interaction.options.getString('snack', true);
  const snacks = getSnacks();

  if (!snacks.includes(snackName)) {
    await interaction.reply({
      content: 'Den Snack kenne ich nicht - nimm eine der vorgeschlagenen Optionen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  createSnackOrder({
    guildId: interaction.guildId,
    channelId: voiceChannel.id,
    userId: interaction.user.id,
    snackName,
    deliverAt: Date.now() + randomDeliveryDelay(),
  });

  await interaction.reply({ content: randomOrderTakenLine(interaction.user, snackName, voiceChannel) });
}

module.exports = { data, execute, autocomplete };
