// Smoke-test rate-limit: 21 вызов /api/route подряд → 20-й+ должны дать 429.
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let last = 0;
for (let i = 1; i <= 21; i++) {
  const res = await fetch(`${BASE}/api/route?from=10115%20Berlin%20Torstra%C3%9Fe%201&to=80333%20M%C3%BCnchen%20Bahnhofplatz%201`);
  last = res.status;
  if (i <= 3 || i >= 19) console.log(i, res.status);
  res.body?.cancel();
}
console.log(last === 429 ? "RATE_LIMIT_OK" : `UNEXPECTED last=${last}`);
