import { FaultInjector } from './faultInjector.js';
import type { FaultKind } from '../shared/faults.js';
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
  private injector: FaultInjector;
  private random: () => number;
  private motion: Motion;
  private sequence = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private running = false;
  private sampleTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSendUntil = 0;
  constructor(private settings: Readonly<SensorSettings>, private emit: (measurement: Measurement) => void, private onFaultChange: (state: FaultState) => void = () => {}, private onInterrupt: (ms: number) => void = () => {}) {
    this.injector = new FaultInjector(onFaultChange);
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
      const effect = this.injector.process(measurement, s.sampleIntervalMs);
      if (effect.disconnectMs) this.onInterrupt(effect.disconnectMs);
      const delay = this.random() * s.sendDelayMaxMs;
      this.pendingSendUntil = performance.now() + delay;
      this.later(() => {
        this.pendingSendUntil = 0;
        for (const reading of effect.readings) {
          reading.timeAtSend = new Date().toISOString();
          this.emit(reading);
        }
      }, delay);
      this.schedule(effect.pauseMs);
    }, waitMs + interval);
  }
  getFaultState(): FaultState { return this.injector.state(this.sequence); }
  triggerFault(kind: FaultKind): FaultState {
    const before = this.getFaultState();
    const state = this.injector.arm(kind, this.sequence);
    if (!before.pending && !before.active) this.later(() => this.onFaultChange(this.getFaultState()), 3000);
    return state;
  }
  triggerBadDataFault(): FaultState { return this.triggerFault('position-jump'); }
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
    if (this.running) this.schedule(Math.max(0, this.pendingSendUntil - performance.now(), this.injector.samplingPauseMs));
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
    this.injector.clear();
    this.motion.set({ north: 0, east: 0 });
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.sampleTimer = undefined;
    this.pendingSendUntil = 0;
  }
}
