const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { listModels, unloadModel, preloadModel, withExclusiveOllamaAccess } = require('../../utils/llm/ollamaClient');
const { getActiveLlmModel, setActiveLlmModel } = require('../../storage/llmSettings');

const NONE_VALUE = 'none';

const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Verwaltet das lokale LLM-Modell (Ollama) auf dem Pi')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt die auf dem Pi geladenen Modelle'))
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Legt das aktive Modell fest (muss bereits geladen sein) - "none" schaltet die LLM-Funktion ab')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Modellname oder "none"').setRequired(true).setAutocomplete(true)
      )
  );

function formatBytes(bytes) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

async function handleList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const models = await listModels();
  const activeModel = getActiveLlmModel(interaction.guildId);

  const embed = new EmbedBuilder().setTitle('Geladene LLM-Modelle (Pi)');

  if (models.length === 0) {
    embed.setDescription('Keine Modelle geladen.');
  } else {
    embed.setDescription(
      models
        .map((m) => {
          const marker = m.name === activeModel ? '🟢 ' : '';
          return `${marker}**${m.name}** — ${m.details?.parameter_size ?? '?'} · ${m.details?.quantization_level ?? '?'} · ${formatBytes(m.size)}`;
        })
        .join('\n')
    );
  }

  if (!activeModel) embed.setFooter({ text: 'Kein aktives Modell gesetzt (/model set <name>).' });
  else if (activeModel === NONE_VALUE) embed.setFooter({ text: 'LLM-Funktion ist aktuell deaktiviert (/model set none).' });

  await interaction.editReply({ embeds: [embed] });
}

// Entlaedt das vorher aktive Modell und laedt das neue direkt vor (keep_alive: -1, siehe
// ollamaClient.js) - nie zwei Modelle gleichzeitig im RAM (der Pi hat dafuer nicht genug, siehe
// Session-Tests) und die naechste echte Chat-Anfrage muss nicht mehr selbst den Ladezeit-Malus
// zahlen. Exklusiv-gesperrt (withExclusiveOllamaAccess).
async function handleSet(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const previousModel = getActiveLlmModel(interaction.guildId);

  if (name.toLowerCase() === NONE_VALUE) {
    setActiveLlmModel(interaction.guildId, NONE_VALUE);
    if (previousModel && previousModel !== NONE_VALUE) {
      await withExclusiveOllamaAccess(`Entladen ${previousModel}`, () => unloadModel(previousModel)).catch(() => {});
    }
    await interaction.editReply({ content: 'LLM-Funktion ist jetzt **deaktiviert** (Modell entladen).' });
    return;
  }

  const models = await listModels();
  if (!models.some((m) => m.name === name)) {
    await interaction.editReply({ content: `**${name}** ist auf dem Pi nicht geladen.` });
    return;
  }

  if (name === previousModel) {
    await interaction.editReply({ content: `**${name}** ist bereits das aktive Modell.` });
    return;
  }

  setActiveLlmModel(interaction.guildId, name);
  await interaction.editReply({ content: `⏳ Wechsle zu **${name}**...` });

  try {
    await withExclusiveOllamaAccess(`Modellwechsel zu ${name}`, async () => {
      if (previousModel && previousModel !== NONE_VALUE && previousModel !== name) {
        await unloadModel(previousModel).catch(() => {});
      }
      await preloadModel(name);
    });
    await interaction.editReply({ content: `✅ Aktives Modell ist jetzt **${name}** (geladen, bleibt dauerhaft im RAM).` });
  } catch (err) {
    await interaction.editReply({
      content: `⚠️ Aktives Modell ist jetzt **${name}**, aber Vorladen ist fehlgeschlagen (${err.message}) - wird bei der naechsten Anfrage automatisch nachgeholt.`,
    });
  }
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') return handleList(interaction);
  if (subcommand === 'set') return handleSet(interaction);
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const models = await listModels().catch(() => []);
  const suggestions = [{ name: 'none (LLM deaktivieren)', value: NONE_VALUE }, ...models.map((m) => ({ name: m.name, value: m.name }))];
  const matches = suggestions.filter((s) => s.name.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(matches);
}

module.exports = { data, execute, autocomplete };
