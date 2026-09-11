const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const warnSuggestions = require('../../warns.json');

const {
  addWarn,
  getWarns,
  getTotalPoints,
  clearWarns,
} = require('../../storage/warns');

const {
  applyPunishment,
} = require('../../utils/moderation/warnPunishments');

const {
  sendModerationLog,
} = require('../../utils/logs/moderationLog');

const {
  removeTempban,
} = require('../../storage/tempbans');

const { logError } = require('../../utils/logs/errorLog');

const MAX_POINTS = 45;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 60 * 60 * 1000; // Aufräumfrist für nie bestätigte/abgelehnte Anfragen

// Kurzlebiger Zwischenspeicher für Verwarnungen, die auf Bestätigung warten (Doppel-Verwarnung
// innerhalb von 24h) - bewusst in-memory statt in der DB, da die Bestätigung typischerweise
// innerhalb von Sekunden/Minuten passiert (vgl. orderQueue.js im Barkeeper für dasselbe Prinzip).
// Übersteht keinen Bot-Neustart - handleButton() fängt das ab (Anfrage gilt dann als abgelaufen).
const pendingWarns = new Map();

function sweepExpiredPending() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of pendingWarns) {
    if (entry.createdAt < cutoff) pendingWarns.delete(id);
  }
}

const data = new SlashCommandBuilder()
  .setName('warns')
  .setDescription('Verwaltet Verwarnungen')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)

  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Fügt einem Nutzer eine Verwarnung hinzu')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, der verwarnt werden soll')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('grund')
          .setDescription('Grund für die Verwarnung')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('punkte')
          .setDescription('Punkte für diese Verwarnung (0 = reine Notiz, ohne Auswirkung auf die Gesamtpunktzahl)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(MAX_POINTS)
      )
  )

  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Zeigt die Verwarnungen eines Nutzers')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, dessen Verwarnungen angezeigt werden')
          .setRequired(true)
      )
  )

  .addSubcommand((sub) =>
    sub
      .setName('clear')
      .setDescription('Entfernt alle Verwarnungs-Punkte und aktuelle Strafen eines Nutzers')
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Nutzer, dessen Verwarnungs-Punkte gelöscht werden')
          .setRequired(true)
      )
  );

// Führt die eigentliche Verwarnung aus (inkl. automatischer Anschluss-Strafe und Log) - genutzt
// sowohl beim direkten Ausführen als auch nach Bestätigung eines Doppel-Verwarnungs-Hinweises.
async function applyWarn({ guild, moderator, targetUser, grund, punkte }) {
  addWarn(guild.id, targetUser.id, moderator.id, grund, punkte);

  const totalPoints = getTotalPoints(guild.id, targetUser.id);

  let punishmentText = '';
  let punishmentForLog = 'Keine neue automatische Strafe';

  try {
    const punishment = await applyPunishment(guild, targetUser.id, totalPoints);

    if (punishment) {
      punishmentText = `\n**Automatische Strafe:** ${punishment}`;
      punishmentForLog = punishment;
    }
  } catch (err) {
    await logError(err, { context: 'Warn-Strafe anwenden', guildId: guild.id });
    punishmentText = '\n⚠️ Die automatische Strafe konnte nicht angewendet werden.';
    punishmentForLog = '⚠️ Automatische Strafe konnte nicht angewendet werden';
  }

  try {
    await sendModerationLog(guild, {
      action: 'Verwarnung hinzugefügt',
      user: targetUser,
      moderator,
      reason: `${grund} (+${punkte} Punkte)\nGesamtpunkte: ${totalPoints}\nAutomatische Strafe: ${punishmentForLog}`,
    });
  } catch (err) {
    await logError(err, { context: 'Moderations-Log für Warn', guildId: guild.id });
  }

  return { totalPoints, punishmentText };
}

function confirmationButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`warn_confirm:${id}`).setLabel('Verwarnen').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`warn_cancel:${id}`).setLabel('Zurücknehmen').setStyle(ButtonStyle.Secondary)
  );
}

