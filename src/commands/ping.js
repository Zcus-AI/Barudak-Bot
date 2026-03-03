const { getInteractionLatencyMs } = require('../utils/metrics-format');

function getWebsocketPingMs(client) {
  return normalizePingMs(client?.ws?.ping);
}

const LATENCY_BADGES = {
  unknown: '⚪',
  good: '🟢',
  medium: '🟡',
  bad: '🔴'
};

const LATENCY_THRESHOLDS_MS = {
  good: 100,
  medium: 250
};

function formatMs(value) {
  return value === null ? 'n/a' : `${value}ms`;
}

function normalizePingMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function getLatencyBadge(wsPingMs) {
  const safePing = normalizePingMs(wsPingMs);
  if (safePing === null) return LATENCY_BADGES.unknown;
  if (safePing <= LATENCY_THRESHOLDS_MS.good) return LATENCY_BADGES.good;
  if (safePing <= LATENCY_THRESHOLDS_MS.medium) return LATENCY_BADGES.medium;
  return LATENCY_BADGES.bad;
}

const LATENCY_TIER_BY_BADGE = {
  [LATENCY_BADGES.good]: 'good',
  [LATENCY_BADGES.medium]: 'medium',
  [LATENCY_BADGES.bad]: 'poor',
  [LATENCY_BADGES.unknown]: 'unknown'
};

function getLatencyTier(wsPingMs) {
  const badge = getLatencyBadge(wsPingMs);
  return LATENCY_TIER_BY_BADGE[badge] || LATENCY_TIER_BY_BADGE[LATENCY_BADGES.unknown];
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

function getPingMetrics(interaction, client) {
  const latencyMs = getInteractionLatencyMs(interaction);
  const wsPingMs = getWebsocketPingMs(client);
  const badge = getLatencyBadge(wsPingMs);
  return {
    latencyMs,
    wsPingMs,
    badge,
    tier: getLatencyTier(wsPingMs)
  };
}

function buildPingMessage(interaction, client, nowIso = getIsoNow()) {
  const metrics = getPingMetrics(interaction, client);
  const safeIsoNow = normalizeIsoTimestamp(nowIso);
  return `🏓 Pong! ${metrics.badge} Latency: ${formatMs(metrics.latencyMs)} | WS: ${formatMs(metrics.wsPingMs)} | Tier: ${metrics.tier} | At: ${safeIsoNow}`;
}

module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  getLatencyMs: getInteractionLatencyMs,
  getWebsocketPingMs,
  normalizePingMs,
  getLatencyBadge,
  getLatencyTier,
  getPingMetrics,
  normalizeIsoTimestamp,
  buildPingMessage,
  async execute(interaction, client) {
    await interaction.reply({
      content: buildPingMessage(interaction, client),
      ephemeral: true
    });
  }
};
