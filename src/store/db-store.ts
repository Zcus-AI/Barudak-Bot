export {};
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const ENV_FILE = path.join(process.cwd(), '.env');

let initialized = false;
let pool = null;

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

function getDbConfig() {
  loadDotEnvFile(ENV_FILE);
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE;

  if (!user || !database) {
    throw new Error('Missing MySQL env. Required: MYSQL_USER and MYSQL_DATABASE');
  }
  return {
    host,
    port: Number.isFinite(port) ? port : 3306,
    user,
    password,
    database,
  };
}

function normalizeVoiceStates(voiceStates) {
  if (!Array.isArray(voiceStates)) {
    return [];
  }
  return voiceStates
    .filter((x) => x && typeof x.guildId === 'string' && typeof x.channelId === 'string')
    .map((x) => ({
      guildId: x.guildId.trim(),
      channelId: x.channelId.trim(),
      defend: Boolean(x.defend),
    }))
    .filter((x) => x.guildId && x.channelId);
}

function parseLegacyVoiceStates(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeVoiceStates(parsed);
  } catch (_error) {
    return [];
  }
}

async function ensureInitialized() {
  if (initialized) {
    return;
  }
  const cfg = getDbConfig();
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bots (
      id VARCHAR(32) NOT NULL PRIMARY KEY,
      token VARCHAR(255) NOT NULL,
      label VARCHAR(255) NULL,
      client_id VARCHAR(64) NULL,
      username_tag VARCHAR(128) NULL,
      voice_states JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bots_token (token),
      UNIQUE KEY uq_bots_client_id (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  try {
    await pool.query('ALTER TABLE bots ADD COLUMN username_tag VARCHAR(128) NULL AFTER client_id');
  } catch (error) {
    if (!error || error.code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_voice_states (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bot_id VARCHAR(32) NOT NULL,
      guild_id VARCHAR(64) NOT NULL,
      channel_id VARCHAR(64) NOT NULL,
      defend TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bot_voice_state (bot_id, guild_id, channel_id),
      KEY idx_bot_voice_states_bot_id (bot_id),
      CONSTRAINT fk_bot_voice_states_bot FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      config_key VARCHAR(128) NOT NULL PRIMARY KEY,
      config_value TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  initialized = true;
}

async function loadAppData() {
  await ensureInitialized();
  const [botRows] = await pool.query(
    'SELECT id, token, label, client_id AS clientId, username_tag AS usernameTag, voice_states AS legacyVoiceStates FROM bots'
  );
  const [voiceRows] = await pool.query(
    'SELECT bot_id AS botId, guild_id AS guildId, channel_id AS channelId, defend FROM bot_voice_states'
  );
  const [cfgRows] = await pool.query(
    "SELECT config_key AS configKey, config_value AS configValue FROM app_config WHERE config_key IN ('monitor.channelId', 'monitor.messageId')"
  );

  const voiceByBot = new Map();
  for (const row of voiceRows) {
    if (!voiceByBot.has(row.botId)) {
      voiceByBot.set(row.botId, []);
    }
    voiceByBot.get(row.botId).push({
      guildId: String(row.guildId || '').trim(),
      channelId: String(row.channelId || '').trim(),
      defend: Boolean(row.defend),
    });
  }

  const bots = botRows.map((row) => {
    const fromTable = normalizeVoiceStates(voiceByBot.get(row.id) || []);
    const fallbackLegacy = fromTable.length > 0 ? [] : parseLegacyVoiceStates(row.legacyVoiceStates);
    return {
      id: row.id,
      token: row.token,
      label: row.label || null,
      clientId: row.clientId || null,
      usernameTag: row.usernameTag || null,
      voiceStates: fromTable.length > 0 ? fromTable : fallbackLegacy,
    };
  });

  const monitor = { channelId: null, messageId: null };
  for (const row of cfgRows) {
    if (row.configKey === 'monitor.channelId') {
      monitor.channelId = row.configValue || null;
    }
    if (row.configKey === 'monitor.messageId') {
      monitor.messageId = row.configValue || null;
    }
  }

  return { bots, monitor };
}

async function saveAppData(data) {
  await ensureInitialized();
  const bots = Array.isArray(data?.bots) ? data.bots : [];
  const monitor = data?.monitor && typeof data.monitor === 'object' ? data.monitor : {};

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (bots.length === 0) {
      await conn.query('DELETE FROM bot_voice_states');
      await conn.query('DELETE FROM bots');
    } else {
      const ids = bots.map((x) => String(x.id));
      const placeholders = ids.map(() => '?').join(',');
      await conn.query(`DELETE FROM bots WHERE id NOT IN (${placeholders})`, ids);

      for (const bot of bots) {
        await conn.query(
          `
            INSERT INTO bots (id, token, label, client_id, username_tag, voice_states)
            VALUES (?, ?, ?, ?, ?, JSON_ARRAY())
            ON DUPLICATE KEY UPDATE
              token = VALUES(token),
              label = VALUES(label),
              client_id = VALUES(client_id),
              username_tag = VALUES(username_tag)
          `,
          [
            String(bot.id),
            String(bot.token),
            bot.label ? String(bot.label) : null,
            bot.clientId ? String(bot.clientId) : null,
            bot.usernameTag ? String(bot.usernameTag) : null,
          ]
        );

        await conn.query('DELETE FROM bot_voice_states WHERE bot_id = ?', [String(bot.id)]);
        const voiceStates = normalizeVoiceStates(bot.voiceStates);
        for (const state of voiceStates) {
          await conn.query(
            `
              INSERT INTO bot_voice_states (bot_id, guild_id, channel_id, defend)
              VALUES (?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE defend = VALUES(defend)
            `,
            [String(bot.id), state.guildId, state.channelId, state.defend ? 1 : 0]
          );
        }
      }
    }

    await conn.query(
      `
        INSERT INTO app_config (config_key, config_value)
        VALUES ('monitor.channelId', ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
      `,
      [monitor.channelId ? String(monitor.channelId) : null]
    );
    await conn.query(
      `
        INSERT INTO app_config (config_key, config_value)
        VALUES ('monitor.messageId', ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
      `,
      [monitor.messageId ? String(monitor.messageId) : null]
    );

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
  }
  pool = null;
  initialized = false;
}

module.exports = {
  loadAppData,
  saveAppData,
  close,
};
