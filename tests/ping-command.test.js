const assert = require('node:assert');
const cmd = require('../src/commands/ping');

assert.strictEqual(cmd.data.name, 'ping');
assert.strictEqual(typeof cmd.execute, 'function');
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: Date.now() - 250 }) >= 0, true);
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: 'invalid' }), null);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: 42.9 } }), 42);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: 'invalid' } }), null);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: -5 } }), null);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: '   ' } }), null);
assert.strictEqual(cmd.normalizePingMs(50.8), 50);
assert.strictEqual(cmd.normalizePingMs('invalid'), null);
assert.strictEqual(cmd.normalizePingMs(-1), null);
assert.strictEqual(cmd.normalizePingMs(''), null);
assert.strictEqual(cmd.normalizePingMs(null), null);
assert.strictEqual(cmd.normalizePingMs(undefined), null);
assert.strictEqual(cmd.normalizePingMs('   '), null);
assert.strictEqual(cmd.getLatencyBadge(50), '🟢');
assert.strictEqual(cmd.getLatencyBadge(100), '🟢');
assert.strictEqual(cmd.getLatencyBadge(200), '🟡');
assert.strictEqual(cmd.getLatencyBadge(250), '🟡');
assert.strictEqual(cmd.getLatencyBadge(251), '🔴');
assert.strictEqual(cmd.getLatencyBadge(500), '🔴');
assert.strictEqual(cmd.getLatencyBadge(null), '⚪');
assert.strictEqual(cmd.getLatencyBadge(-10), '⚪');
assert.strictEqual(cmd.getLatencyTier(50), 'good');
assert.strictEqual(cmd.getLatencyTier(180), 'medium');
assert.strictEqual(cmd.getLatencyTier(500), 'poor');
assert.strictEqual(cmd.getLatencyTier(null), 'unknown');
assert.strictEqual(cmd.getInteractionRef({ id: '1234567890' }), '567890');
assert.strictEqual(cmd.getInteractionRef({ id: '  abc-123_456  ' }), '23_456');
assert.strictEqual(cmd.getInteractionRef({ id: '!!!' }), 'n/a');
assert.strictEqual(cmd.getInteractionRef({ id: '   ' }), 'n/a');
assert.strictEqual(cmd.getScopeLabel({ guildId: '123' }), 'guild');
assert.strictEqual(cmd.getScopeLabel({ guildId: '   ' }), 'dm');
assert.strictEqual(cmd.getScopeLabel({}), 'dm');
const segments = cmd.buildPingSegments(
  { id: 'abc123456789', createdTimestamp: Date.now() - 100 },
  { ws: { ping: 42 } },
  '2026-01-01T00:00:00.000Z'
);
assert.strictEqual(segments.badge, '🟢');
assert.strictEqual(segments.wsText, '42ms');
assert.strictEqual(segments.deltaText, '58ms');
assert.strictEqual(segments.ref, '456789');
assert.strictEqual(segments.scope, 'dm');
assert.strictEqual(segments.at, '2026-01-01T00:00:00.000Z');

const guildSegments = cmd.buildPingSegments(
  { id: 'xyz987654321', guildId: '999', createdTimestamp: Date.now() - 100 },
  { ws: { ping: 260 } },
  '2026-01-01T00:00:00.000Z'
);
assert.strictEqual(guildSegments.badge, '🔴');
assert.strictEqual(guildSegments.tier, 'poor');
assert.strictEqual(guildSegments.scope, 'guild');
assert.strictEqual(cmd.getLatencyDeltaMs(100, 80), 20);
assert.strictEqual(cmd.getLatencyDeltaMs(null, 80), null);

const metrics = cmd.getPingMetrics({ createdTimestamp: Date.now() - 100 }, { ws: { ping: 120 } });
assert.strictEqual(typeof metrics.latencyMs, 'number');
assert.strictEqual(metrics.wsPingMs, 120);
assert.strictEqual(typeof metrics.deltaMs, 'number');
assert.strictEqual(metrics.badge, '🟡');
assert.strictEqual(metrics.tier, 'medium');

const metricsBoundaryGood = cmd.getPingMetrics({ createdTimestamp: Date.now() - 100 }, { ws: { ping: 100 } });
assert.strictEqual(metricsBoundaryGood.badge, '🟢');
assert.strictEqual(metricsBoundaryGood.tier, 'good');

