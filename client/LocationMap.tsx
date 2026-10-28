import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMapMovement } from './useMapMovement';
import type { Measurement } from '../shared/protocol';

interface LocationMapProps {
  history: Measurement[];
  connected: boolean;
}

export function LocationMap({ history, connected }: LocationMapProps) {
  const measurement = history[0];
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const trail = useRef<L.LayerGroup | null>(null);
  const direction = useRef<L.Marker | null>(null);
  const controls = useMapMovement(container, connected);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false, keyboard: false }).setView([0, 0], 2);
    map.current = instance;
    trail.current = L.layerGroup().addTo(instance);
    // Wait for a real measurement before requesting map tiles.
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      marker.current = null;
      trail.current = null;
      direction.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !measurement) return;
    const point: L.LatLngExpression = [measurement.latitude, measurement.longitude];
    if (!marker.current) {
      instance.setView(point, 18);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on('tileerror', () => setTileError(true)).addTo(instance);
      marker.current = L.circleMarker(point, {
        radius: 8, color: '#ffffff', weight: 3, fillColor: '#176c57', fillOpacity: 1,
      }).addTo(instance);
      marker.current.bindTooltip('Latest sensor position');
    } else {
      marker.current.setLatLng(point);
    }
    trail.current?.clearLayers();
    const chronological = [...history].reverse();
    L.polyline(chronological.map((sample) => [sample.latitude, sample.longitude] as L.LatLngTuple), {
      color: '#4b83b3', weight: 2, opacity: 0.55, interactive: false,
    }).addTo(trail.current!);
    for (const sample of history.slice(1)) {
      const label = document.createElement('span');
      label.textContent = `Raw sample #${sample.sequentialId} · ${sample.timeAtSample} · ${sample.latitude}, ${sample.longitude}`;
      L.circleMarker([sample.latitude, sample.longitude], {
        radius: 3, color: '#497da8', weight: 1, fillOpacity: 0.65,
      }).bindTooltip(label).addTo(trail.current!);
    }
    marker.current.bringToFront();
    direction.current?.remove();
    direction.current = null;
    // At stationary noise speeds there is no meaningful travel direction.
    if (measurement.velocityData.speedMetersPerSecond > 0.01) {
      const arrow = document.createElement('div');
      arrow.className = 'travel-arrow';
      arrow.style.transform = `rotate(${measurement.velocityData.headingDegrees}deg)`;
      arrow.textContent = '▲';
      direction.current = L.marker(point, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'travel-icon', html: arrow, iconSize: [40, 40], iconAnchor: [20, 20] }),
      }).addTo(instance);
    }
  }, [measurement, history]);

  return <section className="panel location-panel">
    <div className="panel-head">
      <div><p className="eyebrow">LOCATION</p><h2>Sensor on the map</h2></div>
      <button disabled={!measurement} onClick={() => {
        if (measurement) map.current?.setView([measurement.latitude, measurement.longitude], 18);
      }}>Center on sensor</button>
    </div>
    <p className="footnote">{measurement
      ? `${connected ? 'Latest position' : 'Last received position · disconnected'}: ${measurement.latitude.toFixed(9)}°, ${measurement.longitude.toFixed(9)}°`
      : 'Waiting for a sensor measurement…'}</p>
    {tileError && <p className="notice" role="status">Some map tiles could not load. Check your internet connection; sensor coordinates remain available.</p>}
    {controls.error && <p className="notice" role="alert">{controls.error}</p>}
    <p id="map-controls" className="map-instructions">Click the map or Tab to focus it, then hold ↑ ↓ ← → to move. Release to stop. {controls.moving ? 'Movement command active.' : 'Arrow keys move the sensor, not the map.'}</p>
    <div ref={container} tabIndex={0} className="location-map" role="region" aria-label="OpenStreetMap showing the sensor location" aria-describedby="map-controls" />
    <p className="footnote">Green dot: latest raw sample. Blue dots and line: up to 49 previous raw samples, newest connection only. Arrow: reported travel heading when speed exceeds 0.01 m/s. Drag to pan; use + / − to zoom.</p>
  </section>;
}
