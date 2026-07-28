'use strict';

class BoundedCache {
  constructor({ maxEntries = 500, ttlMs = 300_000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(String(key));
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(String(key));
      return undefined;
    }
    this.entries.delete(String(key));
    this.entries.set(String(key), entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    const normalizedKey = String(key);
    this.entries.delete(normalizedKey);
    this.entries.set(normalizedKey, { value, expiresAt: Date.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return value;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { BoundedCache };
