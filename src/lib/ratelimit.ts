// Tiny in-memory rate limiter for access-code attempts.
// Keyed by client IP: after MAX_FAILS failed attempts inside WINDOW_MS the
// IP is locked out until the window slides past. Good enough for a small
// private team app; swap for Redis if this ever runs on multiple servers.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

type Bucket = { fails: number[] };

const buckets = new Map<string, Bucket>();

function prune(bucket: Bucket, now: number) {
  bucket.fails = bucket.fails.filter((t) => now - t < WINDOW_MS);
}

export function isLockedOut(key: string): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  prune(bucket, Date.now());
  return bucket.fails.length >= MAX_FAILS;
}

export function recordFailure(key: string) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { fails: [] };
  prune(bucket, now);
  bucket.fails.push(now);
  buckets.set(key, bucket);
}

export function clearFailures(key: string) {
  buckets.delete(key);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}
