const assert = require('node:assert');
const CooldownManager = require('../src/utils/cooldown');

const manager = new CooldownManager();
const key = 'ping:user123';

const first = manager.check(key, 1000);
assert.strictEqual(first.allowed, true, 'First request should pass');

const second = manager.check(key, 1000);
assert.strictEqual(second.allowed, false, 'Second request should be blocked by cooldown');
assert.ok(second.retryAfterMs > 0, 'Retry time should be greater than 0');

const zeroCooldown = manager.check('zero:user123', -100);
assert.strictEqual(zeroCooldown.allowed, true, 'Negative cooldown should be normalized to 0');

console.log('cooldown.test.js passed');
