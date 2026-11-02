"use client";

// №9-расширение: карта последней позиции экипажа (только для enroute-заказов).
// Позиция = последний чек-поинт с координатами (trip_checkpoints.lat/lon).
// Маршрут (route.geometry от OSRM) рисуется той же polyline, что и в RouteMap,
// позиция экипажа — отдельный маркер с popup «Экипаж здесь · <время>».

import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";

// Те же CDN-иконки, что в route-map.tsx (фикс путей иконок Leaflet в бандлерах)
const pinIcon = L.icon({ iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41] });
const crewIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41] });

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points).pad(0.15));
  }, [map, points]);
  return null;
}

export interface CrewMapProps {
  geometry: [number, number][] | null; // маршрут [lat, lon] (route.geometry) — может отсутствовать
  crew: { lat: number; lon: number; at: number; cpLabel: string }; // последняя позиция с координатами
  fromText: string;
  toText: string;
  height?: number;
}

export default function CrewMap({ geometry, crew, fromText, toText, height = 240 }: CrewMapProps) {
  const pos: [number, number] = [crew.lat, crew.lon];
  // Центр: вокруг позиции экипажа; если есть маршрут — подгоняем под весь маршрут
  const center: [number, number] = geometry?.length
    ? [(geometry[0][0] + geometry[geometry.length - 1][0]) / 2, (geometry[0][1] + geometry[geometry.length - 1][1]) / 2]
    : pos;
  const fitPoints: [number, number][] = geometry?.length ? [...geometry, pos] : [pos];

  return (
    <div className="overflow-hidden rounded-container border border-line" style={{ height }}>
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {geometry && geometry.length >= 2 && (
          <Polyline positions={geometry} pathOptions={{ color: "#ea580c", weight: 4, opacity: 0.85 }} />
        )}
        {geometry && geometry.length >= 2 && (
          <>
            <Marker position={geometry[0]} icon={pinIcon}><Popup>Откуда: {fromText}</Popup></Marker>
            <Marker position={geometry[geometry.length - 1]} icon={pinIcon}><Popup>Куда: {toText}</Popup></Marker>
          </>
        )}
        <Marker position={pos} icon={crewIcon}>
          <Popup>
            Экипаж здесь · {crew.cpLabel} · {new Date(crew.at * 1000).toLocaleString("de-DE")}
          </Popup>
        </Marker>
        <FitBounds points={fitPoints} />
      </MapContainer>
    </div>
  );
}
