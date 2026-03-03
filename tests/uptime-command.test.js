const assert = require('node:assert');
const cmd = require('../src/commands/uptime');

assert.strictEqual(cmd.data.name, 'uptime');
assert.strictEqual(typeof cmd.execute, 'function');
assert.strictEqual(cmd.formatDuration(3661), '1j 1m 1d');
assert.strictEqual(cmd.formatDuration(90061), '1h 1j 1m 1d');
assert.strictEqual(cmd.formatBytes(1024), '1.0 KB');
assert.ok(
  cmd
    .buildUptimeMessage({
      uptime: () => 3661,
      memoryUsage: () => ({ rss: 2048 }),
      platform: 'linux',
      pid: 999,
      version: 'v99.0.0',
      arch: 'arm64'
    })
    .includes('🧩 Node: v99.0.0')
);
assert.ok(
  cmd
    .buildUptimeMessage({
      uptime: () => 1,
      memoryUsage: () => ({ rss: 1 }),
      platform: 'linux',
      pid: 1,
      version: 'v1.0.0',
      arch: 'arm64'
    })
    .includes('🏗️ Arch: arm64')
);
assert.ok(
  cmd.buildUptimeMessage({ platform: 'linux', pid: 777 }).includes('🧠 RAM (RSS):'),
  'buildUptimeMessage should fallback safely when uptime/memoryUsage methods are missing'
);
assert.ok(
  cmd
    .buildUptimeMessage({
      uptime: () => {
        throw new Error('uptime failed');
      },
      memoryUsage: () => {
        throw new Error('memory failed');
      },
      platform: 'linux',
      pid: 888
    })
    .includes('⏱️ Uptime:'),
  'buildUptimeMessage should fallback safely when runtime methods throw'
);

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
  assert.ok(payload.content.includes('🖥️ Runtime:'), 'uptime reply should contain runtime label');
  assert.ok(payload.content.includes('pid:'), 'uptime reply should include process pid');
  assert.ok(payload.content.includes('🧩 Node:'), 'uptime reply should include node version label');
  assert.ok(payload.content.includes(process.version), 'uptime reply should include current node version');
  assert.ok(payload.content.includes('🏗️ Arch:'), 'uptime reply should include architecture label');

  console.log('uptime-command.test.js passed');
})();
