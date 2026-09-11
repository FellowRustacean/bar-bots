require('dotenv').config();
const path = require('path');
const { REST, Routes } = require('discord.js');
const { loadCommandFiles } = require('./utils/loadCommandFiles');

const commandsPath = path.join(__dirname, 'commands');
const commands = loadCommandFiles(commandsPath).map((filePath) => require(filePath).data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);

    const data = await rest.put(route, { body: commands });
    console.log(`Registered ${data.length} application command(s)${process.env.GUILD_ID ? ' (guild)' : ' (global)'}.`);
  } catch (err) {
    console.error(err);
  }
})();
