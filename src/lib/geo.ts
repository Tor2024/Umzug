// Геокодирование и маршрут (Э3/D4).
// Каскад (D4.8): Photon → Nominatim → Nominatim+", Deutschland" → очистка адреса → fallback по городу.
// Маршрут: Google Distance Matrix (если maps.api_key) → OSRM. Таймауты 5–6 с.
// Ключ maps.api_key НИКОГДА не возвращается в ответах и не попадает в снимок (D4.3).

export interface RouteResult {
  km: number;          // округлено до 0.1
  minutes: number;     // целые минуты
  provider: "google" | "osrm" | "fallback";
  geometry?: [number, number][]; // [lat, lon] polyline для карты (Leaflet)
  error?: string;      // человекочитаемо, без стектрейсов (D4.11)
}

const ADDR_MAX = 200;
const TIMEOUT_MS = 6000;

export function validAddress(a: string): boolean {
  return a.trim().length >= 3 && a.trim().length <= ADDR_MAX;
}

interface GeoPoint {
  lat: number;
  lon: number;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Moving-Assistant-Demo/1.0 (route calculator)", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// --- Стратегии геокодирования (по одной, каскад в geocode) -----------------

async function geocodePhoton(q: string): Promise<GeoPoint | null> {
  const j = await fetchJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=de`) as
    { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { country?: string } }> } | null;
  const f = j?.features?.[0];
  const lonlat = f?.geometry?.coordinates;
  if (!lonlat || f?.properties?.country !== "Germany") return null;
  return { lat: lonlat[1], lon: lonlat[0] };
}

async function geocodeNominatim(q: string): Promise<GeoPoint | null> {
  const j = await fetchJson(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}&countrycodes=de`,
  ) as Array<{ lat: string; lon: string }> | null;
  if (!j?.[0]) return null;
  const lat = Number(j[0].lat), lon = Number(j[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Очистка адреса: этажи/строения мешают геокодеру. */
function cleanupAddress(q: string): string {
  return q
    .replace(/\b\d+\.\s*OG\b/gi, "")
    .replace(/\bEG\b/gi, "")
    .replace(/\bDG\b/gi, "")
    .replace(/\bHinterhaus\b/gi, "")
    .replace(/,\s*,/g, ",")
    .trim();
}

/** Fallback по городу: последняя часть после запятой (или вторая с конца, если последняя — почтовый индекс). */
function cityOf(q: string): string {
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return q.trim();
  const last = parts[parts.length - 1];
  if (/^\d{4,6}$/.test(last) && parts.length >= 2) return parts[parts.length - 2];
  return last;
}

export async function geocode(query: string): Promise<GeoPoint | null> {
  const q = query.trim();
  if (!validAddress(q)) return null;
  const attempts: Array<() => Promise<GeoPoint | null>> = [
    () => geocodePhoton(q),
    () => geocodeNominatim(q),
    () => geocodeNominatim(`${q}, Deutschland`),
    () => {
      const c = cleanupAddress(q);
      return c !== q ? geocodeNominatim(c) : Promise.resolve(null);
    },
  ];
  for (const attempt of attempts) {
    const p = await attempt();
    if (p) return p;
  }
  // Fallback по городу (последняя ступень; D4.8)
  const city = cityOf(q);
  if (city && city !== q) {
    return (await geocodePhoton(city)) ?? (await geocodeNominatim(`${city}, Deutschland`));
  }
  return null;
}

// --- Маршрут ---------------------------------------------------------------

async function googleDistanceMatrix(from: GeoPoint, to: GeoPoint, apiKey: string): Promise<RouteResult | null> {
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json?` +
    `origins=${from.lat},${from.lon}&destinations=${to.lat},${to.lon}` +
    `&mode=driving&region=de&key=${encodeURIComponent(apiKey)}`;
  const j = await fetchJson(url) as
    { status?: string; rows?: Array<{ elements?: Array<{ status?: string; distance?: { value?: number }; duration?: { value?: number } }> }> } | null;
  const el = j?.rows?.[0]?.elements?.[0];
  const dist = el?.distance?.value;
  const dur = el?.duration?.value;
  if (j?.status !== "OK" || el?.status !== "OK" || dist === undefined || dur === undefined) return null;
  return {
    km: Math.round((dist / 1000) * 10) / 10,
    minutes: Math.round(dur / 60),
    provider: "google",
  };
}

async function osrmRoute(from: GeoPoint, to: GeoPoint): Promise<RouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const j = await fetchJson(url) as
    { code?: string; routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: number[][] } }> } | null;
  if (j?.code !== "Ok" || !j.routes?.[0]) return null;
  const r = j.routes[0];
  const dist = r.distance;
  const dur = r.duration;
  if (dist === undefined || dur === undefined) return null;
  // geometry [lon,lat] → [lat,lon] для Leaflet; прореживание точек (~каждая 5-я) для лёгкого polyline
  const coords = r.geometry?.coordinates;
  const geometry: [number, number][] | undefined = coords
    ? (coords.filter((_, i) => i % 5 === 0 || i === coords.length - 1) as [number, number][]).map(([lon, lat]) => [lat, lon])
    : undefined;
  return {
    km: Math.round((dist / 1000) * 10) / 10,
    minutes: Math.round(dur / 60),
    provider: "osrm",
    geometry,
  };
}

/**
 * Полный расчёт маршрута: Google (если ключ) → OSRM → null (заказ не создаётся, D4.2).
 * Ошибки — человекочитаемые, без деталей ключа.
 */
export async function resolveRoute(fromText: string, toText: string, apiKey: string | undefined): Promise<RouteResult | null> {
  if (!validAddress(fromText) || !validAddress(toText)) {
    return { km: 0, minutes: 0, provider: "fallback", error: "Адрес слишком короткий или слишком длинный (3–200 символов)." };
  }
  const [from, to] = await Promise.all([geocode(fromText), geocode(toText)]);
  if (!from) return { km: 0, minutes: 0, provider: "fallback", error: `Адрес отправления не найден: «${fromText.slice(0, 80)}».` };
  if (!to) return { km: 0, minutes: 0, provider: "fallback", error: `Адрес прибытия не найден: «${toText.slice(0, 80)}».` };
  if (apiKey) {
    const g = await googleDistanceMatrix(from, to, apiKey);
    if (g) return g;
  }
  const o = await osrmRoute(from, to);
  if (o) return o;
  return { km: 0, minutes: 0, provider: "fallback", error: "Сервисы маршрутов недоступны. Попробуйте позже." };
}
