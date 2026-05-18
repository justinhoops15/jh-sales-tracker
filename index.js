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

db.run(`CREATE TABLE IF NOT EXISTS leaderboard_messages (
  type TEXT PRIMARY KEY,
  message_id TEXT,
  channel_id TEXT
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

function getWeekRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() - 6);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const month = start.toLocaleString('en-US', { month: 'long' });
  return `${month} ${start.getDate()}-${end.getDate()}`;
}

function getMonthLabel() {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
  const month = lastMonth.toLocaleString('en-US', { month: 'long' });
  const year = lastMonth.getFullYear();
  return `${month} ${year}`;
}

async function getStoredMessageId(type) {
  return new Promise((resolve) => {
    db.get(
      `SELECT message_id FROM leaderboard_messages WHERE type = ?`,
      [type],
      (err, row) => {
        if (err) console.error(err);
        resolve(row ? row.message_id : null);
      }
    );
  });
}

function saveMessageId(type, messageId, channelId) {
  db.run(
    `INSERT OR REPLACE INTO leaderboard_messages (type, message_id, channel_id) VALUES (?, ?, ?)`,
    [type, messageId, channelId]
  );
}

async function updateLeaderboard(channelId, title, type) {
  const channel = await client.channels.fetch(channelId);
  let dateFilter;

  if (type === "weekly") {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(now.setDate(diff));
    start.setHours(0, 0, 0, 0);
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

      if (rows.length === 0) {
        message += "No sales yet this period.";
      } else {
        rows.slice(0, 10).forEach((row, index) => {
          if (index < 3) {
            message += `${medals[index]} ${row.agent} — $${row.total}\n`;
          } else {
            message += `${index + 1}. ${row.agent} — $${row.total}\n`;
          }
        });
      }

      try {
        const storedMessageId = await getStoredMessageId(type);
        let msg;

        if (storedMessageId) {
          try {
            msg = await channel.messages.fetch(storedMessageId);
            await msg.edit(message);
          } catch {
            msg = await channel.send(message);
            saveMessageId(type, msg.id, channelId);
          }
        } else {
          msg = await channel.send(message);
          saveMessageId(type, msg.id, channelId);
        }
      } catch (err) {
        console.error('Error updating leaderboard:', err);
      }
    }
  );
}

async function postFinalLeaderboard(channelId, title, type) {
  const channel = await client.channels.fetch(channelId);
  let startDate;
  let endDate = new Date();

  if (type === "weekly") {
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() - now.getDay());
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    startDate = start.toISOString();
    endDate = end.toISOString();
  }

  if (type === "monthly") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    startDate = start.toISOString();
    endDate = end.toISOString();
  }

  db.all(
    `SELECT agent, SUM(annual) as total
     FROM sales
     WHERE date BETWEEN ? AND ?
     GROUP BY agent
     ORDER BY total DESC`,
    [startDate, endDate],
    async (err, rows) => {
      if (err) return console.error(err);

      const medals = ["🥇", "🥈", "🥉"];
      let message = `📊 **${title}**\n\n`;

      if (rows.length === 0) {
        message += "No sales this period.";
      } else {
        rows.slice(0, 10).forEach((row, index) => {
          if (index < 3) {
            message += `${medals[index]} ${row.agent} — $${row.total}\n`;
          } else {
            message += `${index + 1}. ${row.agent} — $${row.total}\n`;
          }
        });
      }

      channel.send(message);
    }
  );
}

client.once('clientReady', async () => {
  console.log('Sales Tracker Bot is online');

  await rest.put(
    Routes.applicationCommands(client.user.id, "1325862542786039849"),
    { body: commands }
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
      [agent, monthly, annual, date],
      function(err) {
        if (err) return console.error(err);

        const saleId = this.lastID;

        updateLeaderboard(WEEKLY_CHANNEL, "Weekly Leaderboard", "weekly");
        updateLeaderboard(MONTHLY_CHANNEL, "Monthly AP Leaderboard", "monthly");

        const embed = new EmbedBuilder()
          .setColor(0xFFD700)
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

  if (interaction.commandName === 'delete') {
    const id = interaction.options.getInteger('id');

    db.get(`SELECT * FROM sales WHERE id = ?`, [id], (err, row) => {
      if (!row) {
        return interaction.reply({ content: 'Sale not found', ephemeral: true });
      }

      db.run(`DELETE FROM sales WHERE id = ?`, [id]);

      updateLeaderboard(WEEKLY_CHANNEL, "Weekly Leaderboard", "weekly");
      updateLeaderboard(MONTHLY_CHANNEL, "Monthly AP Leaderboard", "monthly");

      interaction.reply({ content: `Sale #${id} deleted`, ephemeral: true });
    });
  }
});

cron.schedule('0 0 * * 1', async () => {
  const weekRange = getWeekRange();
  console.log('Weekly reset starting...');

  await postFinalLeaderboard(WEEKLY_HISTORY, `Weekly Leaderboard (${weekRange})`, "weekly");
  db.run(`DELETE FROM leaderboard_messages WHERE type = ?`, ['weekly']);
  updateLeaderboard(WEEKLY_CHANNEL, "Weekly Leaderboard", "weekly");

  console.log('Weekly leaderboard reset');
});

cron.schedule('0 0 1 * *', async () => {
  const monthLabel = getMonthLabel();
  console.log('Monthly reset starting...');

  await postFinalLeaderboard(MONTHLY_HISTORY, `${monthLabel} Leaderboard`, "monthly");
  db.run(`DELETE FROM leaderboard_messages WHERE type = ?`, ['monthly']);
  updateLeaderboard(MONTHLY_CHANNEL, "Monthly AP Leaderboard", "monthly");

  console.log('Monthly leaderboard reset');
});

client.login(process.env.TOKEN);
