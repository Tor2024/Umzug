// Rate limiting для публичных/лёгких API-роутов (слайдинг-окно, in-memory).
// In-memory достаточно: инстансов немного, лимит — грубая защита от скрейпа/абьюза,
// а не точный accounting. На Fluid Compute инстансы переиспользуются, модуль жив долго.

const WINDOW_MS = 60_000; // окно 1 минута

type Bucket = { hits: number[] };

// globalThis — чтобы бакеты выживали при hot-reload в dev и шарились в инстансе.
const g = globalThis as unknown as { __umzugRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__umzugRate ??= new Map());

export type RateResult = { ok: true } | { ok: false; retryAfterS: number };

/**
 * Проверка лимита: max запросов за WINDOW_MS на ключ (обычно ip:route).
 * Вызов должен происходить ДО обработки запроса.
 */
export function rateLimit(key: string, max: number): RateResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0] ?? now;
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)) };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  // Периодическая уборка пустых бакетов (каждые ~1000 вызовов)
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }
  return { ok: true };
}

/** IP клиента из заголовков Vercel/прокси с fallback на "anon". */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon"
  );
}
