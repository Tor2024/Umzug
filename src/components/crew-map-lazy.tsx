"use client";

// SSR-безопасная обёртка над CrewMap: next/dynamic + ssr:false (Leaflet требует window).
// Показывает карту только когда есть позиция экипажа (lat/lon последнего чек-поинта).
// Локаль: locale prop ("ru" | "de"), дефолт "ru"; без пропа — авто-детект по pathname.

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { CrewMapProps } from "./crew-map";

const T = {
  ru: "Загрузка карты…",
  de: "Karte wird geladen…",
} as const;

const CrewMapInner = dynamic(() => import("./crew-map"), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-container border border-line bg-surface-2 text-sm font-medium text-ink"
      style={{ height: 240 }}
    >
      <FallbackText />
    </div>
  ),
});

function FallbackText() {
  const pathname = usePathname();
  return <>{T[pathname?.startsWith("/de") ? "de" : "ru"]}</>;
}

export default function CrewMapLazy({ locale = "ru", ...props }: CrewMapProps & { locale?: "ru" | "de" }) {
  // locale нужен для типов (стрип с пропсов) — fallback определяет локаль по pathname
  void locale;
  if (!props.crew) return null;
  return <CrewMapInner {...props} />;
}
