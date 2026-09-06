const { OverwriteType } = require('discord.js');
const { getGuildBindings } = require('../../storage/teamRoles');
const { getMemberRoleId } = require('../../storage/roleSettings');

const LOCK_PREFIX = '🔒 ';

function getTeamRoleIds(guildId) {
  return Object.values(getGuildBindings(guildId));
}

// Ein privater Channel ist am Deny von ViewChannel auf @everyone erkennbar - das ist die
// einzige verlässliche Quelle, unabhängig davon, ob "remember" aktiv ist.
function isChannelPrivate(channel, guild) {
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
  return everyoneOverwrite?.deny?.has('ViewChannel') === true;
}

// Setzt bzw. entfernt die Sichtbarkeits-Overwrites für einen Custom-Voice-Channel.
// Privat = für @everyone unsichtbar, außer für Team-Rollen und bereits eingeladene Nutzer
// (erkennbar am bestehenden Connect-Allow-Overwrite). Nutzer, die bereits im Channel sind,
// werden dadurch nicht entfernt - Discord kickt niemanden über Permission-Änderungen.
async function applyPrivate(channel, guild, isPrivate) {
  const teamRoleIds = getTeamRoleIds(guild.id);

  // Die Member-Rolle hat oft ein eigenes ViewChannel-Allow (z.B. von der Kategorie geerbt), das
  // ein reines @everyone-Deny NICHT unterdrückt - ein Rollen-Overwrite schlägt in Discords
  // Berechtigungsauflösung immer das @everyone-Overwrite, egal in welche Richtung. Deshalb hier
  // ein EXPLIZITES Deny für die Member-Rolle selbst setzen, sonst bleibt der Kanal für sie trotz
  // "privat" sichtbar. Ist die Member-Rolle zugleich eine Team-Rolle, hat Team-Zugriff Vorrang.
  const memberRoleId = getMemberRoleId(guild.id);
  const memberRole = memberRoleId && !teamRoleIds.includes(memberRoleId) ? guild.roles.cache.get(memberRoleId) : null;
  const skipIds = new Set([guild.roles.everyone.id, ...teamRoleIds, ...(memberRoleId ? [memberRoleId] : [])]);

  if (isPrivate) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
    });

    if (memberRole) {
      await channel.permissionOverwrites.edit(memberRole, {
        ViewChannel: false,
      });
    }

    for (const roleId of teamRoleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) continue;

      await channel.permissionOverwrites.edit(role, {
        ViewChannel: true,
        Connect: true,
      });
    }

    // Bereits eingeladene Nutzer müssen den jetzt versteckten Channel weiterhin sehen können.
    const memberOverwrites = [...channel.permissionOverwrites.cache.values()].filter(
      (overwrite) => !skipIds.has(overwrite.id)
    );

    for (const overwrite of memberOverwrites) {
      if (overwrite.allow.has('Connect')) {
        // type: Member explizit angeben - ohne overwriteOptions.type versucht discord.js sonst,
        // anhand des Client-Caches zu erraten, ob die ID einen Nutzer oder eine Rolle meint, und
        // schlaegt fehl ("Supplied parameter is not a User nor a Role"), wenn der Nutzer dem Bot
        // gerade nicht bekannt/gecacht ist - obwohl die ID selbst gueltig ist.
        await channel.permissionOverwrites.edit(overwrite.id, { ViewChannel: true }, { type: OverwriteType.Member });
      }
    }
  } else {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: null,
    });

    for (const roleId of teamRoleIds) {
      await channel.permissionOverwrites.delete(roleId).catch(() => {});
    }

    if (memberRoleId) {
      await channel.permissionOverwrites.delete(memberRoleId).catch(() => {});
    }

    const memberOverwrites = [...channel.permissionOverwrites.cache.values()].filter(
      (overwrite) => !skipIds.has(overwrite.id)
    );

    for (const overwrite of memberOverwrites) {
      if (overwrite.allow.has('ViewChannel')) {
        await channel.permissionOverwrites.edit(overwrite.id, { ViewChannel: null }, { type: OverwriteType.Member });
      }
    }
  }

  // Schloss-Symbol im Namen als zusätzlicher visueller Hinweis, unabhängig von den (für normale
  // Mitglieder unsichtbaren) Berechtigungen - so ist auf einen Blick erkennbar, welche Tische
  // gerade privat sind, ohne die Overwrites nachschauen zu müssen.
  const hasLockPrefix = channel.name.startsWith(LOCK_PREFIX);
  if (isPrivate && !hasLockPrefix) {
    await channel.setName(`${LOCK_PREFIX}${channel.name}`);
  } else if (!isPrivate && hasLockPrefix) {
    await channel.setName(channel.name.slice(LOCK_PREFIX.length));
  }
}

module.exports = { applyPrivate, isChannelPrivate, getTeamRoleIds };
