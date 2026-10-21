// In-memory sliding-window rate limiter. One instance per app process.
// For multi-instance deployments swap the Map for Redis with the same interface.
export function createRateLimiter() {
  const hits = new Map();

  const live = (key, windowMs, now) => (hits.get(key) || []).filter((t) => now - t < windowMs);

  function count(key, windowMs) {
    return live(key, windowMs, Date.now()).length;
  }

  /** Record a hit; returns {ok:false, retryAfter} once max is reached. */
  function hit(key, max, windowMs) {
    const now = Date.now();
    const arr = live(key, windowMs, now);
    if (arr.length >= max) {
      hits.set(key, arr);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
    }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 50_000) {
      for (const [k, v] of hits) if (!v.length || now - v.at(-1) > 3_600_000) hits.delete(k);
    }
    return { ok: true };
  }

  const reset = (key) => hits.delete(key);

  function middleware({ name, max, windowMs, key = (req) => req.ip }) {
    return (req, res, next) => {
      const r = hit(`${name}:${key(req)}`, max, windowMs);
      if (!r.ok) return tooMany(res, r.retryAfter);
      next();
    };
  }

  return { hit, count, reset, middleware };
}

export function tooMany(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Too many attempts. Please wait a little and try again.', retryAfter });
}
