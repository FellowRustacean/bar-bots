const { SlashCommandBuilder } = require('discord.js');
const { startPoll } = require('../../utils/polls/pollActions');

const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Erstellt eine neue Umfrage mit bis zu 10 Optionen');

async function execute(interaction) {
  await startPoll(interaction);
}

module.exports = { data, execute };
