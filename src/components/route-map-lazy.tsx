"use client";

// SSR-безопасная обёртка над RouteMap: next/dynamic + ssr:false (Leaflet требует window).
// Рендерится только когда есть геометрия маршрута; иначе ничего не показывает.

import dynamic from "next/dynamic";
import type { RouteMapProps } from "./route-map";

const RouteMapInner = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center rounded-container border border-line bg-surface-2 text-sm font-medium text-ink" style={{ height: 260 }}>
      Загрузка карты…
    </div>
  ),
});

export default function RouteMapLazy(props: RouteMapProps) {
  if (!props.geometry || props.geometry.length < 2) return null;
  return <RouteMapInner {...props} />;
}
