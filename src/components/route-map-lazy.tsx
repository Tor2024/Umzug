"use client";

// SSR-безопасная обёртка над RouteMap: next/dynamic + ssr:false (Leaflet требует window).
// Рендерится только когда есть геометрия маршрута; иначе ничего не показывает.
// Локаль: locale prop ("ru" | "de"), дефолт "ru" — RU-поведение не меняется.
//
// ВАЖНО (key): key на RouteMapInner пересоздаёт компонент при смене маршрута —
// без него Leaflet падает «Map container is being reused by another instance»
// (MapContainer инициализируется на контейнере, уже занятом другим инстансом).

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { RouteMapProps } from "./route-map";

const T = {
  ru: "Загрузка карты…",
  de: "Karte wird geladen…",
} as const;

function FallbackText({ height }: { height: number }) {
  const pathname = usePathname();
  return (
    <div
      className="flex items-center justify-center rounded-container border border-line bg-surface-2 text-sm font-medium text-ink"
      style={{ height }}
    >
      {T[pathname?.startsWith("/de") ? "de" : "ru"]}
    </div>
  );
}

const RouteMapInner = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => <FallbackText height={260} />,
});

export default function RouteMapLazy({ locale = "ru", ...props }: RouteMapProps & { locale?: "ru" | "de" }) {
  // locale нужен для типов (стрип с пропсов) — fallback определяет локаль по pathname
  void locale;
  if (!props.geometry || props.geometry.length < 2) return null;
  const mapKey = `${props.fromText}|${props.toText}|${props.height ?? 260}`;
  return <RouteMapInner key={mapKey} {...props} />;
}
