const assert = require('node:assert');
const cmd = require('../src/commands/uptime');

assert.strictEqual(cmd.data.name, 'uptime');
assert.strictEqual(typeof cmd.execute, 'function');
assert.strictEqual(cmd.formatDuration(3661), '1j 1m 1d');
assert.strictEqual(cmd.formatDuration(90061), '1h 1j 1m 1d');
assert.strictEqual(cmd.formatBytes(1024), '1.0 KB');

(async () => {
  let payload = null;
  const interaction = {
    reply: async (data) => {
      payload = data;
    }
  };

  await cmd.execute(interaction);
  assert.ok(payload, 'uptime should send a reply');
  assert.strictEqual(payload.ephemeral, true, 'uptime reply should be ephemeral');
  assert.ok(payload.content.includes('⏱️ Uptime:'), 'uptime reply should contain uptime label');
  assert.ok(payload.content.includes('🧠 RAM (RSS):'), 'uptime reply should contain memory label');

  console.log('uptime-command.test.js passed');
})();
