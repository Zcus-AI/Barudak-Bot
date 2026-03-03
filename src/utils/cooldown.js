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

  normalizeNow(now) {
    const parsed = Number(now);
    if (!Number.isFinite(parsed) || parsed < 0) return Date.now();
    return parsed;
  }

  pruneExpired(now = Date.now()) {
    const safeNow = this.normalizeNow(now);
    for (const [key, expiresAt] of this.cooldowns.entries()) {
      if (expiresAt <= safeNow) this.cooldowns.delete(key);
    }
  }

  get size() {
    return this.cooldowns.size;
  }

  check(key, cooldownMs, now = Date.now()) {
    const safeNow = this.normalizeNow(now);
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
      this.pruneExpired(safeNow);
    }

    if (safeCooldown === 0) {
      this.cooldowns.delete(safeKey);
      return { allowed: true, retryAfterMs: 0 };
    }

    const expiresAt = this.cooldowns.get(safeKey) || 0;
    if (expiresAt > safeNow) {
      return {
        allowed: false,
        retryAfterMs: expiresAt - safeNow
      };
    }

    this.cooldowns.set(safeKey, safeNow + safeCooldown);
    return { allowed: true, retryAfterMs: 0 };
  }
}

module.exports = CooldownManager;
