export {};
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const dbStore = require('../store/db-store');

function normalizeBotsInPlace(db) {
  if (!Array.isArray(db?.bots)) {
    db.bots = [];
    return 0;
  }

  const seenIds = new Set();
  const seenTokens = new Set();
  const seenClientIds = new Set();
  const next = [];
  let removed = 0;

  for (const bot of db.bots) {
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
    if (clientId) seenClientIds.add(clientId);
    next.push({ ...bot, id, token, clientId: clientId || null, usernameTag: usernameTag || null });
  }

  db.bots = next;
  return removed;
}

function makeId(existing) {
  let id = crypto.randomUUID().slice(0, 8);
  while (existing.has(id)) {
    id = crypto.randomUUID().slice(0, 8);
  }
  return id;
}

async function getBotIdentity(token) {
  const res = await axios.get('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` },
    timeout: 15_000,
  });
  return res.data;
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parseTokensFromArgs() {
  const csv = getArg('--tokens');
  if (!csv) return [];
  return csv
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseTokensFromFilePath(filePath) {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Token file not found: ${filePath}`);
    }
    throw new Error(`Failed to read token file: ${filePath} (${error.message})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in token file: ${filePath} (${error.message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Token file must be JSON array');
  }
  return parsed.map((x) => String(x).trim()).filter(Boolean);
}

function parseTokensFromFileArg() {
  const file = getArg('--file');
  if (!file) return [];
  return parseTokensFromFilePath(path.resolve(process.cwd(), file));
}

function parseTokensFromDefaultFile() {
  const defaultPath = path.resolve(process.cwd(), 'tokens.json');
  return parseTokensFromFilePath(defaultPath);
}

async function main() {
  const fromArgs = parseTokensFromArgs();
  const fromFileArg = parseTokensFromFileArg();
  let tokens = [...fromArgs, ...fromFileArg];

  if (tokens.length === 0) {
    try {
      const fromDefaultFile = parseTokensFromDefaultFile();
      tokens = [...fromDefaultFile];
      console.log('[INPUT] using default tokens.json');
    } catch (error) {
      const defaultPath = path.resolve(process.cwd(), 'tokens.json');
      if (String(error?.message || '').includes('Token file not found:')) {
        console.log(`[INPUT] default token file not found: ${defaultPath}`);
        console.log('Usage:');
        console.log('  node batch-add-bots.js --tokens token1,token2,token3');
        console.log('  node batch-add-bots.js --file tokens.json');
        console.log('  node batch-add-bots.js    # default: read ./tokens.json');
        process.exit(1);
      }
      throw error;
    }
  }

  tokens = [...new Set(tokens)];

  if (tokens.length === 0) {
    console.log('No tokens found after parsing input.');
    console.log('Usage:');
    console.log('  node batch-add-bots.js --tokens token1,token2,token3');
    console.log('  node batch-add-bots.js --file tokens.json');
    console.log('  node batch-add-bots.js    # default: read ./tokens.json');
    process.exit(1);
  }

  const db = await dbStore.loadAppData();
  const removedOnLoad = normalizeBotsInPlace(db);
  if (removedOnLoad > 0) {
    console.log(`[DB] removed ${removedOnLoad} duplicate/invalid bot entries (kept oldest).`);
  }
  const existingIds = new Set(db.bots.map((x) => x.id));
  const existingTokens = new Set(db.bots.map((x) => x.token));

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (existingTokens.has(token)) {
      console.log(`[SKIP] token #${i + 1} already exists`);
      continue;
    }

    try {
      const me = await getBotIdentity(token);
      const id = makeId(existingIds);
      existingIds.add(id);
      existingTokens.add(token);
      const usernameTag = me.discriminator ? `${me.username}#${me.discriminator}` : me.username || null;
      const label = usernameTag || me.username || `bot-${i + 1}`;
      db.bots.push({
        id,
        token,
        label,
        clientId: me.id,
        usernameTag,
        voiceStates: [],
      });
      ok += 1;
      console.log(`[OK] ${me.username}#${me.discriminator} -> id ${id}`);
    } catch (error) {
      fail += 1;
      const status = error?.response?.status;
      console.log(`[FAIL] token #${i + 1}${status ? ` (HTTP ${status})` : ''}`);
    }
  }

  const removedAfterAdd = normalizeBotsInPlace(db);
  if (removedAfterAdd > 0) {
    console.log(`[DB] removed ${removedAfterAdd} duplicate bot entries after batch add (kept oldest).`);
  }
  await dbStore.saveAppData(db);
  console.log(`Done. Added: ${ok}, Failed: ${fail}`);
}

main()
  .catch((error) => {
    console.error(`Fatal: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await dbStore.close();
  });
