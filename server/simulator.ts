import { destination } from '../shared/geo.js';
import { Motion } from './motion.js';
import type { FaultState, MovementCommand } from '../shared/protocol.js';
import { randomUUID } from 'node:crypto';
import type { Measurement, SensorSettings } from '../shared/protocol.js';

// Mulberry32: deterministic simulation noise; UUIDs use independent crypto randomness.
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class Simulator {
  private faultPending = false;
  private faultDueAt = 0;
  private faultEligibleAt: string | null = null;
  private lastInjected: FaultState['lastInjected'] = null;
  private random: () => number;
  private motion: Motion;
  private sequence = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private running = false;
  private sampleTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSendUntil = 0;
  constructor(private settings: Readonly<SensorSettings>, private emit: (measurement: Measurement) => void, private onFaultChange: (state: FaultState) => void = () => {}) {
    this.random = seededRandom(settings.seed);
    this.motion = new Motion(settings);
  }
  private later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.running) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }
  private schedule(waitMs = 0) {
    const interval = this.settings.sampleIntervalMs + (this.random() * 2 - 1) * this.settings.sampleJitterMs;
    this.sampleTimer = this.later(() => {
      this.sampleTimer = undefined;
      const s = this.settings;
      const motion = this.motion.get();
      const timeAtSample = new Date().toISOString();
      const radius = Math.sqrt(this.random()) * s.positionRadiusMeters;
      const angle = this.random() * 2 * Math.PI;
      const degreesPerMeter = 180 / (Math.PI * 6371008.8);
      const latitude = motion.latitude + radius * Math.sin(angle) * degreesPerMeter;
      const longitude = ((motion.longitude + radius * Math.cos(angle) * degreesPerMeter / Math.cos(motion.latitude * Math.PI / 180) + 540) % 360) - 180;
      const measurement: Measurement = {
        sensorId: s.sensorId, uniqueId: randomUUID(), sequentialId: ++this.sequence,
        latitude, longitude, timeAtSample, timeAtSend: timeAtSample,
        accuracyMeters: s.accuracyMeters + (this.random() * 2 - 1) * s.accuracyJitterMeters,
        velocityData: {
          speedMetersPerSecond: motion.speedMetersPerSecond > 0
            ? Math.max(0, motion.speedMetersPerSecond + (this.random() * 2 - 1) * s.speedMaxMetersPerSecond)
            : this.random() * s.speedMaxMetersPerSecond,
          headingDegrees: (motion.headingDegrees + (this.random() * 2 - 1) * s.headingJitterDegrees + 360) % 360,
        },
      };
      if (this.faultPending && performance.now() >= this.faultDueAt) {
        Object.assign(measurement, destination(measurement.latitude, measurement.longitude, 90, 50));
        this.faultPending = false;
        this.faultEligibleAt = null;
        this.lastInjected = { uniqueId: measurement.uniqueId, sequentialId: measurement.sequentialId, timeAtSample };
        this.onFaultChange(this.getFaultState());
      }
      const delay = this.random() * s.sendDelayMaxMs;
      this.pendingSendUntil = performance.now() + delay;
      this.later(() => {
        this.pendingSendUntil = 0;
        measurement.timeAtSend = new Date().toISOString();
        this.emit(measurement);
      }, delay);
      this.schedule();
    }, waitMs + interval);
  }
  getFaultState(): FaultState {
    const remainingDelayMs = this.faultPending ? Math.max(0, this.faultDueAt - performance.now()) : 0;
    return { pending: this.faultPending, delayMs: 3000, remainingDelayMs, eligibleAt: this.faultEligibleAt,
      targetSequentialId: this.faultPending && remainingDelayMs === 0 ? this.sequence + 1 : null,
      offsetMeters: 50, headingDegrees: 90, lastInjected: this.lastInjected };
  }
  triggerBadDataFault(): FaultState {
    // Repeated requests neither stack faults nor restart the countdown.
    if (this.faultPending) return this.getFaultState();
    this.faultPending = true;
    this.faultDueAt = performance.now() + 3000;
    this.faultEligibleAt = new Date(Date.now() + 3000).toISOString();
    this.later(() => { if (this.faultPending) this.onFaultChange(this.getFaultState()); }, 3000);
    const state = this.getFaultState();
    this.onFaultChange(state);
    return state;
  }
  updateSettings(settings: Readonly<SensorSettings>) {
    const timingChanged = this.settings.sampleIntervalMs !== settings.sampleIntervalMs
      || this.settings.sampleJitterMs !== settings.sampleJitterMs
      || this.settings.sendDelayMaxMs !== settings.sendDelayMaxMs;
    this.settings = settings;
    if (!timingChanged) return;
    if (this.sampleTimer !== undefined) {
      clearTimeout(this.sampleTimer);
      this.timers.delete(this.sampleTimer);
      this.sampleTimer = undefined;
    }
    if (this.running) this.schedule(Math.max(0, this.pendingSendUntil - performance.now()));
  }
  setMovement(command: MovementCommand) { return this.motion.set(command); }
  getMovement() { return this.motion.get(); }
  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }
  stop() {
    this.running = false;
    this.faultPending = false;
    this.faultDueAt = 0;
    this.faultEligibleAt = null;
    this.motion.set({ north: 0, east: 0 });
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.sampleTimer = undefined;
    this.pendingSendUntil = 0;
  }
}
