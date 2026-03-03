export {};
const dbStore = require('../store/db-store');

function maskToken(token) {
  if (typeof token !== 'string' || token.length < 10) return '***';
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

function getOrderNumber(bot) {
  const source = String(bot?.usernameTag || bot?.label || '');
  const match = source.match(/(\d+)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

function sortBots(list) {
  return [...list].sort((a, b) => {
    const na = getOrderNumber(a);
    const nb = getOrderNumber(b);
    if (na !== nb) return na - nb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

async function main() {
  const db = await dbStore.loadAppData();
  if (!Array.isArray(db.bots) || db.bots.length === 0) {
    console.log('No bots found in MySQL.');
    return;
  }

  const orderedBots = sortBots(db.bots);
  const rows = orderedBots.map((bot, index) => ({
    no: index + 1,
    id: bot.id ?? '-',
    label: bot.label ?? '-',
    usernameTag: bot.usernameTag ?? '-',
    clientId: bot.clientId ?? '-',
    voiceStates: Array.isArray(bot.voiceStates) ? bot.voiceStates.length : 0,
    token: maskToken(bot.token),
  }));

  console.table(rows);
  console.log(`Total bots: ${rows.length}`);
}

main()
  .catch((error) => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await dbStore.close();
  });
