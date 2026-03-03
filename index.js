const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const CooldownManager = require('./src/utils/cooldown');
const AutonomousEngine = require('./src/dev/autonomousEngine');

function readControl() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'control.json'), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    logger.warn('control.json tidak terbaca, fallback autonomous_mode=false');
    return { autonomous_mode: false };
  }
}

function loadCommands(client) {
  const commandsPath = path.join(__dirname, 'src', 'commands');
  const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
  const payload = [];

  for (const file of files) {
    const command = require(path.join(commandsPath, file));
    if (!command.data?.name || typeof command.execute !== 'function') {
      logger.warn(`Command ${file} dilewati karena format tidak valid`);
      continue;
    }
    client.commands.set(command.data.name, command);
    payload.push(command.data);
  }

  return payload;
}

function loadEvents(client) {
  const eventsPath = path.join(__dirname, 'src', 'events');
  const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const event = require(path.join(eventsPath, file));
    if (!event.name || typeof event.execute !== 'function') {
      logger.warn(`Event ${file} dilewati karena format tidak valid`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
  }
}

async function registerCommands(commandData) {
  if (!config.token || !config.clientId) {
    logger.warn('Lewati registrasi slash command (DISCORD_TOKEN/DISCORD_CLIENT_ID belum lengkap)');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.token);
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commandData });
    logger.info('Slash command terdaftar di guild (dev mode).');
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commandData });
    logger.info('Slash command terdaftar secara global.');
  }
}

async function runAutonomousIteration() {
  const control = readControl();
  if (!control.autonomous_mode) {
    logger.info('Autonomous mode OFF, dev loop dihentikan.');
    return;
  }

  const checks = [
    ['src/commands/ping.js', fs.existsSync(path.join(__dirname, 'src/commands/ping.js'))],
    ['src/commands/level.js', fs.existsSync(path.join(__dirname, 'src/commands/level.js'))],
    ['tests/cooldown.test.js', fs.existsSync(path.join(__dirname, 'tests/cooldown.test.js'))]
  ];

  const missing = checks.filter(([, ok]) => !ok).map(([file]) => file);
  if (missing.length > 0) {
    logger.warn(`Autonomous check: file penting belum ada -> ${missing.join(', ')}`);
  } else {
    logger.info('Autonomous check: baseline project stabil.');
  }
}

async function bootstrap() {
  const control = readControl();
  if (!control.autonomous_mode) {
    logger.warn('autonomous_mode=false, bot tidak dijalankan.');
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();
  client.cooldowns = new CooldownManager();
  client.autonomousEngine = new AutonomousEngine({
    controlPath: path.join(__dirname, 'control.json'),
    devLogPath: path.join(__dirname, 'dev_log.md'),
    iterationDelayMs: 60000
  });

  const commandData = loadCommands(client);
  loadEvents(client);

  process.on('unhandledRejection', (err) => logger.error('Unhandled Rejection', err));
  process.on('uncaughtException', (err) => logger.error('Uncaught Exception', err));

  await registerCommands(commandData);

  if (!config.token) {
    logger.error('DISCORD_TOKEN belum diisi di environment.');
    return;
  }

  await client.login(config.token);
  await runAutonomousIteration();
}

bootstrap().catch((error) => {
  logger.error('Gagal bootstrap bot', error);
  process.exit(1);
});
