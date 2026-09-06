const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const BAR_LENGTH = 20;
const EMBED_COLOR = 0x5865f2;
const REFRESH_INTERVAL_MS = 3000;
const REFRESH_DURATION_MS = 120000;

const data = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Zeigt aktuelle CPU-, RAM- und Speichernutzung des Raspberry Pi')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addBooleanOption((opt) =>
    opt.setName('ephemeral').setDescription('Nur für dich sichtbar? (Standard: ja)').setRequired(false)
  );

function formatBytes(bytes) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function bar(percent) {
  const filled = Math.round((percent / 100) * BAR_LENGTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
}

// "available" statt "free" - beruecksichtigt reklaimbaren Puffer/Cache (siehe `free`-Ausgabe),
// zeigt also den tatsaechlich fuer neue Prozesse nutzbaren Speicher, nicht nur den ungenutzten.
async function getMemoryInfo() {
  const { stdout } = await execAsync('free -b');
  const [, total, used] = stdout.trim().split('\n')[1].split(/\s+/).map(Number);
  return { total, used };
}

async function getDiskInfo() {
  const { stdout } = await execAsync('df -B1 /');
  const parts = stdout.trim().split('\n')[1].split(/\s+/);
  return { total: Number(parts[1]), used: Number(parts[2]) };
}

// os.loadavg() liefert die Linux-Standard-Load (gleitender Schnitt der Warteschlangenlänge, keine
// Prozent-Auslastung) - erst im Verhältnis zur Kernzahl aussagekräftig, deshalb hier für den
// Balken auf die Kernzahl normiert (>100% ist bei Überlast möglich, daher gedeckelt).
function getCpuInfo() {
  const [load1, load5, load15] = os.loadavg();
  const cores = os.cpus().length;
  return { load1, load5, load15, cores };
}

// Wirft weiter, wenn die Speicherinfos (nur unter Linux verfügbar) fehlschlagen - der Aufrufer
// entscheidet, ob das beim Erstaufruf eine Fehlermeldung ist oder bei einem Refresh-Tick einfach
// stillschweigend übersprungen wird.
async function buildStatusEmbed({ final = false } = {}) {
  const [memory, disk] = await Promise.all([getMemoryInfo(), getDiskInfo()]);

  const memPercent = (memory.used / memory.total) * 100;
  const diskPercent = (disk.used / disk.total) * 100;

  const cpu = getCpuInfo();
  const cpuPercent = Math.min(100, (cpu.load1 / cpu.cores) * 100);

  return new EmbedBuilder()
    .setTitle('Server-Auslastung')
    .addFields(
      {
        name: 'CPU',
        value: `${bar(cpuPercent)} ${cpuPercent.toFixed(0)}%\nLoad: ${cpu.load1.toFixed(2)} / ${cpu.load5.toFixed(2)} / ${cpu.load15.toFixed(2)} (1/5/15 Min.) auf ${cpu.cores} Kernen`,
      },
      {
        name: 'RAM',
        value: `${bar(memPercent)} ${memPercent.toFixed(0)}%\n${formatBytes(memory.used)} / ${formatBytes(memory.total)} belegt`,
      },
      {
        name: 'Speicher',
        value: `${bar(diskPercent)} ${diskPercent.toFixed(0)}%\n${formatBytes(disk.used)} / ${formatBytes(disk.total)} belegt`,
      }
    )
    .setColor(EMBED_COLOR)
    .setFooter({
      text: final
        ? 'Aktualisierung beendet - keine weiteren automatischen Updates.'
        : `Aktualisiert sich ${REFRESH_DURATION_MS / 1000}s lang alle ${REFRESH_INTERVAL_MS / 1000}s`,
    })
    .setTimestamp();
}

async function execute(interaction) {
  const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
  await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});

  let embed;
  try {
    embed = await buildStatusEmbed();
  } catch (err) {
    await interaction.editReply({
      content: 'Speicherinfos konnten nicht abgerufen werden (nur unter Linux verfügbar).',
    });
    return;
  }

  await interaction.editReply({ embeds: [embed] });

  // Läuft REFRESH_DURATION_MS lang alle REFRESH_INTERVAL_MS neu, dann stoppt es von selbst -
  // kein manuelles Beenden nötig, kein Dauerlauf, der den Bot-Prozess über die Lebenszeit des
  // Befehls hinaus belastet. Ein einzelner fehlgeschlagener Tick (z.B. kurzzeitig `df`/`free`
  // nicht verfügbar) bricht die Reihe NICHT ab, nur editReply-Fehler durch eine gelöschte
  // Nachricht/abgelaufenes Interaction-Token beenden das Intervall vorzeitig.
  const startedAt = Date.now();
  const interval = setInterval(async () => {
    // Naechster Tick wuerde die Gesamtdauer ueberschreiten - DIESER Tick ist also der letzte. Wird
    // als "final" markiert (eigener Footer-Text statt der Aktualisierungs-Ankuendigung), statt
    // einfach stillschweigend aufzuhoeren - sonst bliebe die letzte sichtbare Nachricht faelschlich
    // bei "Aktualisiert sich 120s lang..." stehen, obwohl das gar nicht mehr stimmt.
    const isLastTick = Date.now() - startedAt + REFRESH_INTERVAL_MS >= REFRESH_DURATION_MS;

    let updatedEmbed;
    try {
      updatedEmbed = await buildStatusEmbed({ final: isLastTick });
    } catch (err) {
      // einzelner Tick fehlgeschlagen (free/df kurzzeitig nicht verfügbar) - naechster Tick versucht
      // es erneut, ausser es war ohnehin schon der letzte geplante Tick.
      if (isLastTick) clearInterval(interval);
      return;
    }

    try {
      await interaction.editReply({ embeds: [updatedEmbed] });
    } catch (err) {
      clearInterval(interval); // Nachricht geloescht/Interaction-Token abgelaufen - kein weiterer Sinn
      return;
    }

    if (isLastTick) clearInterval(interval);
  }, REFRESH_INTERVAL_MS);
}

module.exports = { data, execute };
