/**
 * PDF-документы (GoBD): счёт RE-, протокол приёмки, Kostenvoranschlag.
 * Генерация серверная (pdf-lib), UTF-8 через стандартный шрифт НЕ работает —
 * используем embedFont с набором глифов WinAnsi (кириллица поддержана в
 * StandardFonts только через кастомный TTF). Поэтому шрифт грузим из буфера
 * (интернализированный файл в src/lib/fonts). Если файл недоступен — fallback
 * на транслитерацию latin-эквиваленты НЕ делаем: кидаем понятную ошибку.
 *
 * Все суммы — целые центы; форматирование централизовано здесь (fmtEuro).
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "./site";
import fontkit from "@pdf-lib/fontkit";

let fontCache: Uint8Array | null = null;

/** Roboto Regular с кириллицей — грузим один раз. */
function fontBytes(): Uint8Array {
  if (!fontCache) {
    // Файл кладём в проект (см. scripts/fetch-fonts.mjs)
    const p = join(process.cwd(), "src", "lib", "fonts", "Roboto-Regular.ttf");
    fontCache = new Uint8Array(readFileSync(p));
  }
  return fontCache;
}

let boldCache: Uint8Array | null = null;

function boldBytes(): Uint8Array {
  if (!boldCache) {
    const p = join(process.cwd(), "src", "lib", "fonts", "Roboto-Bold.ttf");
    boldCache = new Uint8Array(readFileSync(p));
  }
  return boldCache;
}

/** euro центы → "1 234,56 €" (немецкий формат). */
export function fmtEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

/** ISO-дата → "01.11.2026". */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const ACCENT = rgb(0.918, 0.478, 0.157); // #EA7A28 — фирменный оранжевый (логотип)
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.82, 0.82, 0.86);

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const M = 56; // поля
const CW = PAGE_W - 2 * M; // ширина контента

/** Краткие реквизиты отправителя для шапки. */
function senderBlock(): string[] {
  return [
    SITE.name,
    SITE.address,
    `Tel: ${SITE.phone} · ${SITE.email}`,
    SITE.vatId.includes("демо") || SITE.vatId.includes("Demo") ? "USt-IdNr.: wird ergänzt" : `USt-IdNr.: ${SITE.vatId}`,
  ];
}

type Item = { label: string; amount: number };

