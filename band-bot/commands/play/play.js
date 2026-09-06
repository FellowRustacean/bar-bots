const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getFolders, setActiveFolder } = require('../../utils/band/bandPlayer');

const ALL_FOLDERS_VALUE = '__all__';
const ALL_FOLDERS_LABEL = '🔀 Alle (zufällig gemischt)';

const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Wählt aus, welcher Musik-Ordner (Genre) gerade gespielt werden soll')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addStringOption((opt) =>
    opt.setName('ordner').setDescription('Genre-Ordner unter shared/music').setRequired(true).setAutocomplete(true)
  );

// Ordnerliste kommt live von der Platte (siehe getFolders in bandPlayer.js) - neue Ordner tauchen
// hier automatisch auf, ohne dass der Bot neu gestartet oder der Command neu registriert werden muss.
async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  const options = [
    { name: ALL_FOLDERS_LABEL, value: ALL_FOLDERS_VALUE },
    ...getFolders().map((folder) => ({ name: folder, value: folder })),
  ];

  const filtered = options.filter((opt) => opt.name.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(filtered);
}

async function execute(interaction) {
  const choice = interaction.options.getString('ordner', true);
  const folderName = choice === ALL_FOLDERS_VALUE ? null : choice;

  const result = setActiveFolder(folderName);

  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const label = folderName ?? 'alle Ordner (zufällig gemischt)';
  await interaction.reply({ content: `🎵 Spiele jetzt aus: **${label}**`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute, autocomplete };
