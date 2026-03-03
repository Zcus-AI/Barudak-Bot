const assert = require('node:assert');
const CooldownManager = require('../src/utils/cooldown');

const manager = new CooldownManager();
const key = 'ping:user123';
const now = 1_000;

const first = manager.check(key, 1000, now);
assert.strictEqual(first.allowed, true, 'First request should pass');

const second = manager.check(key, 1000, now + 100);
assert.strictEqual(second.allowed, false, 'Second request should be blocked by cooldown');
assert.ok(second.retryAfterMs > 0, 'Retry time should be greater than 0');

const afterCooldown = manager.check(key, 1000, now + 1_100);
assert.strictEqual(afterCooldown.allowed, true, 'Request should pass after cooldown window');

const zeroCooldown = manager.check('zero:user123', -100, now);
assert.strictEqual(zeroCooldown.allowed, true, 'Negative cooldown should be normalized to 0');
assert.strictEqual(manager.size, 1, 'Zero/negative cooldown should not leave stale map entries');

const invalidKey = manager.check('   ', 5000, now);
assert.strictEqual(invalidKey.allowed, true, 'Empty key should be treated as no-cooldown key');
assert.strictEqual(manager.size, 1, 'Invalid key should not mutate internal map');

console.log('cooldown.test.js passed');