async function executeAdd(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const grund = interaction.options.getString('grund', true);
  const punkte = interaction.options.getInteger('punkte', true);

  const previousWarns = getWarns(interaction.guildId, targetUser.id);
  const lastWarn = previousWarns[0];

  if (lastWarn && Date.now() - lastWarn.createdAt < DUPLICATE_WINDOW_MS) {
    sweepExpiredPending();

    const id = interaction.id;
    pendingWarns.set(id, {
      guildId: interaction.guildId,
      moderatorId: interaction.user.id,
      targetUserId: targetUser.id,
      grund,
      punkte,
      createdAt: Date.now(),
    });

    const lastWarnTimestamp = Math.floor(lastWarn.createdAt / 1000);
    await interaction.reply({
      content:
        `${targetUser} wurde <t:${lastWarnTimestamp}:R> wegen **${lastWarn.warnType}** verwarnt (${lastWarn.points} Punkte). ` +
        'Prüfe bitte, dass deine Verwarnung für einen weiteren Regelverstoß ist.',
      components: [confirmationButtons(id)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { totalPoints, punishmentText } = await applyWarn({
    guild: interaction.guild,
    moderator: interaction.user,
    targetUser,
    grund,
    punkte,
  });

  await interaction.reply({
    content:
      `${targetUser} wurde verwarnt.\n` +
      `**Grund:** ${grund}\n` +
      `**Punkte:** +${punkte}\n` +
      `**Gesamt:** ${totalPoints}` +
      punishmentText,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleButton(interaction) {
  const [action, id] = interaction.customId.split(':');
  const pending = pendingWarns.get(id);
  pendingWarns.delete(id);

  if (!pending) {
    await interaction.update({ content: 'Diese Anfrage ist abgelaufen. Bitte den Befehl erneut ausführen.', components: [] });
    return;
  }

  if (action === 'warn_cancel') {
    await interaction.update({ content: 'Verwarnung wurde zurückgenommen.', components: [] });
    return;
  }

  const guild = await interaction.client.guilds.fetch(pending.guildId);
  const moderator = await interaction.client.users.fetch(pending.moderatorId);
  const targetUser = await interaction.client.users.fetch(pending.targetUserId);

  const { totalPoints, punishmentText } = await applyWarn({
    guild,
    moderator,
    targetUser,
    grund: pending.grund,
    punkte: pending.punkte,
  });

  await interaction.update({
    content:
      `${targetUser} wurde verwarnt.\n` +
      `**Grund:** ${pending.grund}\n` +
      `**Punkte:** +${pending.punkte}\n` +
      `**Gesamt:** ${totalPoints}` +
      punishmentText,
    components: [],
  });
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const user = interaction.options.getUser('user', true);

  if (subcommand === 'add') {
    await executeAdd(interaction);
    return;
  }

  /*
   * /warns list
   */
  if (subcommand === 'list') {
    const userWarns = getWarns(
      interaction.guildId,
      user.id
    );

    const totalPoints = getTotalPoints(
      interaction.guildId,
      user.id
    );

    if (userWarns.length === 0) {
      await interaction.reply({
        content:
          `${user} hat keine Verwarnungen.\n` +
          `**Aktuelle Punkte: 0**`,
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const lines = userWarns.map((warn, index) => {
      const timestamp = Math.floor(warn.createdAt / 1000);

      return (
        `**${index + 1}. ${warn.warnType}** — ` +
        `${warn.points} Punkt${warn.points === 1 ? '' : 'e'}\n` +
        `└ Moderator: <@${warn.moderatorId}> • ` +
        `<t:${timestamp}:f> (<t:${timestamp}:R>)`
      );
    });

    await interaction.reply({
      content:
        `### Verwarnungen für ${user}\n\n` +
        lines.join('\n\n') +
        `\n\n**Aktuelle Punkte: ${totalPoints}**`,
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  /*
   * /warns clear
   */
  if (subcommand === 'clear') {
    const currentPoints = getTotalPoints(
      interaction.guildId,
      user.id
    );

    const member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

    const removedPunishments = [];

    /*
     * Aktiven Timeout entfernen
     */
    if (
      member &&
      member.communicationDisabledUntilTimestamp
    ) {
      try {
        await member.timeout(
          null,
          `Warns von ${interaction.user.tag} gelöscht`
        );

        removedPunishments.push('Mute');
      } catch (err) {
        await logError(err, { context: 'Mute entfernen', guildId: interaction.guildId });
      }
    }

    /*
     * Aktiven Bann entfernen
     */
    const ban = await interaction.guild.bans
      .fetch(user.id)
      .catch(() => null);

    if (ban) {
      try {
        await interaction.guild.members.unban(
          user.id,
          `Warns von ${interaction.user.tag} aufgehoben`
        );

        removedPunishments.push('Bann');
      } catch (err) {
        await logError(err, { context: 'Bann entfernen', guildId: interaction.guildId });
      }
    }

    /*
     * Eventuellen Tempban aus der Datenbank entfernen
     */
    try {
      removeTempban(
        interaction.guildId,
        user.id
      );
    } catch (err) {
      await logError(err, { context: 'Tempban entfernen', guildId: interaction.guildId });
    }

    /*
     * Warns aus der Datenbank löschen
     */
    clearWarns(
      interaction.guildId,
      user.id
    );

    const punishmentText =
      removedPunishments.length > 0
        ? removedPunishments.join(', ')
        : 'Keine aktive Strafe';

    /*
     * Moderations-Log
     */
    try {
      await sendModerationLog(interaction.guild, {
        action: 'Verwarnungen gelöscht',
        user,
        moderator: interaction.user,
        reason:
          `Alle aktuellen Sanktionen und Warn-Punkte gelöscht.\n` +
          `Entfernte Punkte: ${currentPoints}\n` +
          `Aufgehobene Strafe: ${punishmentText}`,
      });
    } catch (err) {
      await logError(err, { context: 'Moderations-Log für Warn-Clear', guildId: interaction.guildId });
    }

    await interaction.reply({
      content:
        `Alle Verwarnungen von ${user} wurden gelöscht.\n` +
        `**Entfernte Punkte:** ${currentPoints}\n` +
        `**Entfernte Strafen:** ${punishmentText}`,
      flags: MessageFlags.Ephemeral,
    });

    return;
  }
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  const matches = Object.entries(warnSuggestions)
    .filter(([name]) => name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(([name, range]) => {
      const label = typeof range === 'object' ? `${range.min}-${range.max} Punkte` : `${range} Punkt${range === 1 ? '' : 'e'}`;
      return { name: `${name} (${label})`, value: name };
    });

  await interaction.respond(matches);
}

module.exports = {
  data,
  execute,
  autocomplete,
  handleButton,
};
