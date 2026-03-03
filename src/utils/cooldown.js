class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
  }

  check(key, cooldownMs) {
    const now = Date.now();
    const expiresAt = this.cooldowns.get(key) || 0;

    if (expiresAt > now) {
      return {
        allowed: false,
        retryAfterMs: expiresAt - now
      };
    }

    this.cooldowns.set(key, now + cooldownMs);
    return { allowed: true, retryAfterMs: 0 };
  }
}

module.exports = CooldownManager;
