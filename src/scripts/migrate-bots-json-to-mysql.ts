export {};
const fs = require('node:fs');
const path = require('node:path');
const dbStore = require('../store/db-store');

const DATA_FILE = path.join(process.cwd(), 'bots.json');

function normalizeBotsInPlace(db) {
  if (!Array.isArray(db?.bots)) {
    db.bots = [];
    return;
  }
  db.bots = db.bots
    .filter((bot) => bot && typeof bot.id === 'string' && typeof bot.token === 'string')
    .map((bot) => ({
      id: String(bot.id).trim(),
      token: String(bot.token).trim(),
      label: typeof bot.label === 'string' ? bot.label.trim() || null : null,
      clientId: typeof bot.clientId === 'string' ? bot.clientId.trim() || null : null,
      usernameTag: typeof bot.usernameTag === 'string' ? bot.usernameTag.trim() || null : null,
      voiceStates: Array.isArray(bot.voiceStates) ? bot.voiceStates : [],
    }))
    .filter((bot) => bot.id && bot.token);
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('bots.json tidak ditemukan.');
    process.exit(1);
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const payload = {
    bots: Array.isArray(parsed?.bots) ? parsed.bots : [],
    monitor: parsed?.monitor && typeof parsed.monitor === 'object' ? parsed.monitor : {},
  };
  normalizeBotsInPlace(payload);
  await dbStore.saveAppData(payload);
  console.log(`Migrasi selesai. Total bot: ${payload.bots.length}`);
}

main()
  .catch((error) => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await dbStore.close();
  });
