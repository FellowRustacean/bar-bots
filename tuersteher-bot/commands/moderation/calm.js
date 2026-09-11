const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pickRandomLine } = require('../../../shared/lib/messageLines');

// Textbausteine liegen in shared/data/messages/tuersteher.json (Key "calm") - wird bei jedem
// Aufruf frisch gelesen, eine Aenderung dort greift sofort ohne Neustart (siehe messageLines.js).

const data = new SlashCommandBuilder()
  .setName('calm')
  .setDescription('Colt bittet die Runde, sich zu beruhigen')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((opt) => opt.setName('user1').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user2').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user3').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user4').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user5').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user6').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user7').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user8').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user9').setDescription('Nutzer (optional)').setRequired(false))
  .addUserOption((opt) => opt.setName('user10').setDescription('Nutzer (optional)').setRequired(false));

async function execute(interaction) {
  const seen = new Set();
  const mentions = [];

  for (let i = 1; i <= 10; i++) {
    const user = interaction.options.getUser(`user${i}`);
    if (user && !seen.has(user.id)) {
      seen.add(user.id);
      mentions.push(`<@${user.id}>`);
    }
  }

  const line = pickRandomLine('tuersteher', 'calm');
  const content = mentions.length > 0 ? `${line} ${mentions.join(' ')}` : line;

  // Eigenständige Nachricht im Channel statt direkter Antwort auf den Slash Command - soll wie
  // eine echte Ansage wirken, nicht wie eine Befehlsausgabe (siehe /menü für dasselbe Prinzip).
  await interaction.channel.send({ content });
  await interaction.reply({ content: 'Gesagt.', flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
