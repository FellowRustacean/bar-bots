const {
  getVoiceChannel,
  updateVoiceChannelOwner,
} = require('../../storage/voiceChannels');

const {
  getPreferences,
  setRemembered,
  setUserLimit,
  setLocked,
  setPrivate,
  addBan,
  removeBan,
  getBans,
  addInvite,
  removeInvite,
  getInvites,
} = require('../../storage/voicePreferences');

const {
  isModerator,
  addModerator,
  removeModerator,
} = require('../../storage/voiceModerators');

const { applyPrivate, isChannelPrivate, getTeamRoleIds } = require('./voicePrivacy');

// Besitzer UND hinzugefügte Moderatoren dürfen alle Subcommands außer "moderator" selbst nutzen
// (siehe executeVoiceCommand) - isOwner wird trotzdem mitgeliefert, weil einzelne Aktionen
// (Moderator-Verwaltung, den Besitzer bannen) exklusiv dem Besitzer vorbehalten bleiben.
function getOwnedVoiceChannel(interaction) {
  const channel = interaction.member.voice.channel;

  if (!channel) {
    return {
      error: 'Du musst dich in deinem Voice-Channel befinden.',
    };
  }

  const voiceChannel = getVoiceChannel(channel.id);

  if (!voiceChannel) {
    return {
      error: 'Dieser Voice-Channel wird nicht vom Custom-Voice-System verwaltet.',
    };
  }

  const isOwner = voiceChannel.ownerId === interaction.user.id;
  const isMod = !isOwner && isModerator(interaction.guildId, voiceChannel.ownerId, interaction.user.id);

  if (!isOwner && !isMod) {
    return {
      error: 'Du bist weder Besitzer noch Moderator dieses Voice-Channels.',
    };
  }

  return {
    channel,
    voiceChannel,
    isOwner,
  };
}

// Wie getOwnedVoiceChannel, aber ohne die Besitzer-Prüfung - für /voice claim, das
// ausdrücklich von einem Nicht-Besitzer aufgerufen wird.
function getManagedVoiceChannel(interaction) {
  const channel = interaction.member.voice.channel;

  if (!channel) {
    return {
      error: 'Du musst dich in deinem Voice-Channel befinden.',
    };
  }

  const voiceChannel = getVoiceChannel(channel.id);

  if (!voiceChannel) {
    return {
      error: 'Dieser Voice-Channel wird nicht vom Custom-Voice-System verwaltet.',
    };
  }

  return {
    channel,
    voiceChannel,
  };
}

async function handleClaim(interaction) {
  const result = getManagedVoiceChannel(interaction);

  if (result.error) {
    await interaction.editReply({ content: result.error });
    return;
  }

  const { channel, voiceChannel } = result;

  if (voiceChannel.ownerId === interaction.user.id) {
    await interaction.editReply({ content: 'Du bist bereits der Besitzer dieses Voice-Channels.' });
    return;
  }

  if (channel.members.has(voiceChannel.ownerId)) {
    await interaction.editReply({
      content: 'Der aktuelle Besitzer ist noch im Channel - du kannst ihn nicht übernehmen.',
    });
    return;
  }

  updateVoiceChannelOwner(channel.id, interaction.user.id);

  await interaction.editReply({
    content: `Du bist jetzt der Besitzer von **${channel.name}**.`,
  });
}

