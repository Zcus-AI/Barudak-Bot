export {};
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} = require('@discordjs/voice');
const dbStore = require('./store/db-store');
const execAsync = promisify(exec);

const NAME_LIST_FILE = path.join(process.cwd(), 'listname.json');
const DISCORD_MESSAGE_MAX = 2000;
const PAGINATION_TTL_MS = 10 * 60 * 1000;
const ENV_FILE = path.join(process.cwd(), '.env');

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile(ENV_FILE);

function parseEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

function parseEnvRange(minName, maxName, fallbackMin, fallbackMax) {
  let min = parseEnvInt(minName, fallbackMin);
  let max = parseEnvInt(maxName, fallbackMax);
  if (min > max) {
    const t = min;
    min = max;
    max = t;
  }
  return { min, max };
}

const JOIN_DELAY = parseEnvRange('JOIN_DELAY_MIN_MS', 'JOIN_DELAY_MAX_MS', 350, 1200);
const RETRY_DELAY = parseEnvRange('RETRY_DELAY_MIN_MS', 'RETRY_DELAY_MAX_MS', 500, 1200);
const JOIN_ATTEMPT_TIMEOUT_MS = parseEnvInt('JOIN_ATTEMPT_TIMEOUT_MS', 30_000);
const JOIN_QUEUE_MAX_ATTEMPTS = parseEnvInt('JOIN_QUEUE_MAX_ATTEMPTS', 3);

const controllerToken = process.env.CONTROLLER_TOKEN;
const controllerClientId = process.env.CONTROLLER_CLIENT_ID;
const globalCommands = String(process.env.GLOBAL_COMMANDS || 'false').toLowerCase() === 'true';
const alsoDeployGlobalCommands = String(process.env.ALSO_DEPLOY_GLOBAL_COMMANDS || 'false').toLowerCase() === 'true';
const clearCommandsBeforeDeploy = String(process.env.CLEAR_COMMANDS_BEFORE_DEPLOY || 'true').toLowerCase() === 'true';
const botStatusText = process.env.BOT_STATUS_TEXT || 'Made By Zcus_';
const monitorChannelId = process.env.MONITOR_CHANNEL_ID || '';
const monitorIntervalSec = parseEnvInt('MONITOR_INTERVAL_SEC', 60);
const monitorNetSampleSec = parseEnvInt('MONITOR_NET_SAMPLE_SEC', 5);
const autoRestoreVoiceOnBoot = String(process.env.AUTO_RESTORE_VOICE_ON_BOOT || 'false').toLowerCase() === 'true';
const verboseBackgroundLogs = String(process.env.VERBOSE_BACKGROUND_LOGS || 'false').toLowerCase() === 'true';
const managedBotInvitePerms =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.UseVAD;

if (!controllerToken || !controllerClientId) {
  console.error('Missing env. Required: CONTROLLER_TOKEN and CONTROLLER_CLIENT_ID');
  process.exit(1);
}

const db = { bots: [], monitor: {} as any };
let saveDataChain = Promise.resolve();

function saveData(data) {
  saveDataChain = saveDataChain
    .then(() => dbStore.saveAppData(data))
    .catch((error) => {
      console.error('Failed to save MySQL data:', error.message);
    });
  return saveDataChain;
}

function getMonitorConfig() {
  if (!db.monitor || typeof db.monitor !== 'object') {
    db.monitor = {};
  }
  return db.monitor;
}

function persistMonitorMessageId(messageId) {
  const monitor = getMonitorConfig();
  const nextId = messageId ? String(messageId) : null;
  const nextChannelId = monitorChannelId || null;
  if (monitor.messageId === nextId && monitor.channelId === nextChannelId) {
    return;
  }
  db.monitor = {
    ...monitor,
    channelId: nextChannelId,
    messageId: nextId,
  };
  saveData(db);
}

function normalizeBotsInPlace(data) {
  if (!Array.isArray(data?.bots)) {
    data.bots = [];
    return 0;
  }

  const seenIds = new Set();
  const seenTokens = new Set();
  const seenClientIds = new Set();
  const next = [];
  let removed = 0;

  for (const bot of data.bots) {
    if (!bot || typeof bot !== 'object') {
      removed += 1;
      continue;
    }

    const id = typeof bot.id === 'string' ? bot.id.trim() : '';
    const token = typeof bot.token === 'string' ? bot.token.trim() : '';
    const clientId = typeof bot.clientId === 'string' ? bot.clientId.trim() : '';
    const usernameTag = typeof bot.usernameTag === 'string' ? bot.usernameTag.trim() : '';
    if (!id || !token) {
      removed += 1;
      continue;
    }

    if (seenIds.has(id) || seenTokens.has(token) || (clientId && seenClientIds.has(clientId))) {
      removed += 1;
      continue;
    }

    seenIds.add(id);
    seenTokens.add(token);
    if (clientId) {
      seenClientIds.add(clientId);
    }

    const voiceStates = Array.isArray(bot.voiceStates)
      ? bot.voiceStates
          .filter((x) => {
            if (!x || typeof x.guildId !== 'string' || typeof x.channelId !== 'string') {
              return false;
            }
            return x.guildId.trim().length > 0 && x.channelId.trim().length > 0;
          })
          .map((x) => ({
            guildId: x.guildId.trim(),
            channelId: x.channelId.trim(),
            defend: Boolean(x.defend),
          }))
      : [];

    next.push({
      ...bot,
      id,
      token,
      clientId: clientId || null,
      usernameTag: usernameTag || null,
      voiceStates,
    });
  }

  data.bots = next;
  return removed;
}

async function initializeDataStore() {
  const loaded = await dbStore.loadAppData();
  db.bots = Array.isArray(loaded?.bots) ? loaded.bots : [];
  db.monitor = loaded?.monitor && typeof loaded.monitor === 'object' ? loaded.monitor : {};

  const removedDuplicateCount = normalizeBotsInPlace(db);
  if (removedDuplicateCount > 0) {
    await saveData(db);
    console.log(`[DB] removed ${removedDuplicateCount} duplicate/invalid bot entries (kept oldest).`);
  }
  if (!db.monitor || typeof db.monitor !== 'object') {
    db.monitor = {};
  }
  if (typeof db.monitor.messageId !== 'string' || !db.monitor.messageId.trim()) {
    db.monitor.messageId = null;
  }
  if (typeof db.monitor.channelId !== 'string' || !db.monitor.channelId.trim()) {
    db.monitor.channelId = null;
  }
  if (db.monitor.channelId !== (monitorChannelId || null)) {
    db.monitor.channelId = monitorChannelId || null;
    db.monitor.messageId = null;
    await saveData(db);
  }
}
const managedBots = new Map();
const paginationSessions = new Map();
let monitorState = null;

function applyBotPresence(client) {
  if (!client?.user) {
    return;
  }
  client.user.setPresence({
    status: 'online',
    activities: [{ name: botStatusText, type: ActivityType.Playing }],
  });
}

function getBotConfig(botId) {
  return db.bots.find((x) => x.id === botId);
}

function upsertBotConfig(item) {
  const idx = db.bots.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    db.bots[idx] = item;
  } else {
    db.bots.push(item);
  }
  const removed = normalizeBotsInPlace(db);
  if (removed > 0) {
    console.log(`[DB] removed ${removed} duplicate bot entries after update (kept oldest).`);
  }
  saveData(db);
}

function removeBotConfig(botId) {
  db.bots = db.bots.filter((x) => x.id !== botId);
  saveData(db);
}

