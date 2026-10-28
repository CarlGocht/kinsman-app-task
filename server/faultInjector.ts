import type { FaultKind } from '../shared/faults.js';
import type { FaultState, Measurement } from '../shared/protocol.js';
import { destination } from '../shared/geo.js';

export class FaultInjector {
  private kind: FaultKind | null = null;
  private due = 0;
  private eligibleAt: string | null = null;
  private active = false;
  private end = 0;
  private count = 0;
  private started = 0;
  private held: Measurement | null = null;
  private frozen: { latitude: number; longitude: number } | null = null;
  private previous: { latitude: number; longitude: number } | null = null;
  private last: FaultState['lastInjected'] = null;
  constructor(private changed: (state: FaultState) => void) {}
  get samplingPauseMs() { return this.kind === 'sample-gap' && this.active ? Math.max(0, this.end - performance.now()) : 0; }
  state(sequence: number): FaultState {
    if (this.kind === 'connection-interruption' && this.active && performance.now() >= this.end) this.clear();
    const remaining = this.kind && !this.active ? Math.max(0, this.due - performance.now()) : 0;
    return { pending: !!this.kind && !this.active, active: this.active, kind: this.kind,
      remainingDurationMs: this.active ? Math.max(0, this.end - performance.now()) : 0,
      delayMs: 3000, remainingDelayMs: remaining, eligibleAt: this.eligibleAt,
      targetSequentialId: this.kind && !this.active && !remaining ? sequence + 1 : null,
      offsetMeters: 50, headingDegrees: 90, lastInjected: this.last };
  }
  arm(kind: FaultKind, sequence: number) {
    if (this.kind) return this.state(sequence);
    this.kind = kind; this.due = performance.now() + 3000;
    this.eligibleAt = new Date(Date.now() + 3000).toISOString();
    const state = this.state(sequence);
    this.changed(state);
    return state;
  }
  clear() { this.kind = null; this.active = false; this.held = null; this.frozen = null; this.eligibleAt = null; }
  private finish(sequence: number) { this.clear(); this.changed(this.state(sequence)); }
  process(input: Measurement, interval: number): { readings: Measurement[]; pauseMs: number; disconnectMs: number } {
    const now = performance.now();
    const output = { readings: [input], pauseMs: 0, disconnectMs: 0 };
    const original = { latitude: input.latitude, longitude: input.longitude };
    if (!this.kind || now < this.due) { this.previous = original; return output; }
    const kind = this.kind;
    const activating = !this.active;
    if (activating) {
      this.active = true; this.started = now; this.count = 0; this.frozen = this.previous ?? original;
      const duration = kind === 'connection-interruption' ? 4000 : kind === 'gradual-drift' ? Math.max(12000, interval * 8)
        : ['frozen-position', 'excessive-noise'].includes(kind) ? Math.max(8000, interval * 8) : 0;
      this.end = now + duration;
      this.last = { uniqueId: input.uniqueId, sequentialId: input.sequentialId, timeAtSample: input.timeAtSample, kind };
      this.changed(this.state(input.sequentialId));
    } else if (this.end > 0 && now >= this.end && ['frozen-position', 'gradual-drift', 'excessive-noise', 'sample-gap', 'connection-interruption'].includes(kind)) {
      this.finish(input.sequentialId); this.previous = original; return output;
    }
    this.count++;
    if (kind === 'position-jump') {
      Object.assign(input, destination(input.latitude, input.longitude, 90, 50)); this.finish(input.sequentialId);
    } else if (kind === 'missing-samples') {
      output.readings = []; if (this.count >= 3) this.finish(input.sequentialId);
    } else if (kind === 'sample-gap') {
      if (activating) { this.end = now + Math.max(3000, interval * 4); this.changed(this.state(input.sequentialId)); }
      output.pauseMs = Math.max(0, this.end - now);
    } else if (kind === 'duplicate') {
      output.readings = [input, { ...input, velocityData: { ...input.velocityData } }]; this.finish(input.sequentialId);
    } else if (kind === 'out-of-order') {
      if (!this.held) { this.held = input; output.readings = []; }
      else { output.readings = [input, this.held]; this.finish(input.sequentialId); }
    } else if (kind === 'frozen-position') {
      Object.assign(input, this.frozen!);
    } else if (kind === 'gradual-drift') {
      const elapsed = (now - this.started) / 1000;
      Object.assign(input, destination(input.latitude, input.longitude, 90, Math.max(0, elapsed)));
    } else if (kind === 'excessive-noise') {
      Object.assign(input, destination(input.latitude, input.longitude, (this.count % 4) * 90, 20));
    } else if (kind === 'malformed') {
      // Deliberate schema corruption at the injector boundary.
      output.readings = [{ ...input, latitude: 200, accuracyMeters: -1,
        velocityData: { ...input.velocityData, speedMetersPerSecond: 'invalid' } } as unknown as Measurement];
      this.finish(input.sequentialId);
    } else if (kind === 'connection-interruption') {
      output.readings = [];
      if (activating) { output.disconnectMs = 4000; this.end = now + 4000; this.changed(this.state(input.sequentialId)); }
    }
    this.previous = original;
    return output;
  }
}
