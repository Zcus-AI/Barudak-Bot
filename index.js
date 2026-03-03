require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const CooldownManager = require('./src/utils/cooldown');

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
  const startedAt = Date.now();
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
  logger.info(`Command loader duration: ${Date.now() - startedAt}ms`);
  return payload;
}

function loadEvents(client) {
  const startedAt = Date.now();
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
  logger.info(`Event loader duration: ${Date.now() - startedAt}ms`);
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

  const sanitized = commandData.filter((cmd) => cmd && typeof cmd === 'object' && cmd.name);
  const dropped = commandData.length - sanitized.length;
  if (dropped > 0) {
    logger.warn(`Registrasi slash command: ${dropped} payload invalid dilewati sebelum kirim ke Discord API`);
  }
  if (sanitized.length === 0) {
    logger.warn('Lewati registrasi slash command karena seluruh payload command invalid');
    return false;
  }

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: sanitized });
      logger.info(`Slash command terdaftar di guild (dev mode). total=${sanitized.length}`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: sanitized });
      logger.info(`Slash command terdaftar secara global. total=${sanitized.length}`);
    }
    return true;
  } catch (error) {
    logger.error('Registrasi slash command gagal, lanjut startup tanpa hentikan bot', error);
    return false;
  }
}

async function runAutonomousIteration() {
  const startedAt = Date.now();
  const control = readControl();
  if (!control.autonomous_mode) {
    logger.info('Autonomous mode OFF, dev loop dihentikan.');
    logger.info(`Autonomous check duration: ${Date.now() - startedAt}ms`);
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

  const elapsedMs = Date.now() - startedAt;
  logger.info(`Autonomous check duration: ${elapsedMs}ms`);
}

async function bootstrap() {
  const control = readControl();

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();
  client.cooldowns = new CooldownManager();

  let commandData = [];
  try {
    commandData = loadCommands(client);
  } catch (error) {
    logger.error('Gagal load commands saat bootstrap, lanjut dengan payload kosong.', error);
    commandData = [];
  }

  try {
    loadEvents(client);
  } catch (error) {
    logger.error('Gagal load events saat bootstrap, bot tetap lanjut startup.', error);
  }

  logger.info(`Bootstrap summary: command_payload=${commandData.length}`);
  logger.info(`Autonomous subsystem: ${control.autonomous_mode ? 'ON (health-check only from bot runtime)' : 'OFF'}`);

  process.on('unhandledRejection', (err) => logger.error('Unhandled Rejection', err));
  process.on('uncaughtException', (err) => logger.error('Uncaught Exception', err));

  logger.info(`Bootstrap context: guild_mode=${config.guildId ? 'guild' : 'global'} token_present=${Boolean(config.token)}`);
  const registerOk = await registerCommands(commandData);
  if (!registerOk) {
    logger.warn('Registrasi slash command tidak sepenuhnya berhasil; bot tetap melanjutkan proses login.');
  }

  if (!config.token) {
    logger.error('DISCORD_TOKEN belum diisi di environment.');
    return;
  }

  const loginStartedAt = Date.now();
  try {
    await client.login(config.token);
    const botTag = client.user?.tag || client.user?.id || 'unknown-bot';
    logger.info(`Login Discord sukses sebagai ${botTag} (${Date.now() - loginStartedAt}ms)`);
  } catch (error) {
    if (error?.code === 'TokenInvalid') {
      logger.error('Login Discord gagal: token tidak valid (TokenInvalid).');
    } else {
      logger.error('Login Discord gagal karena error tak terduga.', error);
    }
    throw error;
  }

  try {
    await runAutonomousIteration();
  } catch (error) {
    logger.error('Autonomous iteration gagal, bot tetap berjalan.', error);
  }
}

bootstrap().catch((error) => {
  logger.error('Gagal bootstrap bot', error);
  process.exit(1);
});
