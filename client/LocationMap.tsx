import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Measurement } from '../shared/protocol';

interface LocationMapProps {
  measurement: Measurement | undefined;
  connected: boolean;
}

export function LocationMap({ measurement, connected }: LocationMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([0, 0], 2);
    map.current = instance;
    // Wait for a real measurement before requesting map tiles.
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      marker.current = null;
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
  }, [measurement]);

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
    <div ref={container} className="location-map" role="region" aria-label="OpenStreetMap showing the sensor location" />
    <p className="footnote">The dot updates with each sample. Drag to pan, use + / − to zoom, or center on the sensor. Centimeter-scale jitter is too small to see at street-map zoom.</p>
  </section>;
}
