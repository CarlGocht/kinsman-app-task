// Detection depends only on sensor frames and observed transport/arrival timing.
// Never import keyboard input, simulator motion, settings, or injector state here.
import type { Measurement } from '../shared/protocol.js';
import type { DetectedFault, DetectionReason } from './detectionTypes.js';
import { distanceMeters } from '../shared/geo.js';

function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1000; }
export function validateMeasurement(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Expected a measurement object'];
  const m = value as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of ['sensorId', 'uniqueId']) if (typeof m[key] !== 'string' || !(m[key] as string).trim()) issues.push(`${key} must be a nonempty string`);
  if (!Number.isSafeInteger(m.sequentialId) || (m.sequentialId as number) < 1) issues.push('sequentialId must be a positive integer');
  for (const [key, min, max] of [['latitude', -90, 90], ['longitude', -180, 180], ['accuracyMeters', Number.MIN_VALUE, Infinity]] as const) {
    if (typeof m[key] !== 'number' || !Number.isFinite(m[key]) || (m[key] as number) < min || (m[key] as number) > max) issues.push(`${key} is invalid`);
  }
  const sampleTime = typeof m.timeAtSample === 'string' ? Date.parse(m.timeAtSample) : NaN;
  const sendTime = typeof m.timeAtSend === 'string' ? Date.parse(m.timeAtSend) : NaN;
  if (!Number.isFinite(sampleTime) || !Number.isFinite(sendTime) || sendTime < sampleTime) issues.push('Invalid sample/send timestamps');
  const velocity = m.velocityData as Record<string, unknown> | null;
  if (!velocity || typeof velocity !== 'object' || typeof velocity.speedMetersPerSecond !== 'number' || !Number.isFinite(velocity.speedMetersPerSecond) || velocity.speedMetersPerSecond < 0
    || typeof velocity.headingDegrees !== 'number' || !Number.isFinite(velocity.headingDegrees) || velocity.headingDegrees < 0 || velocity.headingDegrees >= 360) issues.push('Invalid velocity data');
  return issues;
}

