// Одноразовый тест: рендер фирменного бланка в HTML-файл для визуальной проверки.
import { writeFileSync } from "node:fs";

// Минимальная копия brandedShell-логики — импорт TS из node не работает, поэтому
// просто вызовем через npx tsx (tsx резолвит TS).
const mod = await import("../src/lib/email.ts");
const html = mod.threadMessageTemplate("Анна", "MS-2026-8941", "Наша команда", "Добрый день! Подтверждаем дату переезда — экипаж будет у вас в 8:00. Если появятся вопросы, напишите нам в переписке.");
writeFileSync("test-email.html", html, "utf8");
console.log("OK test-email.html", html.length);
