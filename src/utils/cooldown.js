class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
    this.checkCount = 0;
  }

  normalizeCooldownMs(cooldownMs) {
    const parsed = Number(cooldownMs);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.floor(parsed));
  }

  normalizeKey(key) {
    if (key === null || key === undefined) return '';
    return String(key).trim();
  }

  pruneExpired(now = Date.now()) {
    for (const [key, expiresAt] of this.cooldowns.entries()) {
      if (expiresAt <= now) this.cooldowns.delete(key);
    }
  }

  get size() {
    return this.cooldowns.size;
  }

  check(key, cooldownMs, now = Date.now()) {
    const safeKey = this.normalizeKey(key);
    const safeCooldown = this.normalizeCooldownMs(cooldownMs);

    if (!safeKey) {
      return {
        allowed: true,
        retryAfterMs: 0
      };
    }

    this.checkCount += 1;
    if (this.checkCount % 100 === 0) {
      this.pruneExpired(now);
    }

    if (safeCooldown === 0) {
      this.cooldowns.delete(safeKey);
      return { allowed: true, retryAfterMs: 0 };
    }

    const expiresAt = this.cooldowns.get(safeKey) || 0;
    if (expiresAt > now) {
      return {
        allowed: false,
        retryAfterMs: expiresAt - now
      };
    }

    this.cooldowns.set(safeKey, now + safeCooldown);
    return { allowed: true, retryAfterMs: 0 };
  }
}

module.exports = CooldownManager;
