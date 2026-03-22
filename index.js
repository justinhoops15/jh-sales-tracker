const WEEKLY_CHANNEL = "1482084042596810814";
const MONTHLY_CHANNEL = "1482084154459029544";
const WEEKLY_HISTORY = "1482171225512869889";
const MONTHLY_HISTORY = "1482171288918167765";
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

function getWeekRange() {
  const now = new Date();

  // Get Monday of LAST week (since reset runs Monday)
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() - 6);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const month = start.toLocaleString('en-US', { month: 'long' });

  return `${month} ${start.getDate()}-${end.getDate()}`;
}

function getMonthLabel() {
  const now = new Date();

  // Get LAST month (since reset runs on the 1st)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);

  const month = lastMonth.toLocaleString('en-US', { month: 'long' });
  const year = lastMonth.getFullYear();

  return `${month} ${year}`;
}

async function updateLeaderboard(channelId, totals, title) {

  const channel = await client.channels.fetch(channelId);

  const sorted = Object.entries(totals)
    .sort((a,b) => b[1] - a[1])
    .slice(0,10);

  let message = `🏆 **${title}**\n\n`;

  sorted.forEach((entry, index) => {
    message += `${index+1}. ${entry[0]} — $${entry[1]}\n`;
  });

  channel.send(message);
}


async function postFinalLeaderboard(channelId, totals, title) {

  const channel = await client.channels.fetch(channelId);

  const sorted = Object.entries(totals)
    .sort((a,b) => b[1] - a[1]);

  let message = `📊 **${title} (Final Results)**\n\n`;

  sorted.forEach((entry, index) => {
    message += `${index+1}. ${entry[0]} — $${entry[1]}\n`;
  });

  channel.send(message);
}

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
   
    updateLeaderboard(WEEKLY_CHANNEL, weeklyTotals, "Weekly Leaderboard");
    updateLeaderboard(MONTHLY_CHANNEL, monthlyTotals, "Monthly AP Leaderboard");

    await interaction.reply(
`✅ **Sale Recorded**

Agent: ${agent}
Monthly Premium: $${monthly}/mo
Annual Premium: $${annual} AP`
    );

  }
});

cron.schedule('0 0 * * 1', async () => {

  const weekRange = getWeekRange();
await postFinalLeaderboard(WEEKLY_HISTORY, weeklyTotals, `Weekly Leaderboard (${weekRange})`);

  weeklyTotals = {};

  updateLeaderboard(WEEKLY_CHANNEL, weeklyTotals, "Weekly Leaderboard");

  console.log('Weekly leaderboard reset');

});

cron.schedule('0 0 1 * *', async () => {

  const monthLabel = getMonthLabel();
await postFinalLeaderboard(MONTHLY_HISTORY, monthlyTotals, `${monthLabel} Leaderboard`);

  monthlyTotals = {};

  updateLeaderboard(MONTHLY_CHANNEL, monthlyTotals, "Monthly AP Leaderboard");

  console.log('Monthly leaderboard reset');

});

client.login(process.env.TOKEN);
