import type { RequestHandler } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientKey(ip: string, prefix: string): string {
  return `${prefix}:${ip || "unknown"}`;
}

export function rateLimit(options: { windowMs: number; max: number; keyPrefix: string }): RequestHandler {
  return (req, res, next) => {
    if (buckets.size > 5000) {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const ip = req.requestMeta?.ip || req.ip || "unknown";
    const key = clientKey(ip, options.keyPrefix);
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ ok: false, message: "Too many attempts. Try again shortly." });
      return;
    }

    current.count += 1;
    next();
  };
}
