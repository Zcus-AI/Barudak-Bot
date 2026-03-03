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

async function testBenignUnknownInteractionErrorDoesNotThrow() {
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-3' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {
      const err = new Error('Unknown interaction');
      err.code = 10062;
      throw err;
    },
    followUp: async () => {
      throw new Error('followUp should not be called');
    }
  };

  const client = {
    commands: new Map([
      [
        'ping',
        {
          execute: async () => {
            throw new Error('forced command failure');
          }
        }
      ]
    ]),
    cooldowns: {}
  };

  await assert.doesNotReject(() => interactionEvent.execute(interaction, client));
}

async function testDeferredInteractionUsesFollowUpOnError() {
  let followUpPayload = null;
  let replyCalled = false;

  const interaction = {
    commandName: 'ping',
    user: { id: 'user-4' },
    replied: false,
    deferred: true,
    isChatInputCommand: () => true,
    reply: async () => {
      replyCalled = true;
    },
    followUp: async (payload) => {
      followUpPayload = payload;
    }
  };

  const client = {
    commands: new Map([
      [
        'ping',
        {
          execute: async () => {
            throw new Error('deferred-command-failure');
          }
        }
      ]
    ]),
    cooldowns: {}
  };

  await interactionEvent.execute(interaction, client);
  assert.strictEqual(replyCalled, false, 'Deferred interaction should not call reply on command error');
  assert.ok(followUpPayload, 'Deferred interaction should call followUp on command error');
  assert.strictEqual(followUpPayload.ephemeral, true, 'Error followUp should stay ephemeral');
}

async function testBenignAlreadyAcknowledgedFollowUpErrorDoesNotThrow() {
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-5' },
    replied: true,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {
      throw new Error('reply should not be called');
    },
    followUp: async () => {
      const err = new Error('Interaction has already been acknowledged.');
      err.code = 40060;
      throw err;
    }
  };

  const client = {
    commands: new Map([
      [
        'ping',
        {
          execute: async () => {
            throw new Error('forced command failure 2');
          }
        }
      ]
    ]),
    cooldowns: {}
  };

  await assert.doesNotReject(() => interactionEvent.execute(interaction, client));
}

async function testInvalidCommandNameIsIgnoredSafely() {
  let executed = false;
  const interaction = {
    commandName: '   ',
    user: { id: 'user-6' },
    isChatInputCommand: () => true,
    replied: false,
    deferred: false,
    reply: async () => {
      throw new Error('reply should not be called');
    }
  };

  const client = {
    commands: new Map([
      ['ping', { execute: async () => { executed = true; } }]
    ]),
    cooldowns: {}
  };

  await interactionEvent.execute(interaction, client);
  assert.strictEqual(executed, false, 'Invalid commandName should be ignored');
}

async function testMissingCommandRegistryIsIgnoredSafely() {
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-7' },
    isChatInputCommand: () => true,
    replied: false,
    deferred: false,
    reply: async () => {
      throw new Error('reply should not be called');
    }
  };

  const client = { cooldowns: {} };
  await assert.doesNotReject(() => interactionEvent.execute(interaction, client));
}

async function testCooldownReplyBenignErrorDoesNotThrow() {
  const interaction = {
    commandName: 'ping',
    user: { id: 'user-8' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {
      const err = new Error('Unknown interaction');
      err.code = 10062;
      throw err;
    }
  };

  const client = {
    commands: new Map([
      ['ping', { cooldownMs: 1000, execute: async () => {} }]
    ]),
    cooldowns: {
      normalizeCooldownMs: () => 1000,
      check: () => ({ allowed: false, retryAfterMs: 500 })
    }
  };

  await assert.doesNotReject(() => interactionEvent.execute(interaction, client));
}

async function testSlowCommandTimingPathDoesNotThrow() {
  const originalNow = Date.now;
  const mockTimes = [1000, 2505];
  Date.now = () => (mockTimes.length > 0 ? mockTimes.shift() : 2505);

  const interaction = {
    commandName: 'ping',
    user: { id: 'user-9' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {}
  };

  const client = {
    commands: new Map([
      ['ping', { execute: async () => {} }]
    ]),
    cooldowns: {}
  };

  try {
    await assert.doesNotReject(() => interactionEvent.execute(interaction, client));
  } finally {
    Date.now = originalNow;
  }
}

async function testCommandNameWithSpacesIsNormalized() {
  let executed = false;
  const interaction = {
    commandName: '  ping  ',
    user: { id: 'user-10' },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {}
  };

  const client = {
    commands: new Map([
      [
        'ping',
        {
          execute: async () => {
            executed = true;
          }
        }
      ]
    ]),
    cooldowns: {}
  };

  await interactionEvent.execute(interaction, client);
  assert.strictEqual(executed, true, 'Trimmed commandName should resolve to registered command');
}

(async () => {
  await testCooldownFallbackWhenManagerMissing();
  await testCooldownBlockUsesMinimumRetryOneSecond();
  await testBenignUnknownInteractionErrorDoesNotThrow();
  await testDeferredInteractionUsesFollowUpOnError();
  await testBenignAlreadyAcknowledgedFollowUpErrorDoesNotThrow();
  await testInvalidCommandNameIsIgnoredSafely();
  await testMissingCommandRegistryIsIgnoredSafely();
  await testCooldownReplyBenignErrorDoesNotThrow();
  await testSlowCommandTimingPathDoesNotThrow();
  await testCommandNameWithSpacesIsNormalized();
  console.log('interaction-create.test.js passed');
})();
