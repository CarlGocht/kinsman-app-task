import { Fragment } from 'react';
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
  const newestTime = sensor.pairs.length ? Date.parse(sensor.pairs[0].weighted?.timeAtSample ?? sensor.pairs[0].raw.timeAtSample) : -Infinity;
  const forecast = sensor.predictions.find((saved) => !saved.evaluation && Date.parse(saved.prediction.targetTime) > newestTime)?.prediction ?? null;
  const latestEvaluation = sensor.predictions.find((saved) => saved.evaluation)?.evaluation;
  const band = sensor.pairs[0]?.band;
  const weighted = sensor.pairs[0]?.weighted ?? null;
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
    {band && <section className="panel accuracy-summary" aria-label="Current accuracy band">
      <div className="panel-head"><div><p className="eyebrow">ACCURACY ESTIMATE · RAW #{latest.sequentialId}</p><h2>Estimated band radius: {band.radiusMeters.toFixed(3)} m</h2></div><span className="tag">{band.comparedSamples ? `${band.comparedSamples} prior samples` : 'Sensor only'}</span></div>
      <p className="footnote">Reported accuracy: {band.reportedAccuracyMeters.toFixed(3)} m · History disagreement: {band.disagreementMeters === null ? 'collecting history' : `${band.disagreementMeters.toFixed(3)} m`} · History spread: {band.historySpreadMeters === null ? '—' : `${band.historySpreadMeters.toFixed(3)} m`}</p>
      <p className="footnote">Purple map band combines sensor accuracy with motion-adjusted historical agreement. A dashed ring keeps small bands visible and is not to scale. An estimated uncertainty radius, not a guaranteed confidence percentage.{sensor.connection !== 'Connected' ? ' Last received reading; disconnected.' : ''}</p>
    </section>}
    <section className="panel prediction-summary" aria-label="Next reading prediction">
      <div className="panel-head"><div><p className="eyebrow">NEXT SENSOR READING</p><h2>{forecast ? `Predicted area: ${forecast.radiusMeters.toFixed(3)} m radius` : 'Collecting prediction history'}</h2></div><span className="tag">Constant velocity</span></div>
      {forecast ? <><p className="footnote">Target: {forecast.targetTime} · {forecast.latitude.toFixed(9)}°, {forecast.longitude.toFixed(9)}°</p>
        <p className="footnote">Saved {forecast.createdAt} using {forecast.sourceIds.length} readings: {forecast.sourceSequenceIds.slice(0, 8).map((id) => `#${id}`).join(', ')}{forecast.sourceIds.length > 8 ? '…' : ''}.</p></> : <p className="footnote">Needs at least two distinct sample times in the three-second window and loaded server settings.</p>}
      {latestEvaluation && <p className="prediction-result">Last result: #{latestEvaluation.actualSequentialId} was {latestEvaluation.insideArea ? 'inside' : 'outside'} its saved area · error {latestEvaluation.errorMeters.toFixed(3)} m / radius {latestEvaluation.radiusMeters.toFixed(3)} m.</p>}
      <p className="footnote">Teal point and area: saved forecast before the reading arrives. Area is heuristic, not a calibrated probability; turns and stops can cause misses. {sensor.connection !== 'Connected' ? 'Disconnected: showing last saved forecast.' : ''}</p>
    </section>
    <LocationMap prediction={forecast} motion={sensor.motion} pairs={sensor.pairs} connected={sensor.connection === 'Connected'} />
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
      <div className="panel-head"><div><p className="eyebrow">LIVE STREAM</p><h2>Recent measurements</h2></div><span className="tag">{sensor.pairs.length} / 50 pairs</span></div>
      <p className="footnote">Newest first. Each raw reading is paired with its saved weighted estimate from the latest three seconds of sample timestamps (smaller accuracyMeters and newer sample times mean higher weight). Raw readings remain unchanged. The window ends at the newest sample time received; older out-of-order arrivals do not move it backward.</p>
      {weighted && <p className="footnote" aria-label="Weighted position sources">
        Window: 3 seconds · {weighted.sources.length} samples · {weighted.sources.slice(0, 8).map((source) => `#${source.sequentialId}: ${(source.weight * 100).toFixed(1)}%`).join(' · ')}{weighted.sources.length > 8 ? ` · +${weighted.sources.length - 8} more` : ''}.
        {' '}Weighted accuracy uses an independent, same-position error model; it is not guaranteed actual accuracy. While moving, the estimate can lag behind the latest raw position.
      </p>}
      {sensor.history.length ? <div className="table-scroll"><table>
        <thead><tr><th>Source</th><th>Sequence / window</th><th>Sample / window end (UTC)</th><th>Latitude (°)</th><th>Longitude (°)</th><th>Accuracy (m)</th><th>Band radius (m)</th><th>Speed (m/s)</th><th>Heading (°)</th></tr></thead>
        <tbody>
          {sensor.pairs.map(({ raw: m, weighted: estimate, band: savedBand }, index) => <Fragment key={m.uniqueId}>
            <tr className="raw-row" aria-label={`Raw measurement #${m.sequentialId}`}><th scope="row">Raw</th><td>#{m.sequentialId}</td><td>{m.timeAtSample}</td><td>{m.latitude.toFixed(9)}</td><td>{m.longitude.toFixed(9)}</td><td>{m.accuracyMeters.toFixed(4)}</td><td>{savedBand ? savedBand.radiusMeters.toFixed(3) : '—'}</td><td>{m.velocityData.speedMetersPerSecond.toFixed(4)}</td><td>{m.velocityData.headingDegrees.toFixed(2)}</td></tr>
            <tr className="weighted-row" aria-label={index === 0 ? 'Current weighted position' : `Weighted position paired with raw #${m.sequentialId}`}>
              <th scope="row">Weighted (3 s, {estimate?.sources.length ?? 0} samples)</th>
              <td>Pair #{m.sequentialId}</td>
              {estimate ? <><td>{estimate.timeAtSample}</td><td>{estimate.latitude.toFixed(9)}</td><td>{estimate.longitude.toFixed(9)}</td>
                <td title="Model-based combined accuracy; assumes independent errors at one position">{estimate.accuracyMeters.toFixed(4)} (model)</td><td>—</td><td>—</td><td>—</td></>
                : <td colSpan={7}>Estimate unavailable</td>}
            </tr>
          </Fragment>)}
        </tbody>
      </table></div> : <p className="empty">Measurements will appear here once the server starts streaming.</p>}
    </section>
    <section className="panel history">
      <div className="panel-head"><div><p className="eyebrow">PREDICT BEFORE OBSERVING</p><h2>Saved prediction log</h2></div><span className="tag">{sensor.predictions.length} / 50</span></div>
      <p className="footnote">Newest first. Showing up to 20 forecasts. Actual sample timing may differ slightly from the target; scoring projects the unchanged saved model to that sample time. No current reading is used to refit or widen its own prediction.</p>
      {sensor.predictions.length ? <div className="table-scroll"><table aria-label="Saved predictions"><thead><tr><th>Sources</th><th>Saved at (UTC)</th><th>Target time (UTC)</th><th>Predicted latitude (°)</th><th>Predicted longitude (°)</th><th>Target radius (m)</th><th>Actual sample</th><th>Error / scored radius (m)</th><th>Result</th></tr></thead><tbody>
        {sensor.predictions.slice(0, 20).map(({ prediction: p, evaluation }) => <tr key={p.id}><td title={p.sourceIds.join(', ')}>{p.sourceSequenceIds.slice(0, 5).map((id) => `#${id}`).join(', ')}{p.sourceIds.length > 5 ? '…' : ''}</td><td>{p.createdAt}</td><td>{p.targetTime}</td><td>{p.latitude.toFixed(9)}</td><td>{p.longitude.toFixed(9)}</td><td>{p.radiusMeters.toFixed(3)}</td><td>{evaluation ? `#${evaluation.actualSequentialId} · ${evaluation.actualTime}` : '—'}</td><td>{evaluation ? `${evaluation.errorMeters.toFixed(3)} / ${evaluation.radiusMeters.toFixed(3)}` : '—'}</td><td>{evaluation ? (evaluation.insideArea ? 'Inside area' : 'Outside area') : 'Awaiting matching reading'}</td></tr>)}
      </tbody></table></div> : <p className="empty">Forecasts will be saved as sensor history becomes available.</p>}
    </section>
    <footer>Local sensor monitor <span>HTTP settings · WebSocket measurements</span></footer>
  </main>;
}
