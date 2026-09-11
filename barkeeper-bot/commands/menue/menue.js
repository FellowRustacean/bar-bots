const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { getDrinks } = require('../../utils/drinks/drinks');
const { getSnacks } = require('../../utils/snacks/snacks');
const { getBartresenChannelId } = require('../../storage/barSettings');

// Feste Reihenfolge unabhängig von der Einfüge-Reihenfolge in drinks.json - non-alkoholisch vor
// alkoholisch, damit die Karte sich sinnvoll liest. Snacks bewusst als letzte Kategorie - eigene
// Bestellart (/snack am Tisch statt /getränk am Tresen).
const CATEGORY_ORDER = ['Softdrinks', 'Heißgetränke', 'Mocktails', 'Bier & Wein', 'Cocktails', 'Snacks'];

const CATEGORY_EMOJI = {
  Softdrinks: '🥤',
  'Heißgetränke': '☕',
  Mocktails: '🍹',
  'Bier & Wein': '🍺',
  Cocktails: '🍸',
  Snacks: '🥨',
};

const COLUMN_COUNT = 3;
const EMBED_COLOR = 0xe7a630;
const BLANK = '​'; // Zero-width space - Discord erlaubt keine leeren name/value-Felder.

const data = new SlashCommandBuilder()
  .setName('menü')
  .setDescription('Zeigt die komplette Getränkekarte')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Packt ganze Kategorien (nie eine einzelne Kategorie aufgeteilt, das gäbe doppelte Überschriften
// wie "Cocktails"/"Cocktails") in möglichst gleich große Spalten - klassisches Bin-Packing per
// "Longest Processing Time first": größte Kategorie zuerst, landet jeweils in der aktuell
// kleinsten Spalte. Ergebnis bleibt an die tatsächliche Kategorien-Verteilung angepasst, auch
// wenn sich drinks.json später ändert.
function packIntoColumns(categories, columnCount) {
  const sorted = [...categories].sort((a, b) => b.items.length - a.items.length);
  const columns = Array.from({ length: columnCount }, () => ({ size: 0, categories: [] }));

  for (const category of sorted) {
    const smallest = columns.reduce((min, col) => (col.size < min.size ? col : min), columns[0]);
    smallest.categories.push(category);
    smallest.size += category.items.length;
  }

  return columns.filter((col) => col.categories.length > 0);
}

async function execute(interaction) {
  const drinks = getDrinks();
  const snacks = getSnacks();

  const byCategory = new Map();
  for (const [name, entry] of Object.entries(drinks)) {
    const list = byCategory.get(entry.kategorie) ?? [];
    list.push(name);
    byCategory.set(entry.kategorie, list);
  }
  if (snacks.length > 0) byCategory.set('Snacks', [...snacks]);

  const categories = [];
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (items && items.length > 0) categories.push({ name: category, items });
    byCategory.delete(category);
  }
  // Unbekannte Kategorien (z. B. Tippfehler in drinks.json) trotzdem mit aufnehmen statt zu
  // verschlucken.
  for (const [category, items] of byCategory) categories.push({ name: category, items });

  const columns = packIntoColumns(categories, COLUMN_COUNT);

  const bartresenChannelId = getBartresenChannelId(interaction.guildId);
  const drinksLine = bartresenChannelId
    ? `Getränke bestellbar über \`/getränk\` am Tresen: <#${bartresenChannelId}>`
    : 'Getränke bestellbar über `/getränk` am Tresen.';
  const bartresenLine = `${drinksLine}\nSnacks ebenfalls über \`/snack\` am Tresen bestellbar - dafür musst du an einem Tisch sitzen.`;

  const embed = new EmbedBuilder()
    .setTitle('📋 Unser Menü')
    .setDescription(bartresenLine)
    .setColor(EMBED_COLOR);

  const fields = columns.map((column) => ({
    name: BLANK,
    value: column.categories
      .map(({ name, items }) => {
        const emoji = CATEGORY_EMOJI[name] ?? '';
        const list = [...items].sort((a, b) => a.localeCompare(b, 'de')).map((item) => `• ${item}`);
        return `**${emoji} ${name}**\n${list.join('\n')}`;
      })
      .join('\n\n'),
    inline: true,
  }));

  embed.addFields(fields);

  // Bewusst nicht als direkte Interaktions-Antwort, sondern als eigenständige Nachricht im
  // Channel - die Karte soll wie ein normaler Aushang wirken, nicht wie eine Befehlsausgabe.
  await interaction.channel.send({ embeds: [embed] });
  await interaction.reply({ content: 'Menü wurde gepostet.', flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