/** Общая рамка документа: шапка отправителя, получатель, title, items, итоги, футер. */
async function buildDoc(opts: {
  title: string;
  metaLeft: string[];   // строки левого блока метаданных (номер, дата, статус...)
  metaRight?: string[]; // строки правого блока (срок, заказ...)
  customer: string[];   // блок получателя
  items: Item[];        // позиции
  totals: Item[];       // итоги (нетто, НДС, брутто и т.п.)
  footerNote?: string;  // платёжные реквизиты/условия
  signatureHash?: string;
  signatureName?: string;
  signatureDate?: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(opts.title);
  pdf.setProducer("Umzug Assistant");
  pdf.setCreator(SITE.name);

  const font = await pdf.embedFont(fontBytes(), { subset: true });
  const bold = await pdf.embedFont(boldBytes(), { subset: true });

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; bold?: boolean; color?: typeof INK } = {},
  ) => {
    page.drawText(s, {
      x,
      y: yy,
      size: o.size ?? 10,
      font: o.bold ? bold : font,
      color: o.color ?? INK,
    });
  };

  // --- Шапка: отправитель справа сверху, логотип-текст слева
  text(SITE.name, M, y, { size: 16, bold: true, color: ACCENT });
  y -= 14;
  const sender = senderBlock();
  for (const line of sender) {
    text(line, M, y, { size: 8, color: MUTED });
    y -= 10;
  }

  // Линия
  page.drawLine({
    start: { x: M, y: y + 4 },
    end: { x: PAGE_W - M, y: y + 4 },
    thickness: 1,
    color: LINE,
  });
  y -= 22;

  // --- Получатель + мета
  const custTop = y;
  // Получатель слева
  let cy = y;
  for (const line of opts.customer) {
    text(line, M, cy, { size: line === opts.customer[0] ? 11 : 9, bold: line === opts.customer[0] });
    cy -= 12;
  }

  // Мета справа
  let my = y;
  const metaSize = 9;
  for (const line of opts.metaLeft) {
    text(line, PAGE_W - M - 170, my, { size: metaSize, color: MUTED });
    my -= 11;
  }
  if (opts.metaRight) {
    let ry = y;
    for (const line of opts.metaRight) {
      text(line, PAGE_W - M - 170, ry, { size: metaSize, color: MUTED });
      ry -= 11;
    }
  }

  y = Math.min(cy, my) - 18;

  // --- Заголовок
  text(opts.title, M, y, { size: 15, bold: true });
  y -= 26;

  // --- Позиции
  const drawItems = (header: string | null, items: Item[], opts2?: { bold?: boolean }) => {
    if (header) {
      text(header, M, y, { size: 8, color: MUTED, bold: true });
      y -= 14;
    }
    for (const it of items) {
      const isBold = opts2?.bold;
      text(it.label, M, y, { size: 10, bold: isBold });
      if (it.amount !== 0) {
        // amount=0 → информационная строка без суммы (маршрут, объёмы и т.п.)
        const amountStr = fmtEuro(it.amount);
        const w = font.widthOfTextAtSize(amountStr, 10);
        text(amountStr, PAGE_W - M - w, y, { size: 10, bold: isBold });
      }
      y -= 15;
    }
  };

  // Тонкая линия над позициями
  page.drawLine({
    start: { x: M, y: y + 6 },
    end: { x: PAGE_W - M, y: y + 6 },
    thickness: 0.5,
    color: LINE,
  });
  y -= 4;

  drawItems(null, opts.items);
  y -= 6;

  // Итоги
  page.drawLine({
    start: { x: M, y: y + 8 },
    end: { x: PAGE_W - M, y: y + 8 },
    thickness: 0.5,
    color: LINE,
  });
  y -= 6;
  drawItems(null, opts.totals, { bold: true });

  y -= 10;

  // --- Подпись (для протокола)
  if (opts.signatureHash) {
    page.drawLine({
      start: { x: M, y: y + 10 },
      end: { x: PAGE_W - M, y: y + 10 },
      thickness: 0.5,
      color: LINE,
    });
    y -= 6;
    text("Protokoll-Integrität (SHA-256-Kette)", M, y, { size: 8, color: MUTED, bold: true });
    y -= 12;
    text(`Hash: ${opts.signatureHash}`, M, y, { size: 8, color: MUTED });
    y -= 12;
    if (opts.signatureName) {
      text(`Unterschrift: ${opts.signatureName}`, M, y, { size: 9 });
      y -= 12;
    }
    if (opts.signatureDate) {
      text(`Datum: ${opts.signatureDate}`, M, y, { size: 9 });
      y -= 12;
    }
  }

  // --- Футер (условия)
  if (opts.footerNote) {
    const footerY = M + 40;
    page.drawLine({
      start: { x: M, y: footerY + 14 },
      end: { x: PAGE_W - M, y: footerY + 14 },
      thickness: 0.5,
      color: LINE,
    });
    // Многострочный футер
    const lines = wrapText(opts.footerNote, font, 7.5, CW);
    let fy = footerY;
    for (const l of lines) {
      text(l, M, fy, { size: 7.5, color: MUTED });
      fy -= 9;
    }
  }

  return pdf.save();
}

/** Перенос строк по ширине (грубый, по словам). */
function wrapText(s: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Публичные функции
// ---------------------------------------------------------------------------

export type InvoicePdfInput = {
  number: string;         // RE-2026-0001
  orderRef: string;       // MS-2026-8941
  customerName: string;
  customerEmail: string;
  routeFrom: string;
  routeTo: string;
  moveDate: string;
  lines: Item[];          // позиции из order_lines
  specLines: Item[];      // полная спецификация услуг (из снимка: класс, этажи, объём...)
  snapshotVersion: number; // версия снимка цены (ревизии D10)
  netCents: number;
  vatCents: number;
  vatPct: number;
  grossCents: number;
  paidCents: number;
  dueDate: string;
  cancelled?: boolean;
};

/** GoBD-счёт. */
export function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const totals: Item[] = [
    { label: "Netto", amount: input.netCents },
    { label: `USt ${input.vatPct}%`, amount: input.vatCents },
    { label: "Gesamtbetrag (brutto)", amount: input.grossCents },
  ];
  if (input.paidCents > 0) totals.push({ label: "Bereits gezahlt", amount: -input.paidCents });
  totals.push({ label: "Restbetrag", amount: input.grossCents - input.paidCents });

  return buildDoc({
    title: input.cancelled ? `Rechnung ${input.number} (STORNIERT)` : `Rechnung ${input.number}`,
    metaLeft: [
      `Rechnungsnummer: ${input.number}`,
      `Auftrag: ${input.orderRef}`,
      `Rechnungsdatum: ${fmtDate(todayIso())}`,
      `Fällig am: ${fmtDate(input.dueDate)}`,
      `Preisbasis: Version ${input.snapshotVersion}`,
    ],
    customer: [
      input.customerName,
      "",
      input.routeFrom,
      `– ${input.routeTo}`,
      `Umzugsdatum: ${fmtDate(input.moveDate)}`,
    ],
    items: [...input.lines, ...input.specLines],
    totals,
    footerNote:
      "Zahlbar bis zum genannten Fälligkeitsdatum ohne Abzug. " +
      "Diese Rechnung wurde elektronisch erstellt und ist gemäß GoBD revisionssicher nummeriert. " +
      `Eingegangene Zahlungen werden im Zahlungsregister (Zahlungsmethode, Datum) festgehalten. ${SITE.liability}`,
  });
}

