require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const CooldownManager = require('./src/utils/cooldown');
const AutonomousEngine = require('./src/dev/autonomousEngine');

function normalizeControlShape(control) {
  if (!control || typeof control !== 'object' || Array.isArray(control)) {
    logger.warn('control.json format tidak valid, fallback autonomous_mode=false');
    return { autonomous_mode: false };
  }

  if (typeof control.autonomous_mode !== 'boolean') {
    logger.warn('control.json.autonomous_mode bukan boolean, fallback autonomous_mode=false');
    return { ...control, autonomous_mode: false };
  }

  return control;
}

function readControl() {
  const controlPath = path.join(__dirname, 'control.json');
  try {
    const raw = fs.readFileSync(controlPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeControlShape(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      logger.warn('control.json tidak ditemukan, fallback autonomous_mode=false');
    } else {
      logger.error('control.json gagal dibaca/parse, fallback autonomous_mode=false', error);
    }
    return { autonomous_mode: false };
  }
}

function safeRequireModule(modulePath, label) {
  try {
    return require(modulePath);
  } catch (error) {
    logger.error(`Gagal load ${label}`, error);
    return null;
  }
}

function safeReadJsFiles(dirPath, label) {
  try {
    return fs.readdirSync(dirPath).filter((f) => f.endsWith('.js'));
  } catch (error) {
    logger.error(`Gagal membaca direktori ${label}`, error);
    return [];
  }
}

function loadCommands(client) {
  const commandsPath = path.join(__dirname, 'src', 'commands');
  const files = safeReadJsFiles(commandsPath, 'commands');
  const payload = [];
  const loadedNames = [];
  let loaded = 0;
  let skipped = 0;

  for (const file of files) {
    const commandPath = path.join(commandsPath, file);
    const command = safeRequireModule(commandPath, `command ${file}`);
    if (!command) {
      skipped += 1;
      continue;
    }
    if (!command.data?.name || typeof command.execute !== 'function') {
      skipped += 1;
      logger.warn(`Command ${file} dilewati karena format tidak valid`);
      continue;
    }

    const commandName = String(command.data.name).trim();
    if (!commandName) {
      skipped += 1;
      logger.warn(`Command ${file} dilewati karena nama command kosong`);
      continue;
    }
    if (client.commands.has(commandName)) {
      skipped += 1;
      logger.warn(`Command ${file} dilewati karena nama duplikat: ${commandName}`);
      continue;
    }

    client.commands.set(commandName, command);
    payload.push({ ...command.data, name: commandName });
    loadedNames.push(commandName);
    loaded += 1;
  }

  logger.info(`Command loader: loaded=${loaded} skipped=${skipped} total=${files.length}`);
  if (loadedNames.length > 0) {
    logger.info(`Command aktif: ${loadedNames.join(', ')}`);
  }
  return payload;
}

function loadEvents(client) {
  const eventsPath = path.join(__dirname, 'src', 'events');
  const files = safeReadJsFiles(eventsPath, 'events');
  const loadedNames = [];
  let loaded = 0;
  let skipped = 0;

  for (const file of files) {
    const eventPath = path.join(eventsPath, file);
    const event = safeRequireModule(eventPath, `event ${file}`);
    if (!event) {
      skipped += 1;
      continue;
    }
    if (!event.name || typeof event.execute !== 'function') {
      skipped += 1;
      logger.warn(`Event ${file} dilewati karena format tidak valid`);
      continue;
    }

    const handler = (...args) => {
      Promise.resolve()
        .then(() => event.execute(...args, client))
        .catch((error) => {
          logger.error(`Event handler gagal: ${event.name} (${file})`, error);
        });
    };

    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }
    loadedNames.push(`${event.name}${event.once ? '(once)' : ''}`);
    loaded += 1;
  }

  logger.info(`Event loader: loaded=${loaded} skipped=${skipped} total=${files.length}`);
  if (loadedNames.length > 0) {
    logger.info(`Event aktif: ${loadedNames.join(', ')}`);
  }
}

async function registerCommands(commandData) {
  if (!config.token || !config.clientId) {
    logger.warn('Lewati registrasi slash command (DISCORD_TOKEN/DISCORD_CLIENT_ID belum lengkap)');
    return false;
  }

  if (!Array.isArray(commandData) || commandData.length === 0) {
    logger.warn('Lewati registrasi slash command karena tidak ada command valid yang dimuat');
    return false;
  }

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commandData });
      logger.info(`Slash command terdaftar di guild (dev mode). total=${commandData.length}`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: commandData });
      logger.info(`Slash command terdaftar secara global. total=${commandData.length}`);
    }
    return true;
  } catch (error) {
    logger.error('Registrasi slash command gagal, lanjut startup tanpa hentikan bot', error);
    return false;
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
  const checkedCount = checks.length;
  const missingCount = missing.length;
  if (missingCount > 0) {
    logger.warn(
      `Autonomous check: missing=${missingCount}/${checkedCount} -> ${missing.join(', ')}`
    );
  } else {
    logger.info(`Autonomous check: baseline project stabil. checked=${checkedCount}`);
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

  const registerOk = await registerCommands(commandData);
  if (!registerOk) {
    logger.warn('Registrasi slash command tidak sepenuhnya berhasil; bot tetap melanjutkan proses login.');
  }

  if (!config.token) {
    logger.error('DISCORD_TOKEN belum diisi di environment.');
    return;
  }

  try {
    await client.login(config.token);
  } catch (error) {
    if (error?.code === 'TokenInvalid') {
      logger.error('Login Discord gagal: token tidak valid (TokenInvalid).');
    } else {
      logger.error('Login Discord gagal karena error tak terduga.', error);
    }
    throw error;
  }

  await runAutonomousIteration();
}

bootstrap().catch((error) => {
  logger.error('Gagal bootstrap bot', error);
  process.exit(1);
});