function getConfigVoiceStates(config) {
  if (!Array.isArray(config?.voiceStates)) {
    return [];
  }
  return config.voiceStates
    .filter((x) => {
      if (!x || typeof x.guildId !== 'string' || typeof x.channelId !== 'string') {
        return false;
      }
      return x.guildId.trim().length > 0 && x.channelId.trim().length > 0;
    })
    .map((x) => ({
      guildId: x.guildId.trim(),
      channelId: x.channelId.trim(),
      defend: Boolean(x.defend),
    }));
}

function getBotOrderNumber(config) {
  const source = String(config?.usernameTag || config?.label || '');
  const match = source.match(/(\d+)/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(match[1]);
}

function compareBotConfigOrder(a, b) {
  const na = getBotOrderNumber(a);
  const nb = getBotOrderNumber(b);
  if (na !== nb) {
    return na - nb;
  }
  return String(a.id).localeCompare(String(b.id));
}

function getOrderedBotConfigs(list) {
  return [...list].sort(compareBotConfigOrder);
}

function formatBotName(config) {
  return `${config.label || '-'} (\`${config.id}\`)`;
}

function normalizeLabelValue(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed || null;
}

function normalizeLabelKey(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isSpecialistLabel(label) {
  return /\bspesialis\b/i.test(String(label || ''));
}

function findDuplicateLabel(label, excludeId = null) {
  const key = normalizeLabelKey(label);
  if (!key) {
    return null;
  }
  return db.bots.find((bot) => bot.id !== excludeId && normalizeLabelKey(bot.label) === key) || null;
}

function validateBotLabel(label, excludeId = null) {
  const normalized = normalizeLabelValue(label);
  if (!normalized) {
    return 'Nama bot wajib diisi.';
  }
  if (!isSpecialistLabel(normalized)) {
    return 'Nama bot wajib mengandung kata "Spesialis".';
  }
  const duplicate = findDuplicateLabel(normalized, excludeId);
  if (duplicate) {
    return `Nama bot sudah dipakai bot lain (ID: \`${duplicate.id}\`).`;
  }
  return null;
}

function loadSpecialistNames() {
  try {
    const raw = fs.readFileSync(NAME_LIST_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed?.names)
      ? parsed.names
      : Array.isArray(parsed?.doctor)
      ? parsed.doctor
      : null;
    if (!Array.isArray(source)) {
      return [];
    }
    return source
      .map((x) => normalizeLabelValue(x))
      .filter((x) => x && isSpecialistLabel(x));
  } catch (_error) {
    return [];
  }
}

function isDoctorKeyword(value) {
  const n = String(value || '').trim().toLowerCase();
  return n === 'doctor' || n === 'dokter';
}

function getSetnameTargets(selector) {
  const raw = String(selector || '').trim();
  const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return { error: 'Format range tidak valid. Contoh: `1-5`.' };
    }
    const ordered = getOrderedBotConfigs(db.bots);
    if (end > ordered.length) {
      return { error: `Range melebihi jumlah bot. Maksimal: ${ordered.length}.` };
    }
    const picked = ordered.slice(start - 1, end).map((config, idx) => ({
      config,
      ordinal: start + idx,
    }));
    return { isRange: true, targets: picked };
  }

  const config = getBotConfig(raw);
  if (!config) {
    return { error: `Bot ID \`${raw}\` tidak ditemukan.` };
  }
  return { isRange: false, targets: [{ config, ordinal: null }] };
}

function inferZcusLabelFromTag(tag) {
  const match = String(tag || '').match(/\b(Zcus\s+\d+)\b/i);
  return match ? match[1] : null;
}

function botDisplayNameById(botId) {
  const cfg = getBotConfig(botId);
  if (!cfg) {
    return botId;
  }
  return cfg.label || cfg.id;
}

async function isClientInGuild(client, guildId) {
  if (client.guilds.cache.has(guildId)) {
    return true;
  }
  try {
    await client.guilds.fetch(guildId);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeImageUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error('Link gambar wajib diisi.');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error('Link gambar tidak valid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Link gambar harus http/https.');
  }
  return parsed.toString();
}