export type ProtocolPdfInput = {
  orderRef: string;
  customerName: string;
  routeFrom: string;
  routeTo: string;
  moveDate: string;
  plannedM3: number;
  factM3: number;
  deviationM3: number;
  checklist: string[];   // названия отмеченных пунктов
  notes: string;
  signature: string;
  hash: string;
  prevHash: string;
  signedAt: number;      // unix
};

/** Протокол приёмки с подписью и hash-цепочкой. */
export function renderProtocolPdf(input: ProtocolPdfInput): Promise<Uint8Array> {
  const items: Item[] = [
    { label: `Geplantes Volumen: ${input.plannedM3} m³`, amount: 0 },
    { label: `Tatsächlich geladen: ${input.factM3} m³`, amount: 0 },
    { label: `Abweichung: ${input.deviationM3 > 0 ? "+" : ""}${input.deviationM3} m³`, amount: 0 },
  ];
  return buildDoc({
    title: `Ladeprotokoll ${input.orderRef}`,
    metaLeft: [
      `Auftrag: ${input.orderRef}`,
      `Datum: ${fmtDate(unixToIso(input.signedAt))}`,
    ],
    customer: [
      input.customerName,
      "",
      input.routeFrom,
      `– ${input.routeTo}`,
      `Umzugsdatum: ${fmtDate(input.moveDate)}`,
    ],
    items,
    totals: [],
    footerNote: input.notes
      ? `Notizen: ${input.notes}`
      : "Keine Anmerkungen. Dieses Protokoll ist Teil der SHA-256-Verkettung und kann nicht nachträglich geändert werden.",
    signatureHash: input.hash,
    signatureName: input.signature,
    signatureDate: fmtDate(unixToIso(input.signedAt)),
  });
}

export type QuotePdfInput = {
  orderRef?: string;      // есть, если заявка уже создана
  customerName?: string;
  routeFrom: string;
  routeTo: string;
  moveDate: string;
  volumeM3: number;
  distanceKm: number;
  lines: Item[];
  netCents: number;
  vatCents: number;
  vatPct: number;
  grossCents: number;
  depositCents: number;
  validUntil: string;     // ISO
};

/** Kostenvoranschlag (предварительная оценка — для /calc до создания заявки). */
export function renderQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  return buildDoc({
    title: "Kostenvoranschlag",
    metaLeft: [
      input.orderRef ? `Vorgang: ${input.orderRef}` : "Vorgang: —",
      `Datum: ${fmtDate(todayIso())}`,
      `Gültig bis: ${fmtDate(input.validUntil)}`,
    ],
    customer: input.customerName ? [input.customerName, ""] : [""],
    items: [
      { label: `${input.routeFrom} – ${input.routeTo}`, amount: 0 },
      { label: `Umzugsdatum: ${fmtDate(input.moveDate)} · ${input.volumeM3} m³ · ${input.distanceKm} km`, amount: 0 },
    ],
    totals: [
      { label: "Netto", amount: input.netCents },
      { label: `USt ${input.vatPct}%`, amount: input.vatCents },
      { label: "Gesamtbetrag (brutto)", amount: input.grossCents },
      { label: "Anzahlung (30%)", amount: input.depositCents },
    ],
    footerNote:
      "Dieser Kostenvoranschlag ist unverbindlich. Der verbindliche Preis wird nach Auftragserteilung im Auftrag fixiert und ist für die genannte Gültigkeitsdauer garantiert.",
  });
}

