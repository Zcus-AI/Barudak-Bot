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

function getTierFromBadge(badge) {
  return LATENCY_TIER_BY_BADGE[badge] || LATENCY_TIER_BY_BADGE[LATENCY_BADGES.unknown];
}

function getLatencyTier(wsPingMs) {
  return getTierFromBadge(getLatencyBadge(wsPingMs));
}

function getIsoNow() {
  return new Date().toISOString();
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string') {
    return getIsoNow();
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
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
    tier: getTierFromBadge(badge)
  };
}

function getInteractionRef(interaction) {
  const raw = String(interaction?.id || '').trim();
  if (!raw) return 'n/a';
  const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!normalized) return 'n/a';
  return normalized.slice(-6);
}

function getScopeLabel(interaction) {
  const guildId = String(interaction?.guildId || '').trim();
  if (guildId) return 'guild';
  return 'dm';
}

function buildPingSegments(interaction, client, nowIso = getIsoNow()) {
  const metrics = getPingMetrics(interaction, client);
  return {
    badge: metrics.badge,
    latencyText: formatMs(metrics.latencyMs),
    wsText: formatMs(metrics.wsPingMs),
    tier: metrics.tier,
    scope: getScopeLabel(interaction),
    ref: getInteractionRef(interaction),
    at: normalizeIsoTimestamp(nowIso)
  };
}

function buildPingMessage(interaction, client, nowIso = getIsoNow()) {
  const s = buildPingSegments(interaction, client, nowIso);
  return `🏓 Pong! ${s.badge} Latency: ${s.latencyText} | WS: ${s.wsText} | Tier: ${s.tier} | Scope: ${s.scope} | Ref: ${s.ref} | At: ${s.at}`;
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
  getInteractionRef,
  getScopeLabel,
  buildPingSegments,
  normalizeIsoTimestamp,
  buildPingMessage,
  async execute(interaction, client) {
    await interaction.reply({
      content: buildPingMessage(interaction, client),
      ephemeral: true
    });
  }
};
