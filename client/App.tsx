import { useSensor } from './useSensor';
import { LocationMap } from './LocationMap';

const labels: Record<string, string> = {
  sensorId: 'Sensor ID', seed: 'Random seed', latitude: 'Base latitude (°)', longitude: 'Base longitude (°)',
  sampleIntervalMs: 'Sample interval (ms)', sampleJitterMs: 'Sample jitter (±ms)', sendDelayMaxMs: 'Max send delay (ms)',
  positionRadiusMeters: 'Position radius (m)', accuracyMeters: 'Nominal accuracy (m)', accuracyJitterMeters: 'Accuracy jitter (±m)',
  speedMaxMetersPerSecond: 'Speed noise limit (m/s)', headingJitterDegrees: 'Heading jitter (±°)',
  movementSpeedMetersPerSecond: 'Movement speed (m/s)', movementTimeoutMs: 'Movement timeout (ms)',
};

export function App() {
  const sensor = useSensor();
  const latest = sensor.history[0];
  return <main>
    <header>
      <div><p className="eyebrow">KINSMAN / LOCAL SIMULATOR</p><h1>Sensor monitor</h1><p className="subtitle">One simulated sensor. A live view of every measurement.</p></div>
      <div className={`connection ${sensor.connection === 'Connected' ? 'online' : ''}`} role="status"><span className="dot" />{sensor.connection}</div>
    </header>
    {sensor.streamError && <p className="notice" role="alert">{sensor.streamError} Reconnects automatically every 2 seconds.</p>}
    <div className="metrics">
      <section><p className="label">LATEST SAMPLE</p><strong>{latest ? `#${latest.sequentialId}` : '—'}</strong><small>{sensor.clients === null ? 'Waiting for connection' : `${sensor.clients} connected client${sensor.clients === 1 ? '' : 's'}`}</small></section>
      <section><p className="label">REPORTED ACCURACY</p><strong>{latest ? `${(latest.accuracyMeters * 100).toFixed(2)} cm` : '—'}</strong><small>Centimeter-scale measurement</small></section>
      <section><p className="label">REPORTED SPEED</p><strong>{latest ? `${latest.velocityData.speedMetersPerSecond.toFixed(4)} m/s` : '—'}</strong><small>Reported speed with measurement jitter</small></section>
    </div>
    <LocationMap history={sensor.history} connected={sensor.connection === 'Connected'} />
    <div className="columns">
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">CONFIGURATION</p><h2>Current settings</h2></div><button onClick={() => void sensor.refresh()} disabled={sensor.refreshing}>{sensor.refreshing ? 'Refreshing…' : 'Refresh settings'}</button></div>
        {sensor.settingsError && <p className="notice" role="alert">{sensor.settingsError}. {sensor.settings ? 'Showing last fetched settings.' : 'Check that the server is running.'}</p>}
        {sensor.settings ? <dl>{Object.entries(sensor.settings).map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{String(value)}</dd></div>)}</dl> : <p className="empty">{sensor.refreshing ? 'Loading settings…' : 'No settings available yet.'}</p>}
        <p className="footnote">{sensor.updatedAt ? `Last fetched ${sensor.updatedAt}` : 'Settings refresh when the stream connects.'}</p>
      </section>
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">MEASUREMENT</p><h2>Latest payload</h2></div><span className="tag">JSON</span></div>
        <p className="footnote">{sensor.connection !== 'Connected' && latest ? 'Last received measurement · stream disconnected' : 'Full precision · timestamps in UTC'}</p>
        <pre aria-label="Latest measurement">{latest ? JSON.stringify(latest, null, 2) : 'Waiting for the first measurement…'}</pre>
      </section>
    </div>
    <section className="panel history">
      <div className="panel-head"><div><p className="eyebrow">LIVE STREAM</p><h2>Recent measurements</h2></div><span className="tag">{sensor.history.length} / 50</span></div>
      <p className="footnote">Newest first. Keeps the latest 50 samples for this connection.</p>
      {sensor.history.length ? <div className="table-scroll"><table><thead><tr><th>Sequence</th><th>Sample time (UTC)</th><th>Latitude (°)</th><th>Longitude (°)</th><th>Accuracy (m)</th><th>Speed (m/s)</th><th>Heading (°)</th></tr></thead><tbody>{sensor.history.map((m) => <tr key={m.uniqueId}><td>#{m.sequentialId}</td><td>{m.timeAtSample}</td><td>{m.latitude.toFixed(9)}</td><td>{m.longitude.toFixed(9)}</td><td>{m.accuracyMeters.toFixed(4)}</td><td>{m.velocityData.speedMetersPerSecond.toFixed(4)}</td><td>{m.velocityData.headingDegrees.toFixed(2)}</td></tr>)}</tbody></table></div> : <p className="empty">Measurements will appear here once the server starts streaming.</p>}
    </section>
    <footer>Local sensor monitor <span>HTTP settings · WebSocket measurements</span></footer>
  </main>;
}
