import { useEffect, useState } from 'react';
import type { FaultState } from '../shared/protocol';
import type { DetectedFault } from './readingHistory';

interface Props {
  state: FaultState | null;
  connected: boolean;
  busy: boolean;
  error: string;
  onTrigger: () => Promise<void>;
  detections: DetectedFault[];
}
export function FaultControls({ state, connected, busy, error, onTrigger, detections }: Props) {
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
    <div className="panel-head"><div><p className="eyebrow">ONE-SHOT TEST</p><h2>Bad position data</h2></div>
      <button type="button" disabled={!connected || !state || busy || state.pending} onClick={() => void onTrigger()}>{busy ? 'Queuing…' : state?.pending ? (remaining > 0 ? `Queued · ${(remaining / 1000).toFixed(1)} s` : 'Waiting for next sample…') : 'Inject 50 m position jump'}</button>
    </div>
    <p className="footnote">Waits 3 seconds, then offsets the next generated reading 50 meters east. True position and avatar stay unchanged; subsequent raw readings return to normal.</p>
    <p role="status" className="footnote">{state?.pending ? (remaining > 0 ? 'Injection countdown running.' : `Armed for ${state.targetSequentialId ? `sample #${state.targetSequentialId}` : 'the next generated sample'}.`) : state?.lastInjected ? `Applied to sample #${state.lastInjected.sequentialId} at ${state.lastInjected.timeAtSample}.` : 'No fault queued.'}{!connected ? ' Disconnected; showing last known injector status.' : ''}</p>
    {error && <p className="notice" role="alert">{error}</p>}
    <section className="detected-faults" aria-label="Detected faults">
      <h3>Detected faults <span className="tag">{detections.length}</span></h3>
      <p className="footnote">Suspected position anomalies outside a previously saved prediction area. Abrupt maneuvers can also trigger these; injector status is not used.</p>
      {detections.length ? <ol className="fault-list">{detections.map((fault) => <li key={fault.sampleId}>
        <strong>Sample #{fault.sequentialId} · outside predicted area</strong>
        <time dateTime={fault.timeAtSample}>{fault.timeAtSample}</time>
        <span>Error {fault.errorMeters.toFixed(2)} m / predicted radius {fault.radiusMeters.toFixed(2)} m</span>
      </li>)}</ol> : <p className="footnote">No anomalies detected. Detection starts once a saved forecast can be scored.</p>}
      <p className="footnote">Latest 50 detections for this connection. Suspected points stay in history but are excluded from new forecast fits.</p>
    </section>
  </section>;
}
