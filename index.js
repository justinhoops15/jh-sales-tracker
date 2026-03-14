const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const db = new sqlite3.Database('./sales.db');

db.run(`CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT,
  monthly INTEGER,
  annual INTEGER,
  date TEXT
)`);

const commands = [
  new SlashCommandBuilder()
    .setName('sale')
    .setDescription('Record a sale')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Agent name')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('monthly')
        .setDescription('Monthly premium')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('annual')
        .setDescription('Annual premium')
        .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

let weeklyTotals = {};
let monthlyTotals = {};

client.once('ready', async () => {
  console.log('Sales Tracker Bot is online');

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands },
  );
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'sale') {

    const agent = interaction.options.getString('name');
    const monthly = interaction.options.getInteger('monthly');
    const annual = interaction.options.getInteger('annual');

    const date = new Date().toISOString();

    db.run(
      `INSERT INTO sales(agent, monthly, annual, date) VALUES(?,?,?,?)`,
      [agent, monthly, annual, date]
    );

    if (!weeklyTotals[agent]) weeklyTotals[agent] = 0;
    if (!monthlyTotals[agent]) monthlyTotals[agent] = 0;

    weeklyTotals[agent] += annual;
    monthlyTotals[agent] += annual;

    await interaction.reply(
`✅ **Sale Recorded**

Agent: ${agent}
Monthly Premium: $${monthly}/mo
Annual Premium: $${annual} AP`
    );

  }
});

cron.schedule('0 0 * * 1', () => {
  weeklyTotals = {};
  console.log('Weekly leaderboard reset');
});

cron.schedule('0 0 1 * *', () => {
  monthlyTotals = {};
  console.log('Monthly leaderboard reset');
});

client.login(process.env.TOKEN);