async function setAvatarByToken(token, imageUrl) {
  const tmp = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await tmp.login(token);
    if (!tmp.user) {
      throw new Error('User bot tidak tersedia');
    }
    await tmp.user.setAvatar(imageUrl);
  } finally {
    tmp.destroy();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runBackgroundTask(name, task) {
  setImmediate(() => {
    void task().catch((error) => {
      console.error(`[BG:${name}]`, error?.message || String(error));
    });
  });
}

function bgLog(...args) {
  if (verboseBackgroundLogs) {
    console.log(...args);
  }
}

function isUnknownInteractionError(error) {
  const code = Number(error?.code || error?.rawError?.code || 0);
  const msg = String(error?.message || '').toLowerCase();
  return code === 10062 || msg.includes('unknown interaction');
}

function isInteractionAlreadyAcknowledgedError(error) {
  const code = Number(error?.code || error?.rawError?.code || 0);
  return code === 40060;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n.toFixed(0)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

async function getWindowsNetTotals() {
  const cmd =
    "$stats=Get-NetAdapterStatistics | Where-Object { $_.Name -notmatch 'Loopback|Teredo|isatap' }; " +
    "$rx=($stats|Measure-Object -Property ReceivedBytes -Sum).Sum; " +
    "$tx=($stats|Measure-Object -Property SentBytes -Sum).Sum; " +
    "if($null -eq $rx){$rx=0}; if($null -eq $tx){$tx=0}; Write-Output \"$rx,$tx\"";
  const { stdout } = await execAsync(`powershell -NoProfile -Command "${cmd}"`, { timeout: 7000 });
  const raw = stdout.trim().split(/\r?\n/).pop() || '0,0';
  const [rxStr, txStr] = raw.split(',');
  return {
    rx: Number(rxStr) || 0,
    tx: Number(txStr) || 0,
  };
}

async function getLinuxNetTotals() {
  const text = fs.readFileSync('/proc/net/dev', 'utf8');
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n').slice(2)) {
    const row = line.trim();
    if (!row) continue;
    const [iface, rest] = row.split(':');
    if (!rest) continue;
    const name = iface.trim();
    if (name === 'lo') continue;
    const cols = rest.trim().split(/\s+/);
    rx += Number(cols[0]) || 0;
    tx += Number(cols[8]) || 0;
  }
  return { rx, tx };
}

async function getNetTotals() {
  if (process.platform === 'win32') {
    return getWindowsNetTotals();
  }
  if (process.platform === 'linux') {
    return getLinuxNetTotals();
  }
  return { rx: 0, tx: 0 };
}

function buildMonitorEmbed(sample) {
  return new EmbedBuilder()
    .setTitle('System Monitor')
    .setColor(0x00b894)
    .addFields(
      { name: 'Process CPU', value: `${sample.procCpuPercent.toFixed(2)}%`, inline: true },
      { name: 'Process RAM (RSS)', value: formatBytes(sample.rssBytes), inline: true },
      { name: 'Heap', value: `${formatBytes(sample.heapUsedBytes)} / ${formatBytes(sample.heapTotalBytes)}`, inline: true },
      { name: 'Host Net In', value: `${formatBytes(sample.rxPerSec)}/s`, inline: true },
      { name: 'Host Net Out', value: `${formatBytes(sample.txPerSec)}/s`, inline: true },
      { name: 'Uptime', value: `${Math.floor(sample.uptimeSec)}s`, inline: true }
    )
    .setFooter({ text: `Updated ${new Date().toLocaleTimeString()}` })
    .setTimestamp();
}

async function runMonitorTick() {
  if (!monitorChannelId || !controller.isReady()) {
    return;
  }

  const nowMs = Date.now();
  const cpuNow = process.cpuUsage();
  const mem = process.memoryUsage();

  if (!monitorState) {
    const netNowInit = await getNetTotals().catch(() => ({ rx: 0, tx: 0 }));
    monitorState = {
      lastMs: nowMs,
      lastCpu: cpuNow,
      lastNet: netNowInit,
      lastNetSampleMs: nowMs,
      lastRxPerSec: 0,
      lastTxPerSec: 0,
      messageId: db.monitor?.messageId || null,
      channel: null,
      message: null,
      busy: false,
    };
  }

  if (monitorState.busy) {
    return;
  }
  monitorState.busy = true;
  try {
    const elapsedMs = Math.max(1, nowMs - monitorState.lastMs);
    const elapsedMicros = elapsedMs * 1000;
    const cpuDeltaMicros =
      (cpuNow.user - monitorState.lastCpu.user) + (cpuNow.system - monitorState.lastCpu.system);
    const procCpuPercent = (cpuDeltaMicros / elapsedMicros) * 100;

    let rxPerSec = monitorState.lastRxPerSec || 0;
    let txPerSec = monitorState.lastTxPerSec || 0;
    const needNetSample =
      nowMs - (monitorState.lastNetSampleMs || 0) >= Math.max(1, monitorNetSampleSec) * 1000;
    if (needNetSample) {
      const netNow = await getNetTotals();
      const netElapsedSec = Math.max(0.001, (nowMs - monitorState.lastNetSampleMs) / 1000);
      const rxDelta = Math.max(0, netNow.rx - monitorState.lastNet.rx);
      const txDelta = Math.max(0, netNow.tx - monitorState.lastNet.tx);
      rxPerSec = rxDelta / netElapsedSec;
      txPerSec = txDelta / netElapsedSec;
      monitorState.lastNet = netNow;
      monitorState.lastNetSampleMs = nowMs;
      monitorState.lastRxPerSec = rxPerSec;
      monitorState.lastTxPerSec = txPerSec;
    }

    const sample = {
      procCpuPercent,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      rxPerSec,
      txPerSec,
      uptimeSec: process.uptime(),
    };

    const embed = buildMonitorEmbed(sample);
    if (!monitorState.channel) {
      monitorState.channel = await controller.channels.fetch(monitorChannelId).catch(() => null);
    }
    const channel = monitorState.channel;
    if (!channel || !channel.isTextBased()) {
      return;
    }

    if (monitorState.messageId) {
      if (!monitorState.message || monitorState.message.id !== monitorState.messageId) {
        monitorState.message = await channel.messages.fetch(monitorState.messageId).catch(() => null);
      }
      const oldMsg = monitorState.message;
      if (oldMsg) {
        await oldMsg.edit({ embeds: [embed], content: '' });
      } else {
        const msg = await channel.send({ embeds: [embed] });
        monitorState.messageId = msg.id;
        monitorState.message = msg;
        persistMonitorMessageId(msg.id);
      }
    } else {
      const msg = await channel.send({ embeds: [embed] });
      monitorState.messageId = msg.id;
      monitorState.message = msg;
      persistMonitorMessageId(msg.id);
    }
  } catch (error) {
    console.error('[MONITOR] tick failed:', error.message);
  } finally {
    monitorState.lastMs = nowMs;
    monitorState.lastCpu = cpuNow;
    monitorState.busy = false;
  }
}

function isRetriableVoiceError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('operation was aborted') ||
    msg.includes('aborted') ||
    msg.includes('timed out') ||
    msg.includes('connection not established')
  );
}

function splitMessageChunks(text, maxLen = DISCORD_MESSAGE_MAX) {
  const source = String(text || '');
  if (source.length <= maxLen) {
    return [source];
  }

  const lines = source.split('\n');
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of lines) {
    if (line.length > maxLen) {
      flush();
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }

    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen) {
      flush();
      current = line;
    } else {
      current = next;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [''];
}

async function sendLongInteraction(interaction, content, alreadyDeferred = false) {
  const chunks = splitMessageChunks(content);
  try {
    if (alreadyDeferred || interaction.deferred || interaction.replied) {
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i += 1) {
        await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
      }
      return;
    }

    await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
    for (let i = 1; i < chunks.length; i += 1) {
      await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    if (isUnknownInteractionError(error) || isInteractionAlreadyAcknowledgedError(error)) {
      bgLog(`[INTERACTION] dropped response: ${error.message}`);
      return;
    }
    throw error;
  }
}

