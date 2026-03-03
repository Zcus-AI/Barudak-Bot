const assert = require('node:assert');
const interactionEvent = require('../src/events/interactionCreate');

async function testCooldownFallbackWhenManagerMissing() {
  let executed = false;
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-1' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {
      throw new Error('reply should not be called');
    }
  };

  const client = {
    commands: new Map([
      [
        'ping',
        {
          cooldownMs: 'invalid-number',
          execute: async () => {
            executed = true;
          }
        }
      ]
    ]),
    cooldowns: {}
  };

  await interactionEvent.execute(interaction, client);
  assert.strictEqual(executed, true, 'Command should still execute when cooldown manager is incomplete');
}

async function testCooldownBlockUsesMinimumRetryOneSecond() {
  let repliedPayload = null;
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-2' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async (payload) => {
      repliedPayload = payload;
    }
  };

  const client = {
    commands: new Map([
      [
        'ping',
        {
          cooldownMs: 1000,
          execute: async () => {
            throw new Error('execute should not run while blocked');
          }
        }
      ]
    ]),
    cooldowns: {
      normalizeCooldownMs: () => 1000,
      check: () => ({ allowed: false, retryAfterMs: 1 })
    }
  };

  await interactionEvent.execute(interaction, client);
  assert.ok(repliedPayload, 'Blocked cooldown should reply to user');
  assert.ok(repliedPayload.content.includes('1 detik'), 'Retry message should never show 0 detik');
}

(async () => {
  await testCooldownFallbackWhenManagerMissing();
  await testCooldownBlockUsesMinimumRetryOneSecond();
  console.log('interaction-create.test.js passed');
})();