// ---------------------------------------------------------------------------
// Спецификация услуг из снимка (полный вид заказа; последняя версия = orders.snapshot)
// ---------------------------------------------------------------------------

/** Config-снимок — минимальный тип для спецификации. */
type SpecConfig = {
  vehicleClass: string;
  classForced?: boolean;
  volumeM3: number;
  distanceKm: number;
  floorsFrom: number;
  floorsTo: number;
  elevatorFrom: boolean;
  elevatorTo: boolean;
  boxes?: number;
  kitchen?: boolean;
  furnitureItems?: number;
  packHours?: number;
  hvzZones?: number;
  express?: boolean;
  sharedLoad?: boolean;
  returnKm?: number;
};

/**
 * Нормализация лейблов позиций из БД: заказы, созданные до денизанизации,
 * хранят русские подписи ("Экипаж", "Дорога", "LKW 7,5 т" и т.п.) —
 * маппим их на немецкие, чтобы PDF не содержал русских слов.
 */
const LABEL_DE: Array<[RegExp, string]> = [
  [/^База \((.+)\)$/, "Grundpreis ($1)"],
  [/^База/, "Grundpreis"],
  [/^Экипаж/, "Ladepersonal (Einsatzstunden)"],
  [/^Дорога/, "Fahrtstrecke"],
  [/^Доп\. объём/, "Zusatzvolumen"],
  [/^Подъём/, "Tragearbeit Auszug"],
  [/^Спуск/, "Tragearbeit Einzug"],
  [/^Картоны/, "Kartons"],
  [/^Упаковка/, "Verpackungsservice"],
  [/^Сборка кухни/, "Küchenmontage"],
  [/^Разбор\/сбор мебели/, "Möbelauf-/abbau"],
  [/^Лифт$/, "Aufzug"],
];

export function deLabel(label: string): string {
  let out = label;
  for (const [re, sub] of LABEL_DE) {
    if (re.test(out)) { out = out.replace(re, sub); break; }
  }
  // Кириллические литеры в единицах: "LKW 7,5 т" → "LKW 7,5 t", "0 этаж)" → "0 OG)"
  out = out.replace(/т(?=[)\s]|$)/g, "t");
  return out;
}

/** Полная спецификация услуг (немецкие подписи; amount=0 → строка без суммы). */
export function buildSpecLines(cfg: SpecConfig, classLabel: string): Item[] {  const spec: Item[] = [
    { label: `Fahrzeugklasse: ${classLabel}${cfg.classForced ? " (handgeschaltet)" : ""}`, amount: 0 },
    { label: `Umzugsvolumen: ${cfg.volumeM3} m³ · Entfernung: ca. ${cfg.distanceKm} km`, amount: 0 },
    { label: `Etagen: Auszug ${cfg.floorsFrom}. OG${cfg.elevatorFrom ? " (mit Aufzug)" : ""} – Einzug ${cfg.floorsTo}. OG${cfg.elevatorTo ? " (mit Aufzug)" : ""}`, amount: 0 },
  ];
  if (cfg.boxes && cfg.boxes > 0) spec.push({ label: `Kartons: ${cfg.boxes} Stk.`, amount: 0 });
  if (cfg.packHours && cfg.packHours > 0) spec.push({ label: `Verpackungsservice: ${cfg.packHours} h`, amount: 0 });
  if (cfg.kitchen) spec.push({ label: "Küchenmontage: ja", amount: 0 });
  if (cfg.furnitureItems && cfg.furnitureItems > 0) spec.push({ label: `Möbelauf-/abbau: ${cfg.furnitureItems} Stk.`, amount: 0 });
  if (cfg.hvzZones && cfg.hvzZones > 0) spec.push({ label: `Halteverbotszonen: ${cfg.hvzZones}`, amount: 0 });
  if (cfg.returnKm && cfg.returnKm > 0) spec.push({ label: `Rückfahrt zur Basis (Leerfahrt): ca. ${cfg.returnKm} km`, amount: 0 });
  const opts: string[] = [];
  if (cfg.express) opts.push("Express");
  if (cfg.sharedLoad) opts.push("Teilladung (Rabatt)");
  if (opts.length > 0) spec.push({ label: `Optionen: ${opts.join(", ")}`, amount: 0 });
  return spec;
}

// ---------------------------------------------------------------------------
// Хелперы дат (локальные, чтобы не тянуть зависимости)
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

function unixToIso(unix: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(unix * 1000));
}