function createPaginationComponents(sessionId, index, total) {
  const prev = new ButtonBuilder()
    .setCustomId(`page:prev:${sessionId}`)
    .setLabel('Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(index <= 0);
  const next = new ButtonBuilder()
    .setCustomId(`page:next:${sessionId}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(index >= total - 1);
  return [new ActionRowBuilder().addComponents(prev, next)];
}

function getPageContent(chunk, index, total) {
  if (total <= 1) {
    return chunk;
  }
  const footer = `\n\nPage ${index + 1}/${total}`;
  if (chunk.length + footer.length <= DISCORD_MESSAGE_MAX) {
    return `${chunk}${footer}`;
  }
  return `${chunk.slice(0, DISCORD_MESSAGE_MAX - footer.length)}${footer}`;
}

async function sendPaginatedInteraction(interaction, content, alreadyDeferred = false) {
  const chunks = splitMessageChunks(content, 1850);
  if (chunks.length <= 1) {
    await sendLongInteraction(interaction, content, alreadyDeferred);
    return;
  }

  const sessionId = crypto.randomUUID().slice(0, 12);
  paginationSessions.set(sessionId, {
    ownerId: interaction.user.id,
    chunks,
    index: 0,
    expiresAt: Date.now() + PAGINATION_TTL_MS,
  });

  const payload = {
    content: getPageContent(chunks[0], 0, chunks.length),
    components: createPaginationComponents(sessionId, 0, chunks.length),
    flags: MessageFlags.Ephemeral,
  };
  try {
    if (alreadyDeferred || interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    await interaction.reply(payload);
  } catch (error) {
    if (isUnknownInteractionError(error) || isInteractionAlreadyAcknowledgedError(error)) {
      bgLog(`[INTERACTION] dropped paginated response: ${error.message}`);
      return;
    }
    throw error;
  }
}

function persistBotVoiceStates(botId) {
  const entry = managedBots.get(botId);
  const config = getBotConfig(botId);
  if (!entry || !config) {
    return;
  }

  const voiceStates = Array.from(entry.voiceByGuild.entries()).map(([guildId, state]) => ({
    guildId,
    channelId: state.channelId,
    defend: Boolean(state.defend),
  }));
  upsertBotConfig({ ...config, voiceStates });
}

function removePersistedVoiceState(botId, guildId, channelId) {
  const config = getBotConfig(botId);
  if (!config) {
    return;
  }
  const next = getConfigVoiceStates(config).filter((x) => !(x.guildId === guildId && x.channelId === channelId));
  upsertBotConfig({ ...config, voiceStates: next });
}

async function waitForManagedBotReady(entry, timeoutMs = 20_000) {
  if (entry.client.isReady()) {
    return;
  }

  await Promise.race([
    once(entry.client, Events.ClientReady),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Managed bot ready timeout')), timeoutMs);
    }),
  ]);
}

async function restoreBotVoiceStates(botId) {
  const config = getBotConfig(botId);
  if (!config) {
    return;
  }

  const states = getConfigVoiceStates(config);
  if (states.length === 0) {
    return;
  }

  for (let i = 0; i < states.length; i += 1) {
    const state = states[i];
    if (i > 0) {
      await sleep(randomInt(JOIN_DELAY.min, JOIN_DELAY.max));
    }
    try {
      await joinBotVoiceWithRetry(botId, state.guildId, state.channelId, state.defend, 2);
      bgLog(`[BOT ${botId}] restored voice guild:${state.guildId} channel:${state.channelId}`);
    } catch (error) {
      const message = String(error?.message || error || 'Unknown error');
      if (
        message === 'Voice channel not found' ||
        message === 'Managed bot is not in this guild' ||
        message === 'Target channel must be voice/stage'
      ) {
        removePersistedVoiceState(botId, state.guildId, state.channelId);
      }
      bgLog(`[BOT ${botId}] restore voice failed guild:${state.guildId} channel:${state.channelId}: ${message}`);
    }
  }
}

async function startManagedBot(config) {
  if (managedBots.has(config.id)) {
    return managedBots.get(config.id);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const entry = {
    id: config.id,
    label: config.label,
    token: config.token,
    clientId: config.clientId || null,
    usernameTag: config.usernameTag || null,
    client,
    voiceByGuild: new Map(),
  };

  client.on(Events.VoiceStateUpdate, async (_oldState, newState) => {
    if (!client.user || newState.id !== client.user.id) {
      return;
    }

    const target = entry.voiceByGuild.get(newState.guild.id);
    if (!target) {
      return;
    }

    if (!target.defend && !newState.channelId) {
      entry.voiceByGuild.delete(newState.guild.id);
      persistBotVoiceStates(config.id);
      return;
    }

    if (!target.defend) {
      return;
    }

    if (newState.channelId === target.channelId) {
      return;
    }

    setTimeout(async () => {
      try {
        await joinBotVoice(config.id, newState.guild.id, target.channelId, target.defend);
        bgLog(`[BOT ${config.id}] defend rejoin success in guild ${newState.guild.id}`);
      } catch (error) {
        bgLog(`[BOT ${config.id}] defend rejoin failed in guild ${newState.guild.id}: ${error.message}`);
      }
    }, randomInt(JOIN_DELAY.min, JOIN_DELAY.max));
  });

  try {
    await client.login(config.token);
    applyBotPresence(client);
    entry.clientId = client.user?.id || entry.clientId;
    entry.usernameTag = client.user?.tag || entry.usernameTag;
    const stored = getBotConfig(config.id);
    if (stored && (stored.clientId !== entry.clientId || stored.usernameTag !== entry.usernameTag)) {
      upsertBotConfig({ ...stored, clientId: entry.clientId, usernameTag: entry.usernameTag });
    }
    const inferredLabel = inferZcusLabelFromTag(client.user?.tag);
    if (inferredLabel && !entry.label) {
      entry.label = inferredLabel;
      if (stored && !stored.label) {
        upsertBotConfig({ ...stored, label: inferredLabel, clientId: entry.clientId, usernameTag: entry.usernameTag });
      }
    }
    managedBots.set(config.id, entry);
    return entry;
  } catch (error) {
    client.destroy();
    throw error;
  }
}

async function stopManagedBot(botId) {
  const entry = managedBots.get(botId);
  if (!entry) {
    return;
  }

  for (const targetGuild of entry.voiceByGuild.keys()) {
    const conn = getVoiceConnection(targetGuild, botId);
    conn?.destroy();
  }
  entry.voiceByGuild.clear();

  entry.client.destroy();
  managedBots.delete(botId);
}

async function joinBotVoice(botId, guildIdValue, channelId, defend = true) {
  const entry = managedBots.get(botId);
  if (!entry) {
    throw new Error('Bot not running');
  }

  await waitForManagedBotReady(entry);

  let guild = entry.client.guilds.cache.get(guildIdValue);
  if (!guild) {
    try {
      guild = await entry.client.guilds.fetch(guildIdValue);
    } catch (_error) {
      // ignore fetch error and keep unified message
    }
  }
  if (!guild) {
    throw new Error('Managed bot is not in this guild');
  }

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(channelId);
    } catch (_error) {
      // ignore fetch error and keep unified message
    }
  }
  if (!channel) {
    throw new Error('Voice channel not found');
  }

  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new Error('Target channel must be voice/stage');
  }

  const connection = joinVoiceChannel({
    guildId: guildIdValue,
    channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
    group: botId,
  });

  connection.on('stateChange', async (_oldState, newState) => {
    const current = entry.voiceByGuild.get(guildIdValue);
    if (newState.status === VoiceConnectionStatus.Disconnected && current?.defend) {
      setTimeout(async () => {
        try {
          const latest = entry.voiceByGuild.get(guildIdValue);
          if (!latest || !latest.defend) {
            return;
          }
          await joinBotVoice(botId, guildIdValue, latest.channelId, true);
        } catch (error) {
          bgLog(`[BOT ${botId}] reconnect from disconnect failed: ${error.message}`);
        }
      }, randomInt(JOIN_DELAY.min, JOIN_DELAY.max));
    }
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  entry.voiceByGuild.set(guildIdValue, {
    channelId,
    defend: Boolean(defend),
  });
  persistBotVoiceStates(botId);
}

async function joinBotVoiceWithRetry(botId, guildIdValue, channelId, defend, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await joinBotVoice(botId, guildIdValue, channelId, defend);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableVoiceError(error) || attempt === maxAttempts) {
        throw error;
      }
      const base = randomInt(RETRY_DELAY.min, RETRY_DELAY.max);
      await sleep(base * attempt);
    }
  }
  throw lastError || new Error('Join voice failed');
}

function leaveBotVoice(botId, guildIdValue) {
  const entry = managedBots.get(botId);
  if (!entry) {
    throw new Error('Bot not running');
  }

  const targetGuild = guildIdValue;
  if (!targetGuild) {
    return false;
  }

  const conn = getVoiceConnection(targetGuild, botId);
  if (conn) {
    conn.destroy();
  }

  entry.voiceByGuild.delete(targetGuild);
  persistBotVoiceStates(botId);

  return Boolean(conn);
}

function parseInviteCode(raw) {
  const value = raw.trim();
  const match = value.match(/(?:discord\.gg\/|discord\.com\/invite\/)?([A-Za-z0-9-]{2,})/i);
  if (!match) {
    throw new Error('Format invite code tidak valid');
  }
  return match[1];
}

async function resolveGuildFromInvite(rawCode) {
  const code = parseInviteCode(rawCode);
  const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=false&with_expiration=false`);
  if (!res.ok) {
    throw new Error('Invite code tidak valid/expired');
  }
  const data = await res.json();
  if (!data.guild?.id) {
    throw new Error('Invite tidak mengarah ke guild');
  }
  return { guildId: data.guild.id, guildName: data.guild.name || data.guild.id, code };
}

function makeBotInviteUrl(clientId, guildId) {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot',
    guild_id: guildId,
    disable_guild_select: 'true',
    permissions: String(managedBotInvitePerms),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

const commands = [
  new SlashCommandBuilder()
    .setName('addbot')
    .setDescription('Tambah bot token baru')
    .addStringOption((option) => option.setName('token').setDescription('Token bot').setRequired(true))
    .addStringOption((option) =>
      option.setName('label').setDescription('Nama bot (wajib, harus ada kata Spesialis)').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('listbot')
    .setDescription('Lihat daftar bot terdaftar')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('delbot')
    .setDescription('Hapus bot')
    .addStringOption((option) => option.setName('id').setDescription('ID bot').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('editbot')
    .setDescription('Ubah token/label bot')
    .addStringOption((option) => option.setName('id').setDescription('ID bot').setRequired(true))
    .addStringOption((option) => option.setName('token').setDescription('Token baru'))
    .addStringOption((option) => option.setName('label').setDescription('Label baru'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('setname')
    .setDescription('Ubah nickname bot di server ini')
    .addStringOption((option) =>
      option.setName('id').setDescription('ID bot atau range urutan, contoh: 1-5').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('name').setDescription('Nickname baru (wajib ada kata Spesialis)').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('setprofile')
    .setDescription('Ubah avatar/profile bot dari link gambar')
    .addStringOption((option) =>
      option.setName('id').setDescription('ID bot atau range urutan, contoh: 1-5').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('image').setDescription('Link gambar avatar (http/https)').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Suruh bot join voice')
    .addStringOption((option) => option.setName('id').setDescription('ID bot (opsional jika bot cuma 1)'))
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Voice channel target')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    )
    .addBooleanOption((option) =>
      option.setName('defend').setDescription('Auto rejoin kalau dipindah/disconnect (default: true)')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Pindahkan bot ke voice channel lain (instant, tanpa queue)')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Voice channel tujuan')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    )
    .addStringOption((option) => option.setName('id').setDescription('ID bot (opsional, kosong = semua bot)'))
    .addBooleanOption((option) =>
      option.setName('defend').setDescription('Auto rejoin kalau dipindah/disconnect (default: true)')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Suruh bot leave voice')
    .addStringOption((option) => option.setName('id').setDescription('ID bot (opsional, kosong = semua bot)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Generate link invite bot ke guild dari invite code')
    .addStringOption((option) =>
      option.setName('code').setDescription('Invite code / link Discord').setRequired(true)
    )
    .addStringOption((option) => option.setName('id').setDescription('ID bot tertentu (opsional)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('synccommands')
    .setDescription('Clear lalu register ulang slash commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((x) => x.toJSON());

async function putCommandsWithOptionalClear(rest, route, scopeLabel) {
  if (clearCommandsBeforeDeploy) {
    await rest.put(route, { body: [] });
    console.log(`Slash commands cleared on ${scopeLabel}`);
  }
  await rest.put(route, { body: commands });
  console.log(`Slash commands deployed on ${scopeLabel}`);
}

async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(controllerToken);
  if (globalCommands) {
    await putCommandsWithOptionalClear(
      rest,
      Routes.applicationCommands(controllerClientId),
      'global scope (can take up to 1 hour)'
    );
    return;
  }

  const ids = [...controller.guilds.cache.keys()];
  if (ids.length === 0) {
    console.log('No guilds found for controller bot. Skip command deploy.');
    return;
  }

  for (const oneGuildId of ids) {
    await putCommandsWithOptionalClear(
      rest,
      Routes.applicationGuildCommands(controllerClientId, oneGuildId),
      `guild ${oneGuildId}`
    );
  }

  if (alsoDeployGlobalCommands) {
    await putCommandsWithOptionalClear(
      rest,
      Routes.applicationCommands(controllerClientId),
      'global scope for profile visibility (can take up to 1 hour)'
    );
  } else if (clearCommandsBeforeDeploy) {
    await rest.put(Routes.applicationCommands(controllerClientId), { body: [] });
    console.log('Global slash commands cleared to prevent duplicate entries in guild command list');
  }
}

async function deployCommandsToGuild(oneGuildId) {
  const rest = new REST({ version: '10' }).setToken(controllerToken);
  await putCommandsWithOptionalClear(
    rest,
    Routes.applicationGuildCommands(controllerClientId, oneGuildId),
    `new guild ${oneGuildId}`
  );
}

const controller = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

controller.on(Events.GuildCreate, async (guild) => {
  if (globalCommands) {
    return;
  }
  try {
    await deployCommandsToGuild(guild.id);
  } catch (error) {
    console.error(`Failed to deploy commands for new guild ${guild.id}:`, error.message);
  }
});

controller.on(Events.ClientReady, async () => {
  console.log(`[CTRL] ready as ${controller.user?.tag}`);
  applyBotPresence(controller);
  if (monitorChannelId) {
    setInterval(() => {
      void runMonitorTick();
    }, Math.max(1, monitorIntervalSec) * 1000).unref();
    void runMonitorTick();
  }

  try {
    await deployCommands();
  } catch (error) {
    console.error('Failed to deploy slash commands:', error);
  }

  runBackgroundTask('managed-bot-boot', async () => {
    const bootResults = await Promise.all(
      db.bots.map(async (config) => {
        try {
          const entry = await startManagedBot(config);
          if (
            (entry?.clientId && config.clientId !== entry.clientId) ||
            (entry?.usernameTag && config.usernameTag !== entry.usernameTag)
          ) {
            upsertBotConfig({
              ...config,
              clientId: entry.clientId,
              usernameTag: entry.usernameTag || config.usernameTag || null,
              voiceStates: getConfigVoiceStates(config),
            });
          }
          return {
            ok: true,
            config,
            tag: entry?.client.user?.tag || 'unknown',
          };
        } catch (error) {
          return {
            ok: false,
            config,
            error: error?.message || String(error),
          };
        }
      })
    );

    const ordered = [...bootResults].sort((a, b) => compareBotConfigOrder(a.config, b.config));
    for (const result of ordered) {
      if (result.ok) {
        const inferred = inferZcusLabelFromTag(result.tag);
        const display = result.config.label || inferred || result.tag;
        console.log(`[BOOT] ready ${display} | id:${result.config.id} | user:${result.tag}`);
        if (autoRestoreVoiceOnBoot) {
          await restoreBotVoiceStates(result.config.id);
          await sleep(randomInt(JOIN_DELAY.min, JOIN_DELAY.max));
        }
      } else {
        console.error(
          `[BOOT] failed ${result.config.label || result.config.id} | id:${result.config.id}: ${result.error}`
        );
      }
    }
  });
});

controller.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('page:')) {
    const [, action, sessionId] = interaction.customId.split(':');
    const session = paginationSessions.get(sessionId);
    if (!session || Date.now() > session.expiresAt) {
      paginationSessions.delete(sessionId);
      await interaction.reply({ content: 'Halaman sudah expired.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.user.id !== session.ownerId) {
      await interaction.reply({ content: 'Tombol ini bukan untuk kamu.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === 'next') {
      session.index = Math.min(session.index + 1, session.chunks.length - 1);
    } else if (action === 'prev') {
      session.index = Math.max(session.index - 1, 0);
    }

    session.expiresAt = Date.now() + PAGINATION_TTL_MS;
    await interaction.update({
      content: getPageContent(session.chunks[session.index], session.index, session.chunks.length),
      components: createPaginationComponents(sessionId, session.index, session.chunks.length),
    });
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const cmd = interaction.commandName;

  try {
    if (cmd === 'addbot') {
      const token = interaction.options.getString('token', true).trim();
      const label = normalizeLabelValue(interaction.options.getString('label', true));
      const labelError = validateBotLabel(label);
      if (labelError) {
        await interaction.reply({ content: labelError, flags: MessageFlags.Ephemeral });
        return;
      }
      const id = crypto.randomUUID().slice(0, 8);
      const config: any = { id, token, label };

      const started = await startManagedBot(config);
      if (started?.clientId) {
        config.clientId = started.clientId;
      }
      config.usernameTag = started?.client?.user?.tag || null;
      upsertBotConfig(config);
      const username = started?.client.user?.tag || 'unknown';
      await interaction.reply({
        content: `Bot ditambah. ID: \`${id}\` | User: **${username}**${label ? ` | Label: ${label}` : ''}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (cmd === 'listbot') {
      if (db.bots.length === 0) {
        await interaction.reply({ content: 'Belum ada bot terdaftar.', flags: MessageFlags.Ephemeral });
        return;
      }

      const orderedConfigs = getOrderedBotConfigs(db.bots);
      const lines = orderedConfigs.map((config, index) => {
        const running = managedBots.get(config.id);
        const tag = running?.client.user?.tag || config.usernameTag || 'not-ready';
        const voice = running
          ? Array.from(running.voiceByGuild.entries())
              .map(([gid, state]) => `guild:${gid} voice:${state.channelId} defend:${state.defend}`)
              .join(' || ') || 'voice:-'
          : 'voice:-';
        return `#${index + 1} | ID: \`${config.id}\` | Label: ${config.label || '-'} | User: ${tag} | ${voice}`;
      });

      await sendPaginatedInteraction(interaction, lines.join('\n'));
      return;
    }

    if (cmd === 'delbot') {
      const id = interaction.options.getString('id', true);
      const config = getBotConfig(id);
      if (!config) {
        await interaction.reply({ content: `Bot ID \`${id}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
        return;
      }

      await stopManagedBot(id);
      removeBotConfig(id);
      await interaction.reply({ content: `Bot \`${id}\` dihapus.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (cmd === 'editbot') {
      const id = interaction.options.getString('id', true);
      const newToken = interaction.options.getString('token');
      const newLabel = interaction.options.getString('label');
      const config = getBotConfig(id);

      if (!config) {
        await interaction.reply({ content: `Bot ID \`${id}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (!newToken && newLabel === null) {
        await interaction.reply({ content: 'Isi minimal salah satu: token atau label.', flags: MessageFlags.Ephemeral });
        return;
      }

      const finalLabel = newLabel !== null ? normalizeLabelValue(newLabel) : config.label;
      const labelError = validateBotLabel(finalLabel, id);
      if (labelError) {
        await interaction.reply({ content: labelError, flags: MessageFlags.Ephemeral });
        return;
      }

      const updated = {
        ...config,
        token: newToken ? newToken.trim() : config.token,
        label: finalLabel,
        usernameTag: config.usernameTag || null,
      };

      await stopManagedBot(id);
      const entry = await startManagedBot(updated);
      if (entry?.clientId) {
        updated.clientId = entry.clientId;
      }
      updated.usernameTag = entry?.client?.user?.tag || updated.usernameTag || null;
      upsertBotConfig(updated);
      runBackgroundTask(`editbot-restore:${id}`, async () => {
        await restoreBotVoiceStates(id);
      });

      await interaction.reply({ content: `Bot \`${id}\` berhasil diupdate.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (cmd === 'join') {
      const id = interaction.options.getString('id');
      const defend = interaction.options.getBoolean('defend') ?? true;
      const channelOption = interaction.options.getChannel('channel');
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Command ini hanya bisa dipakai di server (bukan DM).', flags: MessageFlags.Ephemeral });
        return;
      }

      let targetChannel = null;
      if (channelOption && interaction.guild) {
        try {
          targetChannel = await interaction.guild.channels.fetch(channelOption.id);
        } catch (_error) {
          targetChannel = null;
        }
      }

      if (!targetChannel && interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const memberChannelId = member.voice?.channelId;
          if (memberChannelId) {
            targetChannel = await interaction.guild.channels.fetch(memberChannelId);
          }
        } catch (_error) {
          targetChannel = null;
        }
      }

      const targetGuildId = targetChannel?.guildId || interaction.guildId;

      if (!targetChannel) {
        if (channelOption) {
          await interaction.reply({
            content: 'Channel yang dipilih tidak ditemukan/invalid. Coba pilih ulang channel voice.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          content: 'Kasih opsi `channel` atau masuk voice dulu, nanti bot ikut channel kamu.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (
        targetChannel.type !== ChannelType.GuildVoice &&
        targetChannel.type !== ChannelType.GuildStageVoice
      ) {
        await interaction.reply({
          content: 'Channel target harus voice/stage.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!targetGuildId || targetGuildId !== interaction.guildId) {
        await interaction.reply({
          content: 'Channel target harus dari guild yang sama dengan command ini.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let targetIds = [];
      if (id) {
        const cfg = db.bots.find((x) => x.id === id);
        if (!cfg) {
          await interaction.reply({ content: `Bot ID \`${id}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
          return;
        }
        targetIds = [cfg.id];
      } else {
        targetIds = getOrderedBotConfigs(db.bots).map((x) => x.id);
      }

      if (targetIds.length === 0) {
        await interaction.reply({ content: 'Belum ada bot terdaftar.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(`Memproses join ke <#${targetChannel.id}>...`);
      runBackgroundTask(`join:${interaction.id}`, async () => {
        try {
          const orderedTargetIds = [...targetIds].sort((a, b) => {
            const ca = getBotConfig(a) || { id: a };
            const cb = getBotConfig(b) || { id: b };
            return compareBotConfigOrder(ca, cb);
          });

          const queue = orderedTargetIds.map((botId) => ({ botId, attempt: 1 }));
          const resultsByBot = new Map();
          bgLog(
            `[JOINQ] start guild:${targetGuildId} channel:${targetChannel.id} total:${queue.length} defend:${defend}`
          );

          while (queue.length > 0) {
            const current = queue.shift();
            const { botId, attempt } = current;
            bgLog(
              `[JOINQ] processing ${botDisplayNameById(botId)} (${botId}) attempt:${attempt} remaining:${queue.length}`
            );
            const entry = managedBots.get(botId);
            if (!entry) {
              bgLog(`[JOINQ] skip ${botDisplayNameById(botId)} (${botId}) reason:not-active`);
              resultsByBot.set(botId, { botId, ok: false, reason: 'tidak aktif', attempts: attempt });
              continue;
            }

            try {
              await withTimeout(
                joinBotVoiceWithRetry(botId, targetGuildId, targetChannel.id, defend, 1),
                JOIN_ATTEMPT_TIMEOUT_MS,
                `timeout > ${JOIN_ATTEMPT_TIMEOUT_MS}ms`
              );
              bgLog(`[JOINQ] success ${botDisplayNameById(botId)} (${botId}) attempt:${attempt}`);
              resultsByBot.set(botId, { botId, ok: true, attempts: attempt });
            } catch (error) {
              if (attempt < JOIN_QUEUE_MAX_ATTEMPTS) {
                bgLog(
                  `[JOINQ] requeue ${botDisplayNameById(botId)} (${botId}) attempt:${attempt} reason:${error.message}`
                );
                queue.push({ botId, attempt: attempt + 1 });
              } else {
                bgLog(
                  `[JOINQ] fail ${botDisplayNameById(botId)} (${botId}) attempt:${attempt} reason:${error.message}`
                );
                resultsByBot.set(botId, {
                  botId,
                  ok: false,
                  reason: error.message,
                  attempts: attempt,
                });
              }
            }

            if (queue.length > 0) {
              await sleep(randomInt(JOIN_DELAY.min, JOIN_DELAY.max));
            }
          }

          const okCount = Array.from(resultsByBot.values()).filter((x) => x.ok).length;
          bgLog(
            `[JOINQ] done guild:${targetGuildId} channel:${targetChannel.id} success:${okCount}/${orderedTargetIds.length}`
          );

          const orderedJoined = orderedTargetIds.map((botId) => {
            const hit = resultsByBot.get(botId);
            if (hit) {
              return hit;
            }
            return { botId, ok: false, reason: 'unknown', attempts: 1 };
          });

          const lines = [`Target: <#${targetChannel.id}> | defend: **${defend ? 'ON' : 'OFF'}**`];
          for (const item of orderedJoined) {
            const cfg = getBotConfig(item.botId) || { id: item.botId, label: '-' };
            if (item.ok) {
              lines.push(`- ${formatBotName(cfg)}: join (attempt ${item.attempts})`);
            } else {
              lines.push(`- ${formatBotName(cfg)}: gagal (${item.reason}) (attempt ${item.attempts})`);
            }
          }

          await sendPaginatedInteraction(interaction, lines.join('\n'), true);
        } catch (error) {
          await interaction.editReply(`Error: ${error.message}`);
        }
      });
      return;
    }

    if (cmd === 'move') {
      const id = interaction.options.getString('id');
      const defend = interaction.options.getBoolean('defend') ?? true;
      const channelOption = interaction.options.getChannel('channel', true);
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Command ini hanya bisa dipakai di server (bukan DM).', flags: MessageFlags.Ephemeral });
        return;
      }

      let targetChannel = null;
      if (interaction.guild) {
        try {
          targetChannel = await interaction.guild.channels.fetch(channelOption.id);
        } catch (_error) {
          targetChannel = null;
        }
      }
      if (!targetChannel) {
        await interaction.reply({
          content: 'Channel yang dipilih tidak ditemukan/invalid. Coba pilih ulang channel voice.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (
        targetChannel.type !== ChannelType.GuildVoice &&
        targetChannel.type !== ChannelType.GuildStageVoice
      ) {
        await interaction.reply({
          content: 'Channel target harus voice/stage.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!targetChannel.guildId || targetChannel.guildId !== interaction.guildId) {
        await interaction.reply({
          content: 'Channel target harus dari guild yang sama dengan command ini.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let targetIds = [];
      if (id) {
        const cfg = db.bots.find((x) => x.id === id);
        if (!cfg) {
          await interaction.reply({ content: `Bot ID \`${id}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
          return;
        }
        targetIds = [cfg.id];
      } else {
        targetIds = getOrderedBotConfigs(db.bots).map((x) => x.id);
      }
      if (targetIds.length === 0) {
        await interaction.reply({ content: 'Belum ada bot terdaftar.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const orderedTargetIds = [...targetIds].sort((a, b) => {
        const ca = getBotConfig(a) || { id: a };
        const cb = getBotConfig(b) || { id: b };
        return compareBotConfigOrder(ca, cb);
      });

      const results = await Promise.all(
        orderedTargetIds.map(async (botId) => {
          const cfg = getBotConfig(botId) || { id: botId, label: '-' };
          const entry = managedBots.get(botId);
          if (!entry) {
            return { botId, cfg, ok: false, reason: 'tidak aktif' };
          }
          try {
            await withTimeout(
              joinBotVoice(botId, interaction.guildId, targetChannel.id, defend),
              JOIN_ATTEMPT_TIMEOUT_MS,
              `timeout > ${JOIN_ATTEMPT_TIMEOUT_MS}ms`
            );
            return { botId, cfg, ok: true };
          } catch (error) {
            return { botId, cfg, ok: false, reason: error.message };
          }
        })
      );

      const lines = [`Move instant ke <#${targetChannel.id}> | defend: **${defend ? 'ON' : 'OFF'}**`];
      for (const item of results) {
        if (item.ok) {
          lines.push(`- ${formatBotName(item.cfg)}: moved`);
        } else {
          lines.push(`- ${formatBotName(item.cfg)}: gagal (${item.reason})`);
        }
      }
      await sendPaginatedInteraction(interaction, lines.join('\n'), true);
      return;
    }

    if (cmd === 'setname') {
      const guildId = interaction.guildId || interaction.guild?.id || interaction.member?.guild?.id || null;
      if (!guildId) {
        await interaction.reply({
          content: 'Command `setname` untuk ganti nickname hanya bisa dipakai di server (bukan DM).',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const idOrRange = interaction.options.getString('id', true);
      const rawName = normalizeLabelValue(interaction.options.getString('name', true));
      const targetResult = getSetnameTargets(idOrRange);
      if (targetResult.error) {
        await interaction.reply({ content: targetResult.error, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targets = targetResult.targets;
      const picked = new Map();
      const selectedIds = new Set(targets.map((x) => x.config.id));
      const usedByOthers = new Set(
        db.bots
          .filter((x) => !selectedIds.has(x.id))
          .map((x) => normalizeLabelKey(x.label))
          .filter(Boolean)
      );

      if (targetResult.isRange) {
        if (!isDoctorKeyword(rawName)) {
          await interaction.reply({
            content: 'Untuk format range (contoh `1-5`), isi `name` dengan `doctor`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const specialistNames = loadSpecialistNames();
        if (specialistNames.length === 0) {
          await interaction.reply({
            content: 'listname.json kosong/tidak valid untuk kategori spesialis.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        for (const target of targets) {
          const idx = (target.ordinal || 1) - 1;
          const candidate = specialistNames[idx];
          if (!candidate) {
            await interaction.reply({
              content: `Nama spesialis untuk urutan bot #${target.ordinal} tidak tersedia di listname.json.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const key = normalizeLabelKey(candidate);
          if (usedByOthers.has(key) || Array.from(picked.values()).some((v) => normalizeLabelKey(v) === key)) {
            await interaction.reply({
              content: `Nama **${candidate}** bentrok dengan bot lain. Sesuaikan listname.json dulu.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          picked.set(target.config.id, candidate);
        }
      } else {
        const one = targets[0].config;
        if (isDoctorKeyword(rawName)) {
          const specialistNames = loadSpecialistNames();
          const candidate = specialistNames.find((x) => !usedByOthers.has(normalizeLabelKey(x)));
          if (!candidate) {
            await interaction.reply({
              content: 'Tidak ada nama spesialis kosong di listname.json.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          picked.set(one.id, candidate);
        } else {
          const labelError = validateBotLabel(rawName, one.id);
          if (labelError) {
            await interaction.reply({ content: labelError, flags: MessageFlags.Ephemeral });
            return;
          }
          picked.set(one.id, rawName);
        }
      }

      const lines = [];
      for (const target of targets) {
        const config = target.config;
        const nextName = picked.get(config.id);
        const running = managedBots.get(config.id);
        const updated = { ...config, label: nextName };
        upsertBotConfig(updated);
        if (running) {
          running.label = nextName;
        }
        let nickInfo = 'nick: gagal (guild tidak tersedia)';
        if (guildId) {
          const targetNick = String(nextName).slice(0, 32);
          const targetClientId = running?.client?.user?.id || config.clientId || null;
          let selfSetError = null;

          if (running) {
            try {
              let guild = running.client.guilds.cache.get(guildId);
              if (!guild) {
                guild = await running.client.guilds.fetch(guildId);
              }
              let me = guild.members.me;
              if (!me) {
                me = await guild.members.fetch(running.client.user.id);
              }
              if (!me.manageable) {
                selfSetError = 'role hierarchy / permission';
              } else {
                await me.setNickname(targetNick);
                nickInfo = `nick: ${targetNick}`;
              }
            } catch (error) {
              selfSetError = error.message;
            }
          } else {
            selfSetError = 'bot tidak aktif';
          }

          if (nickInfo.startsWith('nick: ') && !nickInfo.includes('gagal')) {
            lines.push(`- \`${config.id}\` -> **${nextName}** | ${nickInfo}`);
            continue;
          }

          if (!targetClientId) {
            nickInfo = `nick: gagal (${selfSetError || 'client_id bot belum tersedia'})`;
            lines.push(`- \`${config.id}\` -> **${nextName}** | ${nickInfo}`);
            continue;
          }

          try {
            let guild = interaction.guild;
            if (!guild) {
              guild = await controller.guilds.fetch(guildId);
            }
            let ctrlMe = guild.members.me;
            if (!ctrlMe && controller.user) {
              ctrlMe = await guild.members.fetch(controller.user.id);
            }
            if (!ctrlMe || !ctrlMe.permissions.has(PermissionFlagsBits.ManageNicknames)) {
              nickInfo = `nick: gagal (${selfSetError || 'self-fail'} | controller no ManageNicknames)`;
              lines.push(`- \`${config.id}\` -> **${nextName}** | ${nickInfo}`);
              continue;
            }

            const targetMember = await guild.members.fetch(targetClientId);
            if (!targetMember.manageable) {
              nickInfo = `nick: gagal (${selfSetError || 'self-fail'} | controller role hierarchy / permission)`;
              lines.push(`- \`${config.id}\` -> **${nextName}** | ${nickInfo}`);
              continue;
            }

            await targetMember.setNickname(targetNick);
            nickInfo = `nick: ${targetNick} (via controller fallback)`;
          } catch (error) {
            nickInfo = `nick: gagal (${selfSetError || 'self-fail'} | fallback: ${error.message})`;
          }
        }
        lines.push(`- \`${config.id}\` -> **${nextName}** | ${nickInfo}`);
      }

      await sendPaginatedInteraction(interaction, `Setname berhasil:\n${lines.join('\n')}`, true);
      return;
    }

    if (cmd === 'setprofile') {
      const idOrRange = interaction.options.getString('id', true);
      const rawImage = interaction.options.getString('image', true);
      let imageUrl = '';
      try {
        imageUrl = normalizeImageUrl(rawImage);
      } catch (error) {
        await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
        return;
      }

      const targetResult = getSetnameTargets(idOrRange);
      if (targetResult.error) {
        await interaction.reply({ content: targetResult.error, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const lines = [`Setprofile URL: ${imageUrl}`];
      for (const target of targetResult.targets) {
        const config = target.config;
        const running = managedBots.get(config.id);
        try {
          if (running?.client?.user) {
            await running.client.user.setAvatar(imageUrl);
          } else {
            await setAvatarByToken(config.token, imageUrl);
          }
          lines.push(`- \`${config.id}\` -> avatar updated`);
        } catch (error) {
          lines.push(`- \`${config.id}\` -> gagal (${error.message})`);
        }
      }

      await sendPaginatedInteraction(interaction, lines.join('\n'), true);
      return;
    }

    if (cmd === 'leave') {
      const id = interaction.options.getString('id');
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Command ini hanya bisa dipakai di server (bukan DM).', flags: MessageFlags.Ephemeral });
        return;
      }

      let targetIds = [];
      if (id) {
        const cfg = db.bots.find((x) => x.id === id);
        if (!cfg) {
          await interaction.reply({ content: `Bot ID \`${id}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
          return;
        }
        targetIds = [cfg.id];
      } else {
        targetIds = getOrderedBotConfigs(db.bots).map((x) => x.id);
      }

      if (targetIds.length === 0) {
        await interaction.reply({ content: 'Belum ada bot terdaftar.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const results = await Promise.all(
        targetIds.map(async (botId) => {
          const cfg = getBotConfig(botId) || { id: botId, label: '-' };
          const entry = managedBots.get(botId);
          if (!entry) {
            return { cfg, text: 'tidak aktif' };
          }
          try {
            const left = leaveBotVoice(botId, interaction.guildId);
            return { cfg, text: left ? 'leave' : 'tidak sedang di voice guild ini' };
          } catch (error) {
            return { cfg, text: `gagal (${error.message})` };
          }
        })
      );
      const lines = [`Guild: \`${interaction.guildId}\``];
      for (const item of results) {
        lines.push(`- ${formatBotName(item.cfg)}: ${item.text}`);
      }
      await sendPaginatedInteraction(interaction, lines.join('\n'), true);
      return;
    }

    if (cmd === 'invite') {
      const code = interaction.options.getString('code', true);
      const oneId = interaction.options.getString('id');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const invite = await resolveGuildFromInvite(code);
      const includeControllerById = oneId && ['controller', 'ctrl', 'zcus1', 'zcus-1'].includes(oneId.toLowerCase());
      const managedTargets = oneId && !includeControllerById ? db.bots.filter((x) => x.id === oneId) : getOrderedBotConfigs(db.bots);
      const targets = [...managedTargets];
      if (!oneId || includeControllerById) {
        const ctrlLabel = inferZcusLabelFromTag(controller.user?.tag) || controller.user?.username || 'Controller';
        targets.unshift({
          id: 'controller',
          label: ctrlLabel,
          clientId: controllerClientId,
        });
      }

      if (targets.length === 0) {
        await interaction.editReply(oneId ? `Bot ID \`${oneId}\` tidak ditemukan.` : 'Belum ada bot terdaftar.');
        return;
      }

      const lines = [];
      for (const cfg of targets) {
        const isController = cfg.id === 'controller';
        const running = isController ? null : managedBots.get(cfg.id);
        const botClientId = isController ? controllerClientId : running?.clientId || cfg.clientId;
        if (!botClientId) {
          lines.push(`- ${formatBotName(cfg)}: gagal (client_id bot belum tersedia)`);
          continue;
        }

        let alreadyInGuild = false;
        if (isController) {
          alreadyInGuild = await isClientInGuild(controller, invite.guildId);
        } else if (running) {
          alreadyInGuild = await isClientInGuild(running.client, invite.guildId);
        }

        if (alreadyInGuild) {
          lines.push(`- ${formatBotName(cfg)}: sudah ada di guild target`);
          continue;
        }

        const url = makeBotInviteUrl(botClientId, invite.guildId);
        lines.push(`- ${formatBotName(cfg)}: ${url}`);
      }

      const header = `Target guild: **${invite.guildName}** (\`${invite.guildId}\`) via code \`${invite.code}\``;
      await sendPaginatedInteraction(interaction, `${header}\n${lines.join('\n')}`, true);
      return;
    }

    if (cmd === 'synccommands') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await deployCommands();
      await interaction.editReply('Slash commands berhasil di-clear lalu register ulang.');
      return;
    }

    await interaction.reply({ content: 'Command tidak dikenal.', flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Interaction error:', error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`Error: ${error.message}`);
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      if (isUnknownInteractionError(replyError) || isInteractionAlreadyAcknowledgedError(replyError)) {
        bgLog(`[INTERACTION] failed to send error response: ${replyError.message}`);
      } else {
        console.error('Failed to send interaction error response:', replyError);
      }
    }
  }
});

async function main() {
  await initializeDataStore();
  await controller.login(controllerToken);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const id of managedBots.keys()) {
    await stopManagedBot(id);
  }
  controller.destroy();
  await saveDataChain;
  await dbStore.close();
  process.exit(0);
});

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of paginationSessions.entries()) {
    if (now > session.expiresAt) {
      paginationSessions.delete(key);
    }
  }
}, 60_000).unref();
