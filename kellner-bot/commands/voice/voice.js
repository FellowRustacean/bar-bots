const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');

const { executeVoiceCommand } = require('../../utils/customVoice/voiceCommands');
const { logError } = require('../../utils/logs/errorLog');

const data = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Verwaltet deinen persönlichen Voice-Channel')
  .addSubcommand((sub) =>
    sub
      .setName('ban')
      .setDescription('Verbietet einem Nutzer deinen Voice-Channel')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, der gebannt werden soll')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('unban')
      .setDescription('Entfernt einen Voice-Ban')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, der entbannt werden soll')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('limit')
      .setDescription('Setzt das Nutzerlimit deines Voice-Channels')
      .addIntegerOption((opt) =>
        opt
          .setName('limit')
          .setDescription('0 = unbegrenzt, 1-99 = Nutzerlimit')
          .setMinValue(0)
          .setMaxValue(99)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('lock')
      .setDescription('Sperrt oder entsperrt deinen Voice-Channel')
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('Sperren oder entsperren')
          .setRequired(true)
          .addChoices(
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('private')
      .setDescription('Versteckt deinen Voice-Channel vor allen außer Team und Eingeladenen')
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('Privat an oder aus')
          .setRequired(true)
          .addChoices(
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('invite')
      .setDescription('Erlaubt einem Nutzer trotz Lock den Beitritt')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, der eingeladen werden soll')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('uninvite')
      .setDescription('Entfernt eine Voice-Einladung')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, dessen Einladung entfernt wird')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('claim')
      .setDescription('Übernimmst den Besitz eines Voice-Channels, dessen Besitzer nicht mehr da ist')
  )
  .addSubcommand((sub) =>
    sub
      .setName('transfer')
      .setDescription('Überträgt den Besitz deines Voice-Channels an einen anderen Nutzer')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Neuer Besitzer')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('moderator')
      .setDescription('Macht einen Nutzer zum Moderator deines Voice-Channels (oder entfernt ihn)')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, der Moderator werden/nicht mehr sein soll')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('action')
          .setDescription('Hinzufügen oder entfernen')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remember')
      .setDescription('Aktiviert oder deaktiviert das dauerhafte Speichern')
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('Speichern an oder aus')
          .setRequired(true)
          .addChoices(
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' }
          )
      )
  );

async function execute(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await executeVoiceCommand(interaction);
  } catch (err) {
    await logError(err, { context: 'Voice-Befehl', guildId: interaction.guildId });

    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content: 'Bei der Ausführung des Voice-Befehls ist ein Fehler aufgetreten.',
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: 'Bei der Ausführung des Voice-Befehls ist ein Fehler aufgetreten.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyErr) {
      await logError(replyErr, { context: 'Voice-Befehl: Fehlermeldung senden', guildId: interaction.guildId });
    }
  }
}

module.exports = { data, execute };