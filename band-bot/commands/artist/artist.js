const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { MUSIC_DIR } = require('../../utils/band/bandPlayer');
const {
  addArtist,
  updateArtist,
  removeArtist,
  setArtistCreditUrl,
  getArtistByUser,
  getArtistByFolder,
} = require('../../storage/artists');

const URL_PATTERN = /^https?:\/\/\S+$/i;

const data = new SlashCommandBuilder()
  .setName('artist')
  .setDescription('Verwaltet Band-Artist-Profile (eigener Musik-Ordner, Umbenennung des Bots beim Abspielen)')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Legt ein neues Artist-Profil an und erstellt den zugehörigen Musik-Ordner')
      .addUserOption((opt) => opt.setName('user').setDescription('Der Artist').setRequired(true))
      .addStringOption((opt) => opt.setName('name').setDescription('Anzeigename des Artists').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Entfernt ein Artist-Profil (der Musik-Ordner wird archiviert, nicht gelöscht)')
      .addUserOption((opt) => opt.setName('user').setDescription('Der Artist').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('rename')
      .setDescription('Benennt ein Artist-Profil (und dessen Musik-Ordner) um')
      .addUserOption((opt) => opt.setName('user').setDescription('Der Artist').setRequired(true))
      .addStringOption((opt) => opt.setName('name').setDescription('Neuer Anzeigename').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('link')
      .setDescription('Setzt den Credits-Link, der im Player-Embed angezeigt wird, wenn der Artist läuft')
      .addStringOption((opt) => opt.setName('link').setDescription('URL (z.B. Spotify/Instagram/Website)').setRequired(true))
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Für welchen Artist? (Standard: du selbst)').setRequired(false)
      )
  );

// Kein "/" oder "\" (kein verschachtelter Pfad), kein führender Punkt (kein verstecktes/relatives
// Verzeichnis), nicht leer - ein Artist-Ordner soll immer ein einzelner, flacher Ordnername sein.
function validateName(name) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: 'Der Name darf nicht leer sein.' };
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { ok: false, message: 'Der Name darf keine "/" oder "\\" enthalten (nur ein einzelner Ordnername).' };
  }
  if (trimmed.startsWith('.')) {
    return { ok: false, message: 'Der Name darf nicht mit einem Punkt beginnen.' };
  }
  return { ok: true, value: trimmed };
}

function isAdmin(interaction) {
  return interaction.member.permissions.has('Administrator');
}

