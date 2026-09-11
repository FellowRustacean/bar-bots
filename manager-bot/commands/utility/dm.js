const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');
const { createDmThread, getDmThreadByTarget } = require('../../storage/dmThreads');
const { BOT_PERSONAS, personaChoices } = require('../../utils/personas/botPersonas');

// Laengstmoegliche Discord-Option, analog zu den Voice-Channel-Log-Threads (siehe
// utils/logs/voiceChannelThreads.js) - Threads sollen nicht mitten in einer laufenden
// DM-Konversation von selbst archivieren.
const ARCHIVE_DURATION_MINUTES = 10080; // 7 Tage

const data = new SlashCommandBuilder()
  .setName('dm')
  .setDescription('Legt einen Thread fuer eine DM-Konversation als einer der Bots an')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((opt) =>
    opt
      .setName('character')
      .setDescription('Als welcher Bot soll geschrieben werden?')
      .setRequired(true)
      // Band hat keinen DM-Thread-Fluss (kein eigener Charaktername, kein sinnvoller DM-Absender) -
      // daher hier bewusst aus der Auswahl ausgeschlossen, obwohl personaChoices() ihn fuer
      // /message und /forum weiterhin liefert.
      .addChoices(...personaChoices().filter((choice) => choice.value !== 'band'))
  )
  .addUserOption((opt) => opt.setName('user').setDescription('Wem soll geschrieben werden?').setRequired(true));

async function execute(interaction) {
  const character = interaction.options.getString('character', true);
  const targetUser = interaction.options.getUser('user', true);
  const persona = BOT_PERSONAS.find((p) => p.name === character);

  const dmChannelId = getLogChannel(interaction.guildId, 'dm-channel');
  if (!dmChannelId) {
    await interaction.reply({
      content: 'Für diesen Server ist noch kein DM-Kanal konfiguriert (`/config setchannel selection:dm-channel`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dmChannel = await interaction.guild.channels.fetch(dmChannelId).catch(() => null);
  if (!dmChannel || dmChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Der konfigurierte DM-Kanal existiert nicht mehr oder ist kein Text-Kanal.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Nie mehr als EINEN Thread pro Charakter+User anlegen - existiert schon einer (auch von einer
  // eingehenden DM, die der User zuerst geschickt hat), dorthin verlinken statt einen zweiten,
  // parallelen Thread zu erzeugen. Fetch statt blindem Vertrauen auf die DB-Zeile, falls der Thread
  // zwischenzeitlich manuell geloescht wurde - dann ganz normal neu anlegen.
  const existing = getDmThreadByTarget(character, targetUser.id);
  if (existing) {
    const existingThread = await interaction.guild.channels.fetch(existing.threadId).catch(() => null);
    if (existingThread) {
      await interaction.editReply({
        content: `Für **${persona?.label ?? character}** ↔ ${targetUser} gibt es bereits einen Thread: ${existingThread}`,
      });
      return;
    }
  }

  // Ohne "message"-Option angelegt - erzeugt einen leeren Thread ohne Start-Nachricht, genau wie
  // gewuenscht ("nur ein Thread erstellt, ohne eine Nachricht zu senden").
  const thread = await dmChannel.threads.create({
    name: `${persona?.label ?? character} ↔ ${targetUser.username}`.slice(0, 100),
    autoArchiveDuration: ARCHIVE_DURATION_MINUTES,
    reason: `DM-Thread angelegt von ${interaction.user.tag}`,
  });

  createDmThread(thread.id, interaction.guildId, character, targetUser.id);

  await interaction.editReply({
    content: `Thread ${thread} angelegt - Nachrichten dort werden nach Bestätigung als **${persona?.label ?? character}** per DM an ${targetUser} gesendet.`,
  });
}

module.exports = { data, execute };
