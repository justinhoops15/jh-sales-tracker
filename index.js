const WEEKLY_CHANNEL = "1482084042596810814";
const MONTHLY_CHANNEL = "1482084154459029544";
const WEEKLY_HISTORY = "1482171225512869889";
const MONTHLY_HISTORY = "1482171288918167765";
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
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
  ,
  new SlashCommandBuilder()
  .setName('delete')
  .setDescription('Delete a sale')
  .addIntegerOption(option =>
    option.setName('id')
      .setDescription('Sale ID')
      .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

let weeklyMessageId = null;
let monthlyMessageId = null;

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

async function updateLeaderboard(channelId, title, type) {

  const channel = await client.channels.fetch(channelId);

  let dateFilter;

  if (type === "weekly") {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay() + 1);
    start.setHours(0,0,0,0);
    dateFilter = start.toISOString();
  }

  if (type === "monthly") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    dateFilter = start.toISOString();
  }

  db.all(
    `SELECT agent, SUM(annual) as total
     FROM sales
     WHERE date >= ?
     GROUP BY agent
     ORDER BY total DESC`,
    [dateFilter],
    async (err, rows) => {

      if (err) return console.error(err);

      const medals = ["🥇", "🥈", "🥉"];

      let message = `🏆 **${title}**\n\n`;

      rows.slice(0,10).forEach((row, index) => {
        if (index < 3) {
          message += `${medals[index]} ${row.agent} — $${row.total}\n`;
        } else {
          message += `${index+1}. ${row.agent} — $${row.total}\n`;
        }
      });

      try {
        let msg;

        if (type === 'weekly' && weeklyMessageId) {
          msg = await channel.messages.fetch(weeklyMessageId);
          await msg.edit(message);
        } else if (type === 'monthly' && monthlyMessageId) {
          msg = await channel.messages.fetch(monthlyMessageId);
          await msg.edit(message);
        } else {
          msg = await channel.send(message);

          if (type === 'weekly') weeklyMessageId = msg.id;
          if (type === 'monthly') monthlyMessageId = msg.id;
        }

      } catch {
        const msg = await channel.send(message);

        if (type === 'weekly') weeklyMessageId = msg.id;
        if (type === 'monthly') monthlyMessageId = msg.id;
      }

    }
  );
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
    Routes.applicationCommands(client.user.id, "1325862542786039849"),
    { body: commands },
  );
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ======================
  // SALE COMMAND
  // ======================
  if (interaction.commandName === 'sale') {

    const agent = interaction.options.getString('name');
    const monthly = interaction.options.getInteger('monthly');
    const annual = interaction.options.getInteger('annual');

    const date = new Date().toISOString();
    

    // insert into database (ONLY ONCE)
    db.run(
      `INSERT INTO sales(agent, monthly, annual, date) VALUES(?,?,?,?)`,
      [agent, monthly, annual, date],
      function(err) {

        if (err) return console.error(err);

        const saleId = this.lastID;

        // update leaderboards
        updateLeaderboard(WEEKLY_CHANNEL, "Weekly Leaderboard", "weekly");
        updateLeaderboard(MONTHLY_CHANNEL, "Monthly AP Leaderboard", "monthly");

        // reply with ID
const embed = new EmbedBuilder()
  .setColor(0xFFD700) // gold
  .setTitle(`💰 Sale Recorded (#${saleId})`)
  .addFields(
    { name: 'Agent', value: agent, inline: true },
    { name: 'Monthly', value: `$${monthly}/mo`, inline: true },
    { name: 'Annual', value: `$${annual} AP`, inline: true }
  )
  .setTimestamp();

interaction.reply({ embeds: [embed] });

      }
    );
  }

  // ======================
  // DELETE COMMAND
  // ======================
  if (interaction.commandName === 'delete') {

    const id = interaction.options.getInteger('id');

    db.get(`SELECT * FROM sales WHERE id = ?`, [id], (err, row) => {

      if (!row) {
        return interaction.reply({ content: 'Sale not found', ephemeral: true });
      }
      

      db.run(`DELETE FROM sales WHERE id = ?`, [id]);

      updateLeaderboard(WEEKLY_CHANNEL, "Weekly Leaderboard", "weekly");
      updateLeaderboard(MONTHLY_CHANNEL, "Monthly AP Leaderboard", "monthly");

      // silent confirmation
      interaction.reply({ content: `Sale #${id} deleted`, ephemeral: true });

    });
  }

});


cron.schedule('0 0 * * 1', async () => {

  const weekRange = getWeekRange();

  await postFinalLeaderboard(WEEKLY_HISTORY, {}, `Weekly Leaderboard (${weekRange})`);

  updateLeaderboard(WEEKLY_CHANNEL, "Weekly Leaderboard", "weekly");

  console.log('Weekly leaderboard reset');

});

cron.schedule('0 0 1 * *', async () => {

  const monthLabel = getMonthLabel();

  await postFinalLeaderboard(MONTHLY_HISTORY, {}, `${monthLabel} Leaderboard`);

  updateLeaderboard(MONTHLY_CHANNEL, "Monthly AP Leaderboard", "monthly");

  console.log('Monthly leaderboard reset');

});

client.login(process.env.TOKEN);
