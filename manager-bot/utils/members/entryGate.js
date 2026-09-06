const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getMemberRoleId } = require('../../storage/roleSettings');
const { touchActivity, getStaleMembers } = require('../../storage/memberActivity');
const { logError } = require('../logs/errorLog');

const ENTRY_BUTTON_ID = 'bar_entry_button';
const INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Schutz gegen Doppel-Begrüßung: interaction.member.roles.cache wird erst aktualisiert, NACHDEM
// roles.add() abgeschlossen ist und die Bestätigung vom Gateway zurückkommt - klickt jemand kurz
// hintereinander zweimal (oder feuert Discord die Interaktion doppelt), sehen beide Aufrufe noch
// "hat die Rolle nicht". Diese Sperre ist bewusst rein in-memory (kein DB-Overhead nötig) - ein
// Bot-Neustart mitten in einem Doppelklick ist ein derart unwahrscheinlicher Fall, dass er hier
// nicht extra abgefangen wird.
const processingEntries = new Set();

function buildEntryButtonRow() {
  const button = new ButtonBuilder()
    .setCustomId(ENTRY_BUTTON_ID)
    .setLabel('Die Bar betreten')
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder().addComponents(button);
}

// Vergibt beim Klick die member-Rolle und zählt den Klick selbst schon als Aktivität -
// verhindert, dass frisch eingetretene Mitglieder sofort wieder als "inaktiv" gelten,
// bevor sie überhaupt geschrieben haben.
async function handleEntryButtonClick(interaction) {
  const roleId = getMemberRoleId(interaction.guildId);

  if (!roleId) {
    await interaction.reply({
      content: 'Für diesen Server ist noch keine "member"-Rolle konfiguriert.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  touchActivity(interaction.guildId, interaction.user.id);

  if (interaction.member.roles.cache.has(roleId)) {
    await interaction.reply({ content: '✅ Du hast bereits Zugang zur Bar.', flags: MessageFlags.Ephemeral });
    return;
  }

  const entryKey = `${interaction.guildId}:${interaction.user.id}`;
  if (processingEntries.has(entryKey)) {
    await interaction.reply({ content: '⏳ Dein Beitritt wird gerade schon bearbeitet.', flags: MessageFlags.Ephemeral });
    return;
  }
  processingEntries.add(entryKey);

  try {
    // Die eigentliche Willkommensnachricht kommt jetzt ausschließlich über
    // handleMemberRoleChange (siehe welcomeMessage.js, haengt am guildMemberUpdate-Event) - läuft
    // nur noch im dafür konfigurierten Kanal, nicht mehr zusätzlich fest am Bartresen.
    await interaction.member.roles.add(roleId, 'Bar über Button betreten');
    await interaction.reply({ content: '🚪 Willkommen in der Bar!', flags: MessageFlags.Ephemeral });
  } finally {
    processingEntries.delete(entryKey);
  }
}

// Täglicher Check: Mitglieder, die seit über 7 Tagen weder im Chat noch in Voice aktiv
// waren, verlieren die member-Rolle wieder (kann jederzeit erneut per Button geholt werden).
// Mitglieder ohne jegliche erfasste Aktivität werden bewusst NICHT angefasst.
async function checkInactiveMembers(client) {
  const threshold = Date.now() - INACTIVITY_MS;

  for (const guild of client.guilds.cache.values()) {
    const roleId = getMemberRoleId(guild.id);
    if (!roleId) continue;

    const staleMembers = getStaleMembers(guild.id, threshold);

    for (const { userId } of staleMembers) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) continue;
        if (!member.roles.cache.has(roleId)) continue; // hat die Rolle ohnehin nicht

        await member.roles.remove(roleId, 'Inaktivität (>7 Tage) - Zugang entfernt');
      } catch (err) {
        await logError(err, { context: 'Inaktivitäts-Check: Rolle entfernen', guildId: guild.id });
      }
    }
  }
}

function startInactivityChecker(client) {
  checkInactiveMembers(client).catch((err) => logError(err, { context: 'Inaktivitäts-Check (Start)' }));
  setInterval(() => {
    checkInactiveMembers(client).catch((err) => logError(err, { context: 'Inaktivitäts-Check' }));
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  ENTRY_BUTTON_ID,
  buildEntryButtonRow,
  handleEntryButtonClick,
  checkInactiveMembers,
  startInactivityChecker,
};
