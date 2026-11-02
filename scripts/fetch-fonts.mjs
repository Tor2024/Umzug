/**
 * Скачивает Roboto Regular/Bold (с кириллицей) в src/lib/fonts/.
 * Запуск: node scripts/fetch-fonts.mjs
 * Источник: google/fonts GitHub (OFL-лицензия).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "src", "lib", "fonts");
mkdirSync(DIR, { recursive: true });

const FILES = {
  "Roboto-Regular.ttf":
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf",
  "Roboto-Bold.ttf":
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf",
};

// Roboto в google/fonts — variable-шрифт одним файлом. pdf-lib не умеет
// variable-инстансы, поэтому берём статические из jakubfiala/… — нет, надёжнее:
// kite и статические Roboto из google/fonts apache/roboto (старая структура).
const STATIC = {
  "Roboto-Regular.ttf":
    "https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Regular.ttf",
  "Roboto-Bold.ttf":
    "https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Bold.ttf",
};

for (const [name, url] of Object.entries(STATIC)) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAIL ${name}: HTTP ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(DIR, name), buf);
  console.log(`OK ${name}: ${buf.length} bytes`);
}
