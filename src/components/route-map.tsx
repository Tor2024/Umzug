"use client";

// Интерактивная карта маршрута (Leaflet + react-leaflet, без API-ключей).
// Геометрия приходит из route.geometry ([lat,lon][], OSRM geojson, прорежено в geo.ts).
// Динамический import + ssr:false через next/dynamic — Leaflet требует window.

import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Стандартные пины Leaflet ломаются в бандлерах (путь к иконкам) — фикс через CDN-иконки
const iconA = L.icon({ iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41] });
const iconB = L.icon({ iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41] });

/** Подгонка zoom/центра под маршрут. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points).pad(0.15));
  }, [map, points]);
  return null;
}

export interface RouteMapProps {
  geometry: [number, number][]; // [lat, lon]
  fromText: string;
  toText: string;
  height?: number; // px, default 260
  locale?: "ru" | "de";
}

const T = {
  ru: { from: "Откуда", to: "Куда" },
  de: { from: "Von", to: "Nach" },
} as const;

export default function RouteMap({ geometry, fromText, toText, height = 260, locale = "ru" }: RouteMapProps) {
  const t = T[locale];
  const start = geometry[0];
  const end = geometry[geometry.length - 1];
  const center: [number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  return (
    <div className="overflow-hidden rounded-container border border-line" style={{ height }}>
      <MapContainer center={center} zoom={6} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={geometry} pathOptions={{ color: "#ea580c", weight: 4, opacity: 0.85 }} />
        <Marker position={start} icon={iconA}><Popup>{t.from}: {fromText}</Popup></Marker>
        <Marker position={end} icon={iconB}><Popup>{t.to}: {toText}</Popup></Marker>
        <FitBounds points={geometry} />
      </MapContainer>
    </div>
  );
}
