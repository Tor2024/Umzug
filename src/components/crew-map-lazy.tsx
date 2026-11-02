"use client";

// SSR-безопасная обёртка над CrewMap: next/dynamic + ssr:false (Leaflet требует window).
// Показывает карту только когда есть позиция экипажа (lat/lon последнего чек-поинта).

import dynamic from "next/dynamic";
import type { CrewMapProps } from "./crew-map";

const CrewMapInner = dynamic(() => import("./crew-map"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center rounded-container border border-line bg-surface-2 text-sm font-medium text-ink" style={{ height: 240 }}>
      Загрузка карты…
    </div>
  ),
});

export default function CrewMapLazy(props: CrewMapProps) {
  if (!props.crew) return null;
  return <CrewMapInner {...props} />;
}
