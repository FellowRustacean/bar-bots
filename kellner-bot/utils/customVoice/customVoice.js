const { ChannelType, OverwriteType } = require('discord.js');

const { getVoiceSettings } = require('../../storage/voiceSettings');

const {
  createVoiceChannel,
  deleteVoiceChannel,
  getGuildVoiceChannels,
  getVoiceChannel,
} = require('../../storage/voiceChannels');

const {
  getPreferences,
  getBans,
  getInvites,
} = require('../../storage/voicePreferences');

const { applyPrivate } = require('./voicePrivacy');

async function applyVoiceConfiguration(channel, guild, ownerId) {
  const preferences = getPreferences(guild.id, ownerId);

  if (!preferences?.remembered) return;

  if (preferences.userLimit > 0) {
    await channel.setUserLimit(preferences.userLimit);
  }

  if (preferences.locked) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      Connect: false,
    });
  }

  for (const ban of getBans(guild.id, ownerId)) {
    // type: Member muss explizit angegeben werden - ohne overwriteOptions.type versucht
    // discord.js sonst, anhand des CLIENT-CACHES zu erraten, ob die ID einen Nutzer oder eine
    // Rolle meint (siehe PermissionOverwriteManager#upsert). Ist der Nutzer dem Bot noch nicht
    // bekannt (nicht im Cache), schlägt das mit "Supplied parameter is not a User nor a Role"
    // fehl, obwohl die ID an sich gültig ist - eine reine ID-Zeichenkette reicht dafür nicht.
    await channel.permissionOverwrites.edit(
      ban.userId,
      { Connect: false },
      { type: OverwriteType.Member }
    );
  }

  for (const invite of getInvites(guild.id, ownerId)) {
    await channel.permissionOverwrites.edit(
      invite.userId,
      { Connect: true, ViewChannel: true },
      { type: OverwriteType.Member }
    );
  }

  if (preferences.isPrivate) {
    await applyPrivate(channel, guild, true);
  }
}

async function handleVoiceStateUpdate(oldState, newState) {
  /*
   * CHANNEL VERLASSEN
   */
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const settings = getVoiceSettings(oldState.guild.id);
    const leftChannel = oldState.channel;

    if (
      leftChannel &&
      settings?.voiceCategoryId &&
      leftChannel.parentId === settings.voiceCategoryId &&
      leftChannel.id !== settings.voiceChannelId
    ) {
      const voiceChannel = getVoiceChannel(leftChannel.id);

      if (voiceChannel) {
        /*
         * Channel ist leer -> löschen
         */
        if (leftChannel.members.size === 0) {
          await leftChannel.delete('Custom-Voice-Kanal ist leer');
          deleteVoiceChannel(leftChannel.id);
          return;
        }
      }
    }
  }

  /*
   * CHANNEL BETRETEN
   */
  if (oldState.channelId === newState.channelId) return;
  if (!newState.channelId) return;

  const settings = getVoiceSettings(newState.guild.id);

  if (!settings?.voiceChannelId || !settings?.voiceCategoryId) {
    return;
  }

  /*
   * Nur der konfigurierte Creation-Channel erzeugt einen Table.
   */
  if (newState.channelId !== settings.voiceChannelId) {
    return;
  }

  const category = newState.guild.channels.cache.get(
    settings.voiceCategoryId
  );

  if (!category) return;

  /*
   * Kleinste freie Table-Nummer finden.
   */
  const existingTables = getGuildVoiceChannels(
    newState.guild.id
  );

  const usedNumbers = new Set(
    existingTables.map((table) => table.tableNumber)
  );

  let tableNumber = 1;

  while (usedNumbers.has(tableNumber)) {
    tableNumber++;
  }

  /*
   * Table erstellen.
   */
  const channel = await newState.guild.channels.create({
    name: `Tisch ${tableNumber}`,
    type: ChannelType.GuildVoice,
    parent: category.id,
  });

  createVoiceChannel(
    channel.id,
    newState.guild.id,
    newState.member.id,
    tableNumber
  );

  /*
   * Der Ersteller muss seinen eigenen Tisch IMMER sehen/betreten können - unabhängig davon,
   * ob gleich per gespeicherter Konfiguration "locked"/"privat" angewendet wird. Ohne dieses
   * explizite Allow-Overwrite würde ein Ersteller mit gespeicherten locked/private-Einstellungen
   * sich selbst aus seinem frisch erstellten Tisch aussperren (Discord-Berechtigungen werten ein
   * konkretes Nutzer-Overwrite immer stärker als das @everyone-Deny) - genau das hat vorher dazu
   * geführt, dass das anschließende Verschieben mit einem Fehler fehlschlug.
   */
  await channel.permissionOverwrites.edit(
    newState.member.id,
    { ViewChannel: true, Connect: true },
    { type: OverwriteType.Member }
  );

  /*
   * Gespeicherte Konfiguration anwenden.
   */
  await applyVoiceConfiguration(
    channel,
    newState.guild,
    newState.member.id
  );

  /*
   * User verschieben.
   */
  await newState.setChannel(channel);

  /*
   * Begrüßungsnachricht - Anzeigename statt Mention, damit niemand angepingt wird.
   */
  await channel.send(
    `${newState.member.displayName}, das ist jetzt dein **Tisch ${tableNumber}**.`
  );
}

module.exports = {
  handleVoiceStateUpdate,
};