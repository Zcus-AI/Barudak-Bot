const assert = require('node:assert');
const cmd = require('../src/commands/ping');

assert.strictEqual(cmd.data.name, 'ping');
assert.strictEqual(typeof cmd.execute, 'function');
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: Date.now() - 250 }) >= 0, true);
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: 'invalid' }), null);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: 42.9 } }), 42);
assert.strictEqual(cmd.getWebsocketPingMs({ ws: { ping: 'invalid' } }), null);

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
  assert.ok(payload.content.startsWith('🏓 Pong! Latency:'), 'ping reply should include latency info');
  assert.ok(/Latency: \d+ms/.test(payload.content), 'ping reply should include numeric latency when timestamp valid');
  assert.ok(payload.content.includes('WS: 87ms'), 'ping reply should include websocket ping when available');

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