async function executeVoiceCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'claim') {
    await handleClaim(interaction);
    return;
  }

  const result = getOwnedVoiceChannel(interaction);

  if (result.error) {
    await interaction.editReply({
      content: result.error,
    });
    return;
  }

  const { channel, isOwner } = result;
  const guildId = interaction.guildId;
  // Immer der TATSÄCHLICHE Besitzer des Channels (nicht der aufrufende Nutzer!) - alle
  // gespeicherten Einstellungen (Bans, Invites, Moderatoren, ...) gehören dem Besitzer, egal ob
  // gerade er selbst oder ein Moderator den Befehl ausführt.
  const ownerId = result.voiceChannel.ownerId;
  const callerId = interaction.user.id;

  const preferences = getPreferences(guildId, ownerId);
  const remembered = preferences?.remembered === 1;

  switch (subcommand) {
    case 'moderator': {
      // Bewusst NICHT für Moderatoren selbst freigegeben - sonst könnte sich ein Moderator
      // beliebig weitere Moderatoren dazuholen oder unliebsame entfernen, ohne dass der Besitzer
      // das kontrollieren kann.
      if (!isOwner) {
        await interaction.editReply({
          content: 'Nur der Besitzer kann Moderatoren verwalten.',
        });
        return;
      }

      const user = interaction.options.getUser('user', true);
      const action = interaction.options.getString('action', true);

      if (user.id === ownerId) {
        await interaction.editReply({ content: 'Du bist bereits der Besitzer.' });
        return;
      }

      if (user.bot) {
        await interaction.editReply({ content: 'Ein Bot kann nicht Moderator werden.' });
        return;
      }

      if (action === 'add') {
        addModerator(guildId, ownerId, user.id);
        await interaction.editReply({ content: `${user.displayName} ist jetzt Moderator deines Voice-Channels.` });
      } else {
        removeModerator(guildId, ownerId, user.id);
        await interaction.editReply({ content: `${user.displayName} ist kein Moderator mehr.` });
      }

      break;
    }

    case 'ban': {
      const user = interaction.options.getUser('user', true);

      if (user.id === ownerId) {
        await interaction.editReply({
          content: 'Der Besitzer kann nicht gebannt werden.',
        });
        return;
      }

      if (user.id === callerId) {
        await interaction.editReply({
          content: 'Du kannst dich nicht selbst bannen.',
        });
        return;
      }

      await channel.permissionOverwrites.edit(user.id, {
        Connect: false,
        ...(isChannelPrivate(channel, interaction.guild) ? { ViewChannel: false } : {}),
      });

      if (remembered) {
        addBan(guildId, ownerId, user.id);
      }

      if (channel.members.has(user.id)) {
        await channel.members
          .get(user.id)
          .voice.disconnect('Vom Channel-Owner gebannt');
      }

      await interaction.editReply({
        content: `${user.displayName} wurde aus deinem Voice-Channel gebannt.`,
      });

      break;
    }

    case 'unban': {
      const user = interaction.options.getUser('user', true);

      if (remembered) {
        removeBan(guildId, ownerId, user.id);
      }

      const isInvited = getInvites(guildId, ownerId)
        .some((entry) => entry.userId === user.id);

      if (isInvited) {
        await channel.permissionOverwrites.edit(user.id, {
          Connect: true,
          ...(isChannelPrivate(channel, interaction.guild) ? { ViewChannel: true } : {}),
        });
      } else {
        await channel.permissionOverwrites.delete(user.id);
      }

      await interaction.editReply({
        content: `${user.displayName} wurde von deinem Voice-Channel entbannt.`,
      });

      break;
    }

    case 'limit': {
      const limit = interaction.options.getInteger('limit', true);

      await channel.setUserLimit(limit);

      if (remembered) {
        setUserLimit(guildId, ownerId, limit);
      }

      await interaction.editReply({
        content:
          limit === 0
            ? 'Das Nutzerlimit wurde aufgehoben.'
            : `Das Nutzerlimit wurde auf **${limit}** gesetzt.`,
      });

      break;
    }

    case 'lock': {
      const status = interaction.options.getString('status', true);
      const locked = status === 'on';

      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        {
          Connect: !locked,
        }
      );

      if (remembered) {
        setLocked(guildId, ownerId, locked);
      }

      await interaction.editReply({
        content: `Der Voice-Channel ist jetzt **${
          locked ? 'gesperrt' : 'entsperrt'
        }**.`,
      });

      break;
    }

    case 'invite': {
      const user = interaction.options.getUser('user', true);

      if (user.id === ownerId) {
        await interaction.editReply({
          content: 'Du bist bereits der Besitzer dieses Channels.',
        });
        return;
      }

      await channel.permissionOverwrites.edit(user.id, {
        Connect: true,
        ViewChannel: true,
      });

      if (remembered) {
        addInvite(guildId, ownerId, user.id);
      }

      await interaction.editReply({
        content: `${user.displayName} darf deinen Voice-Channel jetzt auch bei aktivem Lock oder Privat-Modus betreten.`,
      });

      break;
    }

    case 'uninvite': {
      const user = interaction.options.getUser('user', true);

      if (remembered) {
        removeInvite(guildId, ownerId, user.id);
      }

      const isBanned = getBans(guildId, ownerId)
        .some((entry) => entry.userId === user.id);

      if (isBanned) {
        await channel.permissionOverwrites.edit(user.id, {
          Connect: false,
          ...(isChannelPrivate(channel, interaction.guild) ? { ViewChannel: false } : {}),
        });
      } else {
        await channel.permissionOverwrites.delete(user.id);
      }

      await interaction.editReply({
        content: `${user.displayName} darf deinen Voice-Channel nicht mehr über eine Einladung betreten.`,
      });

      break;
    }

    case 'private': {
      const status = interaction.options.getString('status', true);
      const isPrivate = status === 'on';

      await applyPrivate(channel, interaction.guild, isPrivate);

      if (remembered) {
        setPrivate(guildId, ownerId, isPrivate);
      }

      await interaction.editReply({
        content: isPrivate
          ? 'Der Voice-Channel ist jetzt **privat** - nur Team-Mitglieder und eingeladene Nutzer können ihn sehen und betreten. Nutzer, die bereits drin sind, bleiben drin.'
          : 'Der Voice-Channel ist jetzt wieder **öffentlich sichtbar**.',
      });

      break;
    }

    case 'transfer': {
      const user = interaction.options.getUser('user', true);

      if (user.bot) {
        await interaction.editReply({ content: 'Du kannst die Besitzrechte nicht an einen Bot übertragen.' });
        return;
      }

      if (user.id === ownerId) {
        await interaction.editReply({ content: 'Du bist bereits der Besitzer dieses Channels.' });
        return;
      }

      if (!channel.members.has(user.id)) {
        await interaction.editReply({ content: `${user.displayName} muss sich in deinem Voice-Channel befinden.` });
        return;
      }

      updateVoiceChannelOwner(channel.id, user.id);

      await interaction.editReply({
        content: `${user.displayName} ist jetzt der Besitzer von **${channel.name}**.`,
      });

      break;
    }

  case 'remember': {
    const status = interaction.options.getString('status', true);
    const enabled = status === 'on';

    setRemembered(guildId, ownerId, enabled);

    if (enabled) {
      // Aktuelles Nutzerlimit speichern
      setUserLimit(
        guildId,
        ownerId,
        channel.userLimit || 0
      );

      // Aktuellen Lock-Status speichern
      const everyoneOverwrite =
        channel.permissionOverwrites.cache.get(
          interaction.guild.roles.everyone.id
        );

      const locked =
        everyoneOverwrite?.deny?.has('Connect') === true &&
        everyoneOverwrite?.allow?.has('Connect') !== true;

      setLocked(guildId, ownerId, locked);

      // Aktuellen Privat-Status speichern
      const isPrivate = isChannelPrivate(channel, interaction.guild);
      setPrivate(guildId, ownerId, isPrivate);

      // Aktuelle Bans und Invites übernehmen (Team-Rollen-Overwrites ausgenommen -
      // die werden beim Anwenden des Privat-Status automatisch neu gesetzt)
      const teamRoleIds = new Set(getTeamRoleIds(guildId));

      for (const [userId, overwrite] of channel.permissionOverwrites.cache) {
        if (userId === interaction.guild.roles.everyone.id || teamRoleIds.has(userId)) {
          continue;
        }

        if (overwrite.deny.has('Connect')) {
          addBan(guildId, ownerId, userId);
        }

        if (overwrite.allow.has('Connect')) {
          addInvite(guildId, ownerId, userId);
        }
      }

      await interaction.editReply({
        content:
          'Das dauerhafte Speichern wurde **aktiviert**. Die aktuelle Konfiguration wurde übernommen.',
      });
    } else {
      await interaction.editReply({
        content:
          'Das dauerhafte Speichern wurde **deaktiviert**. Zukünftige Änderungen werden nicht mehr für neue Tables übernommen.',
      });
    }

    break;
  }

    default:
      throw new Error(`Unbekannter Voice-Subcommand: ${subcommand}`);
  }
}

module.exports = {
  executeVoiceCommand,
};