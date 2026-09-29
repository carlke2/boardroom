interface MemoryEntry {
  value: string;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();

function read(key: string): MemoryEntry | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry;
}

export const otpStore = {
  get(key: string): string | null {
    return read(key)?.value ?? null;
  },
  set(key: string, value: string, ttlSeconds: number): void {
    memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  },
  setKeepingTtl(key: string, value: string): void {
    const existing = read(key);
    if (!existing) return;
    memory.set(key, { value, expiresAt: existing.expiresAt });
  },
  del(...keys: string[]): void {
    for (const key of keys) memory.delete(key);
  },
};
