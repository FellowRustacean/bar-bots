const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const {
  getHourlySeries,
  getDailySeries,
  getReferralHourlySeries,
  getReferralDailySeries,
  getMemberSnapshotSeries,
  DAY_MS,
} = require('../../storage/stats');
const { renderBarChart } = require('../../utils/stats/chartRenderer');
const { parseLocalDate, formatLocalDate, addLocalDays, localDayBucketStart } = require('../../utils/time/localTime');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Diese beiden Typen kommen aus einem einmal-pro-Tag-Schnappschuss (Mitternacht), nicht aus
// laufend mitgezählter Aktivität - es gibt also nie eine stündliche Aufschlüsselung dafür.
const MEMBER_SNAPSHOT_TYPES = new Set(['total-users', 'total-guests', 'total-tags']);

// Referral-Joins kommen nicht aus hourly_activity, sondern aus einer eigenen Tabelle -
// eigener Satz an Serien-Funktionen (siehe getReferralHourlySeries/getReferralDailySeries).
const REFERRAL_TYPES = new Set(['referrals']);

const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Zeigt Server-Statistiken als Diagramm')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((opt) =>
    opt
      .setName('type')
      .setDescription('Statistik-Typ')
      .setRequired(true)
      .addChoices(
        { name: 'users', value: 'users' },
        { name: 'voice', value: 'voice' },
        { name: 'chat', value: 'chat' },
        { name: 'total users', value: 'total-users' },
        { name: 'total guests', value: 'total-guests' },
        { name: 'total tags', value: 'total-tags' },
        { name: 'referrals', value: 'referrals' }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName('start')
      .setDescription('Startdatum (YYYY-MM-DD, optional - Standard: letzte 7 abgeschlossene Tage)')
      .setRequired(false)
  )
  .addStringOption((opt) => opt.setName('end').setDescription('Enddatum (YYYY-MM-DD, optional)').setRequired(false))
  .addBooleanOption((opt) =>
    opt.setName('ephemeral').setDescription('Nur für dich sichtbar? (Standard: ja)').setRequired(false)
  );

function parseDate(str) {
  if (!DATE_RE.test(str)) return null;
  const ms = parseLocalDate(str);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function valueFor(type, row) {
  if (!row) return 0;
  if (type === 'chat') return row.messages ?? 0;
  if (type === 'voice') return row.voiceMinutes ?? 0;
  if (type === 'total-users') return row.totalUsers ?? 0;
  if (type === 'total-guests') return row.totalGuests ?? 0;
  if (type === 'total-tags') return row.totalTags ?? 0;
  if (type === 'referrals') return row.referralCount ?? 0;
  return row.activeUsers ?? 0;
}

async function execute(interaction) {
  const type = interaction.options.getString('type', true);
  const startOption = interaction.options.getString('start');
  const endOption = interaction.options.getString('end');
  const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
  const replyFlags = ephemeral ? MessageFlags.Ephemeral : undefined;

  let startDate;
  let endDate; // exklusiv

  if (!startOption) {
    // Kein Zeitraum angegeben - Standard: die letzten 7 ABGESCHLOSSENEN Tage. Heute läuft noch,
    // zählt also nicht als voller Tag mit (Ende = heute 00:00 Uhr, exklusiv).
    const todayStart = localDayBucketStart(Date.now());
    endDate = new Date(todayStart);
    startDate = new Date(addLocalDays(todayStart, -7));
  } else {
    startDate = parseDate(startOption);
    if (!startDate) {
      await interaction.reply({
        content: 'Ungültiges Startdatum. Format: `YYYY-MM-DD`.',
        flags: replyFlags,
      });
      return;
    }

    if (endOption) {
      const parsedEnd = parseDate(endOption);
      if (!parsedEnd) {
        await interaction.reply({
          content: 'Ungültiges Enddatum. Format: `YYYY-MM-DD`.',
          flags: replyFlags,
        });
        return;
      }
      endDate = new Date(addLocalDays(parsedEnd.getTime(), 1)); // exklusives Ende
    } else {
      endDate = new Date(addLocalDays(startDate.getTime(), 1));
    }
  }

  if (endDate.getTime() <= startDate.getTime()) {
    await interaction.reply({
      content: 'Das Enddatum muss nach dem Startdatum liegen.',
      flags: replyFlags,
    });
    return;
  }

  await interaction.deferReply({ flags: replyFlags });

  const spansSingleDay = endDate.getTime() - startDate.getTime() <= DAY_MS;
  const valueLabel =
    type === 'chat'
      ? 'Nachrichten'
      : type === 'voice'
      ? 'Minuten'
      : type === 'total-users'
      ? 'Nutzer insgesamt'
      : type === 'total-guests'
      ? 'Gäste insgesamt'
      : type === 'total-tags'
      ? 'Server-Tags aktiv'
      : type === 'referrals'
      ? 'Referral-Joins'
      : 'Aktive Nutzer';

  let labels;
  let values;

  if (MEMBER_SNAPSHOT_TYPES.has(type)) {
    // Nur ein Datenpunkt pro Tag (täglicher Schnappschuss um Mitternacht) - eine stündliche
    // Aufschlüsselung gibt es dafür nicht, unabhängig vom gewählten Zeitraum.
    const rows = getMemberSnapshotSeries(interaction.guildId, startDate.getTime(), endDate.getTime());
    labels = [];
    values = [];
    for (let t = startDate.getTime(); t < endDate.getTime(); t = addLocalDays(t, 1)) {
      const row = rows.find((r) => r.bucketStart === t);
      labels.push(formatLocalDate(t));
      values.push(valueFor(type, row));
    }
  } else if (spansSingleDay) {
    const rows = REFERRAL_TYPES.has(type)
      ? getReferralHourlySeries(interaction.guildId, startDate.getTime(), endDate.getTime())
      : getHourlySeries(interaction.guildId, startDate.getTime(), endDate.getTime());
    labels = [];
    values = [];
    for (let h = 0; h < 24; h++) {
      const bucketStart = startDate.getTime() + h * (60 * 60 * 1000);
      const row = rows.find((r) => r.bucketStart === bucketStart);
      labels.push(`${String(h).padStart(2, '0')}:00`);
      values.push(valueFor(type, row));
    }
  } else {
    const rows = REFERRAL_TYPES.has(type)
      ? getReferralDailySeries(interaction.guildId, startDate.getTime(), endDate.getTime())
      : getDailySeries(interaction.guildId, startDate.getTime(), endDate.getTime());
    labels = [];
    values = [];
    for (let t = startDate.getTime(); t < endDate.getTime(); t = addLocalDays(t, 1)) {
      const row = rows.find((r) => r.bucketStart === t);
      labels.push(formatLocalDate(t));
      values.push(valueFor(type, row));
    }
  }

  const startStrForTitle = formatLocalDate(startDate.getTime());
  const lastIncludedDayStr = formatLocalDate(addLocalDays(endDate.getTime(), -1));
  const title = `${valueLabel} (${startStrForTitle}${lastIncludedDayStr !== startStrForTitle ? ` bis ${lastIncludedDayStr}` : ''})`;
  const buffer = renderBarChart({ title, labels, values, valueLabel });
  const attachment = new AttachmentBuilder(buffer, { name: 'stats.png' });

  await interaction.editReply({ files: [attachment] });
}

module.exports = { data, execute };