async function handleAdd(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Dafür brauchst du Administrator-Rechte.', flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.getUser('user', true);
  const nameCheck = validateName(interaction.options.getString('name', true));
  if (!nameCheck.ok) {
    await interaction.reply({ content: nameCheck.message, flags: MessageFlags.Ephemeral });
    return;
  }
  const name = nameCheck.value;

  if (getArtistByUser(interaction.guildId, user.id)) {
    await interaction.reply({
      content: `${user} hat bereits ein Artist-Profil. Nutze \`/artist rename\`, um es umzubenennen.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingByFolder = getArtistByFolder(interaction.guildId, name);
  if (existingByFolder) {
    await interaction.reply({
      content: `Der Name **${name}** ist schon durch <@${existingByFolder.userId}> vergeben.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const folderPath = path.join(MUSIC_DIR, name);
  // recursive:true ist idempotent - existiert der Ordner schon (z.B. manuell vorbereitet, bevor
  // /artist add ausgefuehrt wurde), wird er einfach uebernommen statt einen Fehler zu werfen.
  fs.mkdirSync(folderPath, { recursive: true });

  addArtist(interaction.guildId, user.id, name, name);

  await interaction.reply({
    content: `✅ Artist-Profil für ${user} angelegt: **${name}** (Ordner \`shared/music/${name}\`). Läuft Musik aus diesem Ordner, nennt sich die Band automatisch nach dem Artist um.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Dafür brauchst du Administrator-Rechte.', flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.getUser('user', true);
  const artist = getArtistByUser(interaction.guildId, user.id);
  if (!artist) {
    await interaction.reply({ content: `${user} hat kein Artist-Profil.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const oldPath = path.join(MUSIC_DIR, artist.folderName);
  let archiveNote = '';

  if (fs.existsSync(oldPath)) {
    let archiveName = `entfernt_${artist.folderName}`;
    let archivePath = path.join(MUSIC_DIR, archiveName);
    // Falls schon mal ein Artist mit demselben Namen entfernt wurde, nicht überschreiben, sondern
    // mit Zeitstempel disambiguieren.
    if (fs.existsSync(archivePath)) {
      archiveName = `entfernt_${artist.folderName}_${Date.now()}`;
      archivePath = path.join(MUSIC_DIR, archiveName);
    }
    fs.renameSync(oldPath, archivePath);
    archiveNote = ` Der Musik-Ordner wurde nach \`shared/music/${archiveName}\` verschoben (nicht gelöscht).`;
  }

  removeArtist(interaction.guildId, user.id);

  await interaction.reply({
    content: `✅ Artist-Profil **${artist.name}** (${user}) entfernt.${archiveNote}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRename(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Dafür brauchst du Administrator-Rechte.', flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.getUser('user', true);
  const artist = getArtistByUser(interaction.guildId, user.id);
  if (!artist) {
    await interaction.reply({
      content: `${user} hat noch kein Artist-Profil. Nutze \`/artist add\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nameCheck = validateName(interaction.options.getString('name', true));
  if (!nameCheck.ok) {
    await interaction.reply({ content: nameCheck.message, flags: MessageFlags.Ephemeral });
    return;
  }
  const newName = nameCheck.value;

  if (newName === artist.name) {
    await interaction.reply({ content: 'Das ist bereits der aktuelle Name.', flags: MessageFlags.Ephemeral });
    return;
  }

  const existingByFolder = getArtistByFolder(interaction.guildId, newName);
  if (existingByFolder) {
    await interaction.reply({
      content: `Der Name **${newName}** ist schon durch <@${existingByFolder.userId}> vergeben.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const oldPath = path.join(MUSIC_DIR, artist.folderName);
  const newPath = path.join(MUSIC_DIR, newName);

  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  } else {
    fs.mkdirSync(newPath, { recursive: true });
  }

  updateArtist(interaction.guildId, user.id, newName, newName);

  await interaction.reply({
    content: `✅ **${artist.name}** heißt jetzt **${newName}** (Ordner \`shared/music/${newName}\`).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLink(interaction) {
  const targetUser = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = targetUser.id === interaction.user.id;

  if (!isSelf && !isAdmin(interaction)) {
    await interaction.reply({
      content: 'Um den Link für jemand anderen zu setzen, brauchst du Administrator-Rechte.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const artist = getArtistByUser(interaction.guildId, targetUser.id);
  if (!artist) {
    await interaction.reply({
      content: isSelf
        ? 'Du hast noch kein Artist-Profil - lass dir erst per `/artist add` eins anlegen.'
        : `${targetUser} hat kein Artist-Profil.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const link = interaction.options.getString('link', true).trim();
  if (!URL_PATTERN.test(link)) {
    await interaction.reply({ content: 'Das sieht nicht nach einer gültigen URL aus (muss mit http:// oder https:// beginnen).', flags: MessageFlags.Ephemeral });
    return;
  }

  setArtistCreditUrl(interaction.guildId, targetUser.id, link);

  await interaction.reply({
    content: `✅ Credits-Link für **${artist.name}** gesetzt: ${link}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'add') return handleAdd(interaction);
  if (subcommand === 'remove') return handleRemove(interaction);
  if (subcommand === 'rename') return handleRename(interaction);
  if (subcommand === 'link') return handleLink(interaction);
}

module.exports = { data, execute };
