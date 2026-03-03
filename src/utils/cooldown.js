class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
    this.checkCount = 0;
  }

  pruneExpired(now = Date.now()) {
    for (const [key, expiresAt] of this.cooldowns.entries()) {
      if (expiresAt <= now) this.cooldowns.delete(key);
    }
  }

  check(key, cooldownMs) {
    const now = Date.now();
    const safeCooldown = Math.max(0, Number(cooldownMs) || 0);

    this.checkCount += 1;
    if (this.checkCount % 100 === 0) {
      this.pruneExpired(now);
    }

    const expiresAt = this.cooldowns.get(key) || 0;
    if (expiresAt > now) {
      return {
        allowed: false,
        retryAfterMs: expiresAt - now
      };
    }

    this.cooldowns.set(key, now + safeCooldown);
    return { allowed: true, retryAfterMs: 0 };
  }
}

module.exports = CooldownManager;
