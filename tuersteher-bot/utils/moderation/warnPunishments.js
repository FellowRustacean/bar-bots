const { addTempban } = require('../../storage/tempbans');

const punishments = require('../../punishments.json');

function getPunishment(points) {
  const thresholds = Object.keys(punishments)
    .map(Number)
    .filter((threshold) => threshold <= points)
    .sort((a, b) => b - a);

  if (thresholds.length === 0) return null;

  return {
    threshold: thresholds[0],
    punishment: punishments[thresholds[0]],
  };
}

function parseDuration(duration) {
  const match = duration.match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

async function removePreviousMute(member) {
  if (member.communicationDisabledUntilTimestamp) {
    await member.timeout(
      null,
      'Vorherige automatische Warn-Strafe ersetzt'
    );
  }
}

// Best-effort DM vor der eigentlichen Strafe - dieselbe Reihenfolge wie bei /ban, /tempban, /kick,
// /mute: nach einem Bann/Kick teilt der Bot sich keinen Server mehr mit dem Nutzer, die DM muss
// also vorher raus. Scheitert die DM (deaktiviert, kein gemeinsamer Server mehr), wird die Strafe
// trotzdem angewendet.
async function notifyUser(user, message) {
  try {
    await user.send(message);
  } catch (err) {
    // Nutzer hat DMs deaktiviert oder keinen gemeinsamen Server (mehr)
  }
}

async function applyPunishment(guild, userId, points) {
  const result = getPunishment(points);

  if (!result) return null;

  const [type, duration] = result.punishment.split(':');
  const user = await guild.client.users.fetch(userId).catch(() => null);

  if (type === 'mute') {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;

    const durationMs = parseDuration(duration);

    if (!durationMs) {
      throw new Error(`Ungültige Mute-Dauer: ${duration}`);
    }

    if (user) {
      const untilTimestamp = Math.floor((Date.now() + durationMs) / 1000);
      await notifyUser(
        user,
        `Du wurdest auf **${guild.name}** automatisch bis <t:${untilTimestamp}:f> stummgeschaltet (${points} Warnpunkte erreicht).`
      );
    }

    // Nur beim Anwenden einer neuen Strafe:
    // alten Timeout entfernen und neuen setzen.
    await removePreviousMute(member);

    await member.timeout(
      durationMs,
      `Automatische Bestrafung bei ${points} Warnpunkten`
    );

    return `Mute für ${duration}`;
  }

  if (type === 'ban') {
    if (duration === 'permanent') {
      if (user) {
        await notifyUser(
          user,
          `Du wurdest von **${guild.name}** automatisch permanent gebannt (${points} Warnpunkte erreicht).`
        );
      }

      await guild.members.ban(userId, {
        reason: `Automatische Bestrafung bei ${points} Warnpunkten`,
      });

      return 'permanenter Bann';
    }

    const durationMs = parseDuration(duration);

    if (!durationMs) {
      throw new Error(`Ungültige Ban-Dauer: ${duration}`);
    }

    if (user) {
      const unbanTimestamp = Math.floor((Date.now() + durationMs) / 1000);
      await notifyUser(
        user,
        `Du wurdest von **${guild.name}** automatisch bis <t:${unbanTimestamp}:f> gebannt (${points} Warnpunkte erreicht).`
      );
    }

    await guild.members.ban(userId, {
      reason: `Automatische Bestrafung bei ${points} Warnpunkten`,
    });

    addTempban(
      guild.id,
      userId,
      Date.now() + durationMs
    );

    return `Bann für ${duration}`;
  }

  throw new Error(`Unbekannter Punishment-Typ: ${type}`);
}

module.exports = {
  getPunishment,
  applyPunishment,
};