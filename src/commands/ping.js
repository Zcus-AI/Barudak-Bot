const { getInteractionLatencyMs } = require('../utils/metrics-format');

function getWebsocketPingMs(client) {
  const wsPing = Number(client?.ws?.ping);
  if (!Number.isFinite(wsPing) || wsPing < 0) {
    return null;
  }
  return Math.floor(wsPing);
}

function formatMs(value) {
  return value === null ? 'n/a' : `${value}ms`;
}

function getIsoNow() {
  return new Date().toISOString();
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string') {
    return getIsoNow();
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return getIsoNow();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return getIsoNow();
  }
  return parsed.toISOString();
}

function buildPingMessage(interaction, client, nowIso = getIsoNow()) {
  const latencyMs = getInteractionLatencyMs(interaction);
  const wsPingMs = getWebsocketPingMs(client);
  const safeIsoNow = normalizeIsoTimestamp(nowIso);
  return `🏓 Pong! Latency: ${formatMs(latencyMs)} | WS: ${formatMs(wsPingMs)} | At: ${safeIsoNow}`;
}

module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  getLatencyMs: getInteractionLatencyMs,
  getWebsocketPingMs,
  normalizeIsoTimestamp,
  buildPingMessage,
  async execute(interaction, client) {
    await interaction.reply({
      content: buildPingMessage(interaction, client),
      ephemeral: true
    });
  }
};
