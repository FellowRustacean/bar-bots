const { ApplicationCommandOptionType } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');

const MENTIONABLE_TYPES = new Set([
  ApplicationCommandOptionType.User,
  ApplicationCommandOptionType.Channel,
  ApplicationCommandOptionType.Role,
  ApplicationCommandOptionType.Mentionable,
]);

function formatOptionValue(option) {
  if (option.type === ApplicationCommandOptionType.User) return `<@${option.value}>`;
  if (option.type === ApplicationCommandOptionType.Channel) return `<#${option.value}>`;
  if (option.type === ApplicationCommandOptionType.Role) return `<@&${option.value}>`;
  if (option.type === ApplicationCommandOptionType.Mentionable) {
    return MENTIONABLE_TYPES.has(option.type) ? `<@${option.value}>` : String(option.value);
  }
  return String(option.value);
}

function formatCommandInvocation(interaction) {
  let text = `/${interaction.commandName}`;

  function walk(options) {
    for (const option of options ?? []) {
      if (
        option.type === ApplicationCommandOptionType.Subcommand ||
        option.type === ApplicationCommandOptionType.SubcommandGroup
      ) {
        text += ` ${option.name}`;
        walk(option.options);
      } else {
        text += ` ${option.name}:${formatOptionValue(option)}`;
      }
    }
  }

  walk(interaction.options.data);
  return text;
}

// Bewusst eine schlichte Textzeile statt Embed - Nutzer, Kanal und Befehl reichen, der Zeitpunkt
// ergibt sich schon aus dem Zeitstempel der Log-Nachricht selbst (kein eigenes Feld nötig). Der
// Nutzer wird bewusst OHNE @-Markierung geloggt (Name + ID als reiner Text), damit das Log
// niemanden benachrichtigt.
async function logCommandUsage(interaction) {
  const channelId = getLogChannel(interaction.guildId, 'commands');
  if (!channelId) return;

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const content = `${interaction.user.tag} (${interaction.user.id}) | ${interaction.channel}: \`${formatCommandInvocation(interaction)}\``;
  await channel.send({ content }).catch(() => {});
}

module.exports = { logCommandUsage };
