const assert = require('node:assert');
const cmd = require('../src/commands/ping');

assert.strictEqual(cmd.data.name, 'ping');
assert.strictEqual(typeof cmd.execute, 'function');
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: Date.now() - 250 }) >= 0, true);
assert.strictEqual(cmd.getLatencyMs({ createdTimestamp: 'invalid' }), null);

(async () => {
  let payload = null;
  const interaction = {
    createdTimestamp: Date.now() - 123,
    reply: async (data) => {
      payload = data;
    }
  };

  await cmd.execute(interaction);

  assert.ok(payload, 'ping should send a reply payload');
  assert.strictEqual(payload.ephemeral, true, 'ping reply should be ephemeral');
  assert.ok(payload.content.startsWith('🏓 Pong! Latency:'), 'ping reply should include latency info');

  console.log('ping-command.test.js passed');
})();
