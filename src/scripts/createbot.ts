export {};
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { Client, GatewayIntentBits } = require('discord.js');
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

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[idx + 1];
}

function makeId(existing) {
  let id = crypto.randomUUID().slice(0, 8);
  while (existing.has(id)) {
    id = crypto.randomUUID().slice(0, 8);
  }
  return id;
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

function findDuplicateLabel(db, label) {
  const key = normalizeLabelKey(label);
  if (!key) {
    return null;
  }
  return db.bots.find((bot) => normalizeLabelKey(bot.label) === key) || null;
}

async function resolveBotIdentity(token) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(token);
    const user = client.user;
    if (!user) {
      throw new Error('Failed to read bot user');
    }
    return { clientId: user.id, tag: user.tag };
  } finally {
    client.destroy();
  }
}

async function main() {
  let token = argValue('--token');
  let label = argValue('--label');

  if (!token) {
    const rl = readline.createInterface({ input, output });
    try {
      token = (await rl.question('Bot token: ')).trim();
      const labelInput = (await rl.question('Nama bot (wajib, harus ada kata Spesialis): ')).trim();
      label = labelInput || null;
    } finally {
      rl.close();
    }
  } else {
    token = token.trim();
    label = label ? label.trim() : null;
  }

  if (!token) {
    console.error('Token is required.');
    process.exit(1);
  }
  label = normalizeLabelValue(label);
  if (!label) {
    console.error('Label is required and must include "Spesialis".');
    process.exit(1);
  }
  if (!isSpecialistLabel(label)) {
    console.error('Label must include the word "Spesialis".');
    process.exit(1);
  }

  const db = await dbStore.loadAppData();
  const removedOnLoad = normalizeBotsInPlace(db);
  if (removedOnLoad > 0) {
    console.log(`[DB] removed ${removedOnLoad} duplicate/invalid bot entries (kept oldest).`);
  }
  if (db.bots.some((b) => b.token === token)) {
    console.error('Token already exists in MySQL.');
    process.exit(1);
  }
  const duplicateLabel = findDuplicateLabel(db, label);
  if (duplicateLabel) {
    console.error(`Label already used by bot ID ${duplicateLabel.id}.`);
    process.exit(1);
  }

  const identity = await resolveBotIdentity(token);
  const existingIds = new Set(db.bots.map((b) => b.id));
  const id = makeId(existingIds);

  db.bots.push({
    id,
    token,
    label,
    clientId: identity.clientId,
    usernameTag: identity.tag || null,
    voiceStates: [],
  });
  normalizeBotsInPlace(db);
  await dbStore.saveAppData(db);

  console.log(`Added bot: ${identity.tag}`);
  console.log(`ID: ${id}`);
  console.log(`Client ID: ${identity.clientId}`);
}

main()
  .catch((error) => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await dbStore.close();
  });