const metricsBoundaryMedium = cmd.getPingMetrics({ createdTimestamp: Date.now() - 100 }, { ws: { ping: 250 } });
assert.strictEqual(metricsBoundaryMedium.badge, '🟡');
assert.strictEqual(metricsBoundaryMedium.tier, 'medium');

const metricsBoundaryPoor = cmd.getPingMetrics({ createdTimestamp: Date.now() - 100 }, { ws: { ping: 251 } });
assert.strictEqual(metricsBoundaryPoor.badge, '🔴');
assert.strictEqual(metricsBoundaryPoor.tier, 'poor');

const metricsInvalid = cmd.getPingMetrics({ createdTimestamp: 'invalid' }, { ws: { ping: -1 } });
assert.strictEqual(metricsInvalid.latencyMs, null);
assert.strictEqual(metricsInvalid.wsPingMs, null);
assert.strictEqual(metricsInvalid.deltaMs, null);
assert.strictEqual(metricsInvalid.badge, '⚪');
assert.strictEqual(metricsInvalid.tier, 'unknown');
assert.strictEqual(
  cmd.normalizeIsoTimestamp('2026-01-01T00:00:00.000Z'),
  '2026-01-01T00:00:00.000Z'
);
assert.strictEqual(
  cmd.normalizeIsoTimestamp('2026-01-01 00:00:00Z'),
  '2026-01-01T00:00:00.000Z',
  'normalizeIsoTimestamp should normalize valid non-canonical date strings'
);
assert.ok(/\d{4}-\d{2}-\d{2}T/.test(cmd.normalizeIsoTimestamp('invalid-date')));
assert.ok(/\d{4}-\d{2}-\d{2}T/.test(cmd.normalizeIsoTimestamp('   ')));
assert.ok(/\d{4}-\d{2}-\d{2}T/.test(cmd.normalizeIsoTimestamp('x'.repeat(100))));
assert.ok(/\d{4}-\d{2}-\d{2}T/.test(cmd.normalizeIsoTimestamp(null)));
assert.ok(
  cmd.buildPingMessage({ createdTimestamp: Date.now() - 25 }, { ws: { ping: 10 } }, '2026-01-01T00:00:00.000Z').includes('WS: 10ms'),
  'buildPingMessage should include websocket ping in ms format'
);
assert.ok(
  cmd
    .buildPingMessage({ createdTimestamp: 'invalid' }, {}, '2026-01-01T00:00:00.000Z')
    .includes('Latency: n/a | WS: n/a | Delta: n/a | Tier: unknown | Scope: dm | Ref: n/a | At: 2026-01-01T00:00:00.000Z'),
  'buildPingMessage should fallback for missing latency metrics and include timestamp'
);

(async () => {
  let payload = null;
  const interaction = {
    id: 'abc123456789',
    createdTimestamp: Date.now() - 123,
    reply: async (data) => {
      payload = data;
    }
  };

  await cmd.execute(interaction, { ws: { ping: 87 } });

  assert.ok(payload, 'ping should send a reply payload');
  assert.strictEqual(payload.ephemeral, true, 'ping reply should be ephemeral');
  assert.ok(payload.content.startsWith('🏓 Pong!'), 'ping reply should include pong prefix');
  assert.ok(/🏓 Pong! (🟢|🟡|🔴|⚪) Latency:/.test(payload.content), 'ping reply should include latency badge');
  assert.ok(/Latency: \d+ms/.test(payload.content), 'ping reply should include numeric latency when timestamp valid');
  assert.ok(payload.content.includes('WS: 87ms'), 'ping reply should include websocket ping when available');
  assert.ok(payload.content.includes('Delta:'), 'ping reply should include latency delta label');
  assert.ok(payload.content.includes('Tier: good'), 'ping reply should include latency tier label');
  assert.ok(payload.content.includes('Scope: dm'), 'ping reply should include interaction scope label');
  assert.ok(payload.content.includes('Ref: 456789'), 'ping reply should include short interaction reference');
  assert.ok(/\| At: .*Z$/.test(payload.content), 'ping reply should include ISO timestamp');

  let invalidPayload = null;
  await cmd.execute(
    {
      createdTimestamp: 'invalid',
      reply: async (data) => {
        invalidPayload = data;
      }
    },
    {}
  );
  assert.ok(invalidPayload.content.includes('Latency: n/a'), 'ping should fallback to n/a latency when timestamp invalid');
  assert.ok(invalidPayload.content.includes('WS: n/a'), 'ping should fallback to n/a websocket ping when unavailable');

  console.log('ping-command.test.js passed');
})();
