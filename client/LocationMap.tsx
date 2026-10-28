import { useEffect, useRef, useState } from 'react';
import { avatarPosition } from './avatar';
import type { MotionSnapshot } from './avatar';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMapMovement } from './useMapMovement';
import type { Measurement } from '../shared/protocol';

interface LocationMapProps {
  history: Measurement[];
  motion: MotionSnapshot | null;
  connected: boolean;
}

export function LocationMap({ history, connected, motion }: LocationMapProps) {
  const measurement = history[0];
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const trail = useRef<L.LayerGroup | null>(null);
  const avatar = useRef<L.Marker | null>(null);
  const snapshot = useRef(motion);
  snapshot.current = motion;
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
      avatar.current = null;
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
        radius: 5, color: '#ffffff', weight: 3, fillColor: '#497da8', fillOpacity: 1,
      }).addTo(instance);
      marker.current.bindTooltip('Latest raw sensor sample');
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

  }, [measurement, history]);

  useEffect(() => {
    if (!connected) return;
    const body = document.createElement('div');
    body.className = 'avatar-body';
    const arrow = document.createElement('span');
    arrow.className = 'avatar-arrow';
    arrow.textContent = '▲';
    const dot = document.createElement('span');
    dot.className = 'avatar-dot';
    body.append(arrow, dot);
    let frame = 0;
    function render(now: number) {
      const instance = map.current;
      const current = snapshot.current;
      if (instance && current) {
        const position = avatarPosition(current, now);
        const point: L.LatLngTuple = [position.latitude, position.longitude];
        if (!avatar.current) {
          avatar.current = L.marker(point, {
            interactive: false, keyboard: false, zIndexOffset: 1000,
            icon: L.divIcon({ className: 'avatar-icon', html: body, iconSize: [40, 40], iconAnchor: [20, 20] }),
          }).addTo(instance);
        }
        avatar.current.setLatLng(point);
        body.style.transform = `rotate(${position.headingDegrees}deg)`;
        arrow.hidden = !position.moving;
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      avatar.current?.remove();
      avatar.current = null;
    };
  }, [connected]);

  return <section className="panel location-panel">
    <div className="panel-head">
      <div><p className="eyebrow">LOCATION</p><h2>Sensor on the map</h2></div>
      <button disabled={!measurement} onClick={() => {
        const current = snapshot.current;
        if (current && connected) {
          const point = avatarPosition(current, performance.now());
          map.current?.setView([point.latitude, point.longitude], 18);
        } else if (measurement) map.current?.setView([measurement.latitude, measurement.longitude], 18);
      }}>Center on sensor</button>
    </div>
    <p className="footnote">{measurement
      ? `${connected ? 'Latest position' : 'Last received position · disconnected'}: ${measurement.latitude.toFixed(9)}°, ${measurement.longitude.toFixed(9)}°`
      : 'Waiting for a sensor measurement…'}</p>
    {tileError && <p className="notice" role="status">Some map tiles could not load. Check your internet connection; sensor coordinates remain available.</p>}
    {controls.error && <p className="notice" role="alert">{controls.error}</p>}
    <p id="map-controls" className="map-instructions">Click the map or Tab to focus it, then hold ↑ ↓ ← → to move. Release to stop. {controls.moving ? 'Movement command active.' : 'Arrow keys move the sensor, not the map.'}</p>
    <div ref={container} tabIndex={0} className="location-map" role="region" aria-label="OpenStreetMap showing the sensor location" aria-describedby="map-controls" />
    <p className="footnote">Green avatar and arrow: live simulator position and direction, animated independently of sensor sampling. Blue dots and line: the last 50 raw sensor samples, added only on sensor ticks. Drag to pan; use + / − to zoom.</p>
  </section>;
}
