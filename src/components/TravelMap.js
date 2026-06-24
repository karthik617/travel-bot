"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// A self-contained DivIcon so we never depend on Leaflet's default marker PNGs
// (which break under bundlers). The pulsing ring sells the "live tracking" feel.
const backpackerIcon = L.divIcon({
  className: "elango-marker",
  html: `
    <div style="position:relative;width:34px;height:34px;">
      <span style="
        position:absolute;inset:0;border-radius:9999px;
        background:rgba(16,185,129,0.35);
        animation:elango-ping 1.6s cubic-bezier(0,0,0.2,1) infinite;">
      </span>
      <span style="
        position:absolute;top:7px;left:7px;width:20px;height:20px;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;border-radius:9999px;
        background:#059669;color:white;
        box-shadow:0 0 0 3px white,0 1px 4px rgba(0,0,0,0.4);">🎒</span>
    </div>
    <style>
      @keyframes elango-ping {
        75%,100% { transform: scale(2); opacity: 0; }
      }
    </style>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -16],
});

const TN_CENTER = [10.7905, 78.7047]; // Tamil Nadu center fallback.

/**
 * Client-side live map. Manages a Leaflet instance manually (instead of
 * react-leaflet's <MapContainer>) so that React Strict Mode's dev double-mount
 * — mount → unmount → mount — is handled cleanly: the unmount calls map.remove(),
 * which clears Leaflet's hold on the container so the next mount can re-init
 * without throwing "Map container is already initialized".
 */
export default function TravelMap({ lat, lon, city, landmark, path = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const haloRef = useRef(null);
  const lineRef = useRef(null);

  // Create the map exactly once per mount; tear it down fully on unmount.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;

    const hasPos = typeof lat === "number" && typeof lon === "number";
    const map = L.map(containerRef.current, {
      center: hasPos ? [lat, lon] : TN_CENTER,
      zoom: hasPos ? 11 : 7,
      scrollWheelZoom: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapRef.current = map;

    // Ensure correct sizing once the card has laid out.
    const raf = requestAnimationFrame(() => {
      if (mapRef.current === map) map.invalidateSize();
    });

    return () => {
      cancelAnimationFrame(raf);
      map.remove(); // clears _leaflet_id from the container → safe to re-init
      mapRef.current = null;
      markerRef.current = null;
      haloRef.current = null;
      lineRef.current = null;
    };
    // Initial center is intentionally a one-time snapshot; live updates are
    // handled by the position effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marker + smooth recenter whenever Elango's position changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const hasPos = typeof lat === "number" && typeof lon === "number";
    if (!hasPos) return;

    const latlng = [lat, lon];
    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, { icon: backpackerIcon }).addTo(map);
    } else {
      markerRef.current.setLatLng(latlng);
    }

    const place = `${landmark ? `${landmark}, ` : ""}${city ?? ""}`;
    markerRef.current.bindPopup(
      `<div style="font-size:13px;line-height:1.3">
         <strong>Elango is here 🎒</strong><br/>
         <span style="color:#475569">${place}</span>
       </div>`
    );

    map.flyTo(latlng, map.getZoom(), { duration: 1.5 });
  }, [lat, lon, city, landmark]);

  // The trail of everywhere he's walked — a soft halo under a crisp dashed line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const trail = Array.isArray(path)
      ? path.filter((p) => Array.isArray(p) && p.length === 2)
      : [];

    if (trail.length < 2) {
      haloRef.current?.remove();
      lineRef.current?.remove();
      haloRef.current = null;
      lineRef.current = null;
      return;
    }

    if (!haloRef.current) {
      haloRef.current = L.polyline(trail, {
        color: "#34d399",
        weight: 9,
        opacity: 0.25,
        lineCap: "round",
      }).addTo(map);
    } else {
      haloRef.current.setLatLngs(trail);
    }

    if (!lineRef.current) {
      lineRef.current = L.polyline(trail, {
        color: "#059669",
        weight: 3,
        opacity: 0.9,
        dashArray: "1 8",
        lineCap: "round",
      }).addTo(map);
    } else {
      lineRef.current.setLatLngs(trail);
    }
  }, [path]);

  return <div ref={containerRef} className="h-full w-full" />;
}
