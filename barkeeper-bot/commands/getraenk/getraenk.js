const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBartresenChannelId } = require('../../storage/barSettings');
const { getDrinks } = require('../../utils/drinks/drinks');
const { randomOrderComingLine, sendPreparationSteps } = require('../../utils/drinks/serving');
const { enqueueOrder, pendingCount } = require('../../utils/drinks/orderQueue');

const data = new SlashCommandBuilder()
  .setName('getränk')
  .setDescription('Bestellt ein Getränk am Tresen')
  .addStringOption((opt) =>
    opt
      .setName('getränk')
      .setDescription('Welches Getränk?')
      .setRequired(true)
      .setAutocomplete(true)
  );

async function autocomplete(interaction) {
  const bartresenChannelId = getBartresenChannelId(interaction.guildId);

  // Außerhalb des Tresens gibt es nichts zu bestellen - statt der Getränkeliste (die man von dort
  // aus eh nicht auslösen kann) nur einen Hinweis als einzigen Vorschlag anzeigen. execute() prüft
  // den Kanal ohnehin nochmal und reagiert unabhängig vom gewählten Wert mit der Tresen-Meldung.
  if (interaction.channelId !== bartresenChannelId) {
    await interaction.respond([{ name: 'Gehe an den Bartresen', value: 'Gehe an den Bartresen' }]);
    return;
  }

  const drinks = getDrinks();
  const focused = interaction.options.getFocused().toLowerCase();

  const matches = Object.keys(drinks)
    .filter((name) => name.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(matches.map((name) => ({ name, value: name })));
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

  const drinkName = interaction.options.getString('getränk', true);
  const drinks = getDrinks();
  const entry = drinks[drinkName];

  if (!entry) {
    await interaction.reply({
      content: 'Das Getränk kenne ich nicht - nimm eine der vorgeschlagenen Optionen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Anzeigename statt Mention - der Nutzer wird namentlich erwähnt, aber nicht angepingt.
  const displayName = interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

  // Warteschlange: es wird immer nur ein Getränk gleichzeitig am Tresen zubereitet. Die
  // Bestätigung kommt trotzdem sofort, bei Bedarf mit Hinweis auf die Warteposition.
  const position = pendingCount(interaction.channelId);
  const comingLine = randomOrderComingLine(displayName, drinkName, entry.artikel);

  await interaction.reply({
    content: position > 0 ? `${comingLine} (Du bist Nummer ${position + 1} in der Warteschlange.)` : comingLine,
  });

  enqueueOrder(interaction.channelId, () =>
    sendPreparationSteps(interaction.channel, displayName, drinkName, entry)
  );
}

module.exports = { data, execute, autocomplete };