export class SensorDetector {
  private seen = new Map<string, number>();
  private highest = 0;
  private latest: Measurement | null = null;
  private intervals: number[] = [];
  private lastArrival: number | null = null;
  private pending = new Map<number, number>();
  private episodes = new Set<string>();
  private lastEmitted = new Map<string, number>();
  private samePosition = 0;
  private residuals: { east: number; north: number; dt: number; accuracy: number }[] = [];
  private counter = 0;
  private event(reason: DetectionReason, detail: string, raw: Measurement | null, now: number, observed: boolean, payload?: unknown): DetectedFault {
    return { sampleId: raw?.uniqueId ?? `event-${reason}-${now}-${++this.counter}`, sequentialId: raw?.sequentialId ?? null,
      timeAtSample: raw?.timeAtSample ?? new Date().toISOString(), reason, detail, confidence: observed ? 'observed' : 'suspected',
      ...(payload !== undefined ? { payload: JSON.stringify(payload).slice(0, 800) } : {}) };
  }
  private once(reason: DetectionReason, condition: boolean, detail: string, raw: Measurement, now: number, events: DetectedFault[]) {
    if (!condition) { this.episodes.delete(reason); return; }
    if (!this.episodes.has(reason)) { events.push(this.event(reason, detail, raw, now, false)); this.episodes.add(reason); }
  }
  private flushMissing(now: number): DetectedFault[] {
    const missing = [...this.pending.entries()].filter(([, detected]) => now - detected > Math.max(500, median(this.intervals) * 1.5));
    if (!missing.length) return [];
    for (const [id] of missing) this.pending.delete(id);
    return [this.event('missing-samples', `Sequence IDs without a valid reading after the reorder grace period: ${missing.slice(0, 12).map(([id]) => id).join(', ')}${missing.length > 12 ? '…' : ''}`, this.latest, now, true)];
  }
  observe(value: unknown, now: number): { measurement: Measurement | null; events: DetectedFault[] } {
    const silenceWasLogged = this.episodes.has('silence');
    this.lastArrival = now; this.episodes.delete('silence');
    const issues = validateMeasurement(value);
    if (issues.length) return { measurement: null, events: [this.event('malformed', issues.join('; '), null, now, true, value)] };
    const raw = value as Measurement;
    const events: DetectedFault[] = [];
    if (this.seen.has(raw.uniqueId)) return { measurement: null, events: [this.event('duplicate', 'The same measurement uniqueId was received more than once.', raw, now, true)] };
    this.seen.set(raw.uniqueId, now);
    if (this.seen.size > 5000) this.seen.delete(this.seen.keys().next().value!);
    this.pending.delete(raw.sequentialId);
    const previous = this.latest;
    const sampleTime = Date.parse(raw.timeAtSample);
    if (raw.sequentialId <= this.highest || (previous && sampleTime < Date.parse(previous.timeAtSample))) {
      events.push(this.event('out-of-order', 'Sequence ID or sample timestamp arrived behind a newer reading.', raw, now, true));
    }
    if (this.highest && raw.sequentialId > this.highest + 1) {
      for (let id = this.highest + 1; id < Math.min(raw.sequentialId, this.highest + 257); id++) this.pending.set(id, now);
    }
    events.push(...this.flushMissing(now));
    if (!previous || (raw.sequentialId > this.highest && sampleTime > Date.parse(previous.timeAtSample))) {
      if (previous) {
        const deltaMs = sampleTime - Date.parse(previous.timeAtSample);
        const sequenceDelta = raw.sequentialId - previous.sequentialId;
        const baseline = median(this.intervals);
        if (!silenceWasLogged && this.intervals.length >= 3 && deltaMs > Math.max(baseline * 3, baseline + 250) && now - (this.lastEmitted.get('sample-gap') ?? -Infinity) > baseline * 3) {
          events.push(this.event('sample-gap', `Sample interval ${(deltaMs / 1000).toFixed(2)} s exceeds learned cadence ${(baseline / 1000).toFixed(2)} s.`, raw, now, true));
          this.lastEmitted.set('sample-gap', now);
        }
        if (sequenceDelta > 0) { this.intervals.push(deltaMs / sequenceDelta); this.intervals = this.intervals.slice(-12); }
        const distance = distanceMeters(raw, previous);
        this.samePosition = distance < 0.00001 ? this.samePosition + 1 : 0;
        const frozen = this.samePosition >= 3 && Math.max(raw.velocityData.speedMetersPerSecond, previous.velocityData.speedMetersPerSecond) > 0.2;
        this.once('frozen-position', frozen, 'Repeated identical coordinates despite reported movement.', raw, now, events);
        const dt = deltaMs / 1000;
        let longitudeDelta = raw.longitude - previous.longitude;
        if (longitudeDelta > 180) longitudeDelta -= 360;
        if (longitudeDelta < -180) longitudeDelta += 360;
        const scale = Math.PI / 180 * 6371008.8;
        const heading = previous.velocityData.headingDegrees * Math.PI / 180;
        this.residuals.push({ east: longitudeDelta * scale * Math.cos(previous.latitude * Math.PI / 180) - previous.velocityData.speedMetersPerSecond * Math.sin(heading) * dt,
          north: (raw.latitude - previous.latitude) * scale - previous.velocityData.speedMetersPerSecond * Math.cos(heading) * dt,
          dt, accuracy: Math.max(raw.accuracyMeters, previous.accuracyMeters) });
        this.residuals = this.residuals.slice(-6);
        const residuals = this.residuals;
        const totalTime = residuals.reduce((sum, r) => sum + r.dt, 0);
        const sumEast = residuals.reduce((sum, r) => sum + r.east, 0), sumNorth = residuals.reduce((sum, r) => sum + r.north, 0);
        const net = Math.hypot(sumEast, sumNorth);
        const path = residuals.reduce((sum, r) => sum + Math.hypot(r.east, r.north), 0);
        const coherence = path ? net / path : 0;
        const uncertainty = median(residuals.map((r) => r.accuracy));
        const rms = Math.sqrt(residuals.reduce((sum, r) => sum + r.east ** 2 + r.north ** 2, 0) / residuals.length);
        this.once('gradual-drift', !frozen && residuals.length >= 4 && totalTime >= 3 && coherence > 0.8 && net > Math.max(2, uncertainty * 8) && net / totalTime > 0.15,
          `Persistent directional position/velocity disagreement (${(net / totalTime).toFixed(2)} m/s); drift or velocity bias is possible.`, raw, now, events);
        this.once('excessive-noise', !frozen && residuals.length >= 4 && coherence < 0.6 && rms > Math.max(1, uncertainty * 6),
          `Inconsistent position changes exceed reported accuracy (residual RMS ${rms.toFixed(2)} m).`, raw, now, events);
      }
      this.latest = raw;
    }
    this.highest = Math.max(this.highest, raw.sequentialId);
    return { measurement: raw, events };
  }
  tick(now: number): DetectedFault[] {
    const events = this.flushMissing(now);
    if (this.lastArrival !== null && this.intervals.length >= 3 && now - this.lastArrival > Math.max(1000, median(this.intervals) * 3) && !this.episodes.has('silence')) {
      this.episodes.add('silence');
      this.lastEmitted.set('sample-gap', now);
      events.push(this.event('sample-gap', 'No sensor measurement frames arrived within the learned cadence timeout.', null, now, true));
    }
    return events;
  }
  disconnected(now: number): DetectedFault { return this.event('connection-interruption', 'The sensor WebSocket closed unexpectedly. Cause is unknown from sensor transport alone.', null, now, true); }
}
