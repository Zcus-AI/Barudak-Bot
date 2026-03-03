const assert = require('node:assert');
const {
  formatDuration,
  formatBytes,
  getInteractionLatencyMs,
  formatRuntimeInfo
} = require('../src/utils/metrics-format');

assert.strictEqual(formatDuration(3661), '1j 1m 1d');
assert.strictEqual(formatDuration(90061), '1h 1j 1m 1d');
assert.strictEqual(formatDuration(-10), '0j 0m 0d');
assert.strictEqual(formatBytes(1024), '1.0 KB');
assert.strictEqual(formatBytes(0), '0 B');
assert.strictEqual(formatBytes(-10), '0 B');
assert.strictEqual(formatBytes(1024 * 1024), '1.0 MB');
assert.strictEqual(getInteractionLatencyMs({ createdTimestamp: 'x' }), null);
assert.strictEqual(getInteractionLatencyMs({ createdTimestamp: -100 }), null);
assert.ok(getInteractionLatencyMs({ createdTimestamp: Date.now() - 50 }) >= 0);
assert.strictEqual(formatRuntimeInfo({ platform: 'linux', pid: 1234 }), 'linux | pid:1234');
assert.ok(formatRuntimeInfo({ platform: 'darwin', pid: 'invalid' }).startsWith('darwin | pid:'));
assert.ok(formatRuntimeInfo({ platform: '   ', pid: 777 }).startsWith(`${process.platform} | pid:777`));
assert.strictEqual(
  formatRuntimeInfo({ platform: 'win32', pid: -5 }),
  `win32 | pid:${process.pid}`,
  'formatRuntimeInfo should fallback to process pid when provided pid is negative'
);
assert.strictEqual(
  formatRuntimeInfo({ platform: 'win32', pid: 88.9 }),
  'win32 | pid:88',
  'formatRuntimeInfo should floor floating pid values'
);

console.log('metrics-format.test.js passed');
