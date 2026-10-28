import { FAULT_SCENARIOS } from '../shared/faults';
import type { FaultKind } from '../shared/faults';
import { DETECTION_LABELS } from './detectionTypes';
import { useEffect, useState } from 'react';
import type { FaultState } from '../shared/protocol';
import type { DetectedFault } from './readingHistory';

interface Props {
  state: FaultState | null;
  connected: boolean;
  busy: boolean;
  error: string;
  onTrigger: (kind: FaultKind) => Promise<void>;
  detections: DetectedFault[];
}
export function FaultControls({ state, connected, busy, error, onTrigger, detections }: Props) {
  const [selected, setSelected] = useState<FaultKind>('position-jump');
  const scenario = FAULT_SCENARIOS.find((entry) => entry.kind === selected)!;
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!state?.pending) { setRemaining(0); return; }
    const receivedAt = performance.now();
    const update = () => setRemaining(Math.max(0, state.remainingDelayMs - (performance.now() - receivedAt)));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [state]);
  return <section className="panel fault-controls" aria-label="Fault injection">
    <div className="panel-head"><div><p className="eyebrow">FAULT INJECTOR</p><h2>Sensor fault scenarios</h2></div>
      <label htmlFor="fault-scenario" className="fault-selector-label">Fault scenario</label>
      <select id="fault-scenario" value={selected} disabled={busy || !!state?.pending || !!state?.active} onChange={(event) => setSelected(event.target.value as FaultKind)}>{FAULT_SCENARIOS.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}</select>
      <button type="button" disabled={!connected || !state || busy || state.pending || state.active} onClick={() => void onTrigger(selected)}>{busy ? 'Queuing…' : state?.pending ? (remaining > 0 ? `Queued · ${(remaining / 1000).toFixed(1)} s` : 'Waiting for next sample…') : state?.active ? 'Scenario active…' : 'Trigger selected fault'}</button>
    </div>
    <p className="footnote">{scenario.description} Starts after a 3-second countdown. Longer scenarios finish automatically.</p>
    <p role="status" className="footnote">{state?.pending ? (remaining > 0 ? 'Injection countdown running.' : `Armed for ${state.targetSequentialId ? `sample #${state.targetSequentialId}` : 'the next generated sample'}.`) : state?.active ? `Active: ${FAULT_SCENARIOS.find((entry) => entry.kind === state.kind)?.label ?? state.kind}.` : state?.lastInjected ? `Applied to sample #${state.lastInjected.sequentialId} at ${state.lastInjected.timeAtSample}.` : 'No fault queued.'}{!connected ? ' Disconnected; showing last known injector status.' : ''}</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <section className="detected-faults" aria-label="Detected faults">
      <h3>Detected faults <span className="tag">{detections.length}</span></h3>
      <p className="footnote">Observed stream errors and suspected sensor anomalies. Detection uses sensor frames and arrival/connection timing only; controls, avatar motion, and injector state are excluded.</p>
      {detections.length ? <ol className="fault-list">{detections.map((fault) => <li key={`${fault.reason}:${fault.sampleId}`}>
        <strong>{DETECTION_LABELS[fault.reason]}{fault.sequentialId !== null ? ` · #${fault.sequentialId}` : ''}</strong>
        <span>{fault.confidence ?? 'suspected'} · {fault.detail ?? 'Outside saved prediction area.'}</span>
        <time dateTime={fault.timeAtSample}>{fault.timeAtSample}</time>
        {fault.errorMeters !== undefined && fault.radiusMeters !== undefined && <span>Error {fault.errorMeters.toFixed(2)} m / predicted radius {fault.radiusMeters.toFixed(2)} m</span>}
        {fault.payload && <details><summary>Rejected sensor payload</summary><pre>{fault.payload}</pre></details>}
      </li>)}</ol> : <p className="footnote">No anomalies detected. Timing and consistency checks need several sensor readings to establish a baseline.</p>}
      <p className="footnote">Latest 50 detections for this page, retained across reconnects. Drift/freeze evidence is ambiguous; abrupt legitimate maneuvers can also trigger suspicion. Invalid and duplicate frames are not used by the estimator.</p>
    </section>
  </section>;
}
