// Патчит все getDb() вызовы на await getDb() с сохранением UTF-8 (кириллица).
// Пропускает: `function getDb`, `await getDb()`, `void getDb()`.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

let patched = 0;
let skipped = 0;

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === ".next" || e === ".git") continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(e)) {
      let src = readFileSync(p, "utf8");
      let n = src.replace(/(?<!await\s)(?<!function\s)\bgetDb\(\)/g, "await getDb()");
      // Убираем двойные await, если вдруг
      n = n.replace(/await\s+await\s+/g, "await ");
      if (n !== src) {
        writeFileSync(p, n, "utf8");
        patched++;
        console.log("PATCHED:", p);
      } else skipped++;
    }
  }
}

walk("src");
console.log("DONE. patched:", patched, "skipped:", skipped);
