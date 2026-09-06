const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { removeTempban } = require('../../storage/tempbans');
const { sendModerationLog } = require('../../utils/logs/moderationLog');
const { removeBanRecord, findBanRecordById, findBanRecordByUsername, searchBanRecords } = require('../../storage/bans');

const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Entbannt einen Nutzer')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((opt) =>
    opt
      .setName('user')
      .setDescription('Username oder User-ID des gebannten Nutzers')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) => opt.setName('grund').setDescription('Grund für die Entbannung').setRequired(false));

function isSnowflake(value) {
  return /^\d{17,20}$/.test(value);
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const matches = searchBanRecords(interaction.guildId, focused, 25);

  await interaction.respond(
    matches.map((record) => ({
      name: `${record.username} (${record.userId})`,
      value: record.userId,
    }))
  );
}

function resolveTargetUserId(guildId, input) {
  if (isSnowflake(input)) return input;

  const record = findBanRecordByUsername(guildId, input);
  return record?.userId ?? null;
}

async function execute(interaction) {
  const input = interaction.options.getString('user', true).trim();
  const grund = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

  const userId = resolveTargetUserId(interaction.guildId, input);

  if (!userId) {
    await interaction.reply({
      content: `Kein gebannter Nutzer mit "${input}" gefunden. Nutze die Vorschlagsliste oder gib die User-ID direkt an.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const record = findBanRecordById(interaction.guildId, userId);
  const fetchedUser = await interaction.client.users.fetch(userId).catch(() => null);
  const user = fetchedUser ?? {
    id: userId,
    tag: record?.username ?? userId,
    toString: () => `<@${userId}>`,
  };

  try {
    await interaction.guild.members.unban(userId, grund);
    removeTempban(interaction.guildId, userId);
    removeBanRecord(interaction.guildId, userId);

    await sendModerationLog(interaction.guild, {
      action: 'Entbannung',
      user,
      moderator: interaction.user,
      reason: grund,
    });

    await interaction.reply({
      content: `${user} wurde entbannt. Grund: ${grund}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `${user} konnte nicht entbannt werden. Stelle sicher, dass der Nutzer aktuell gebannt ist und der Bot die Berechtigung **Bannen** hat.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute, autocomplete };
