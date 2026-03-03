const assert = require('node:assert');
const cmd = require('../src/commands/ping');

assert.strictEqual(cmd.data.name, 'ping');
assert.strictEqual(typeof cmd.execute, 'function');
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: Date.now() - 250 }) >= 0, true);
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: 'invalid' }), null);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: 42.9 } }), 42);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: 'invalid' } }), null);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: -5 } }), null);
assert.strictEqual(cmd.normalizePingMs(50.8), 50);
assert.strictEqual(cmd.normalizePingMs('invalid'), null);
assert.strictEqual(cmd.normalizePingMs(-1), null);
assert.strictEqual(cmd.normalizePingMs(''), null);
assert.strictEqual(cmd.getLatencyBadge(50), '🟢');
assert.strictEqual(cmd.getLatencyBadge(100), '🟢');
assert.strictEqual(cmd.getLatencyBadge(200), '🟡');
assert.strictEqual(cmd.getLatencyBadge(250), '🟡');
assert.strictEqual(cmd.getLatencyBadge(251), '🔴');
assert.strictEqual(cmd.getLatencyBadge(500), '🔴');
assert.strictEqual(cmd.getLatencyBadge(null), '⚪');
assert.strictEqual(cmd.getLatencyBadge(-10), '⚪');
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
assert.ok(/\d{4}-\d{2}-\d{2}T/.test(cmd.normalizeIsoTimestamp(null)));
assert.ok(
  cmd.buildPingMessage({ createdTimestamp: Date.now() - 25 }, { ws: { ping: 10 } }, '2026-01-01T00:00:00.000Z').includes('WS: 10ms'),
  'buildPingMessage should include websocket ping in ms format'
);
assert.ok(
  cmd
    .buildPingMessage({ createdTimestamp: 'invalid' }, {}, '2026-01-01T00:00:00.000Z')
    .includes('Latency: n/a | WS: n/a | At: 2026-01-01T00:00:00.000Z'),
  'buildPingMessage should fallback for missing latency metrics and include timestamp'
);

(async () => {
  let payload = null;
  const interaction = {
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
