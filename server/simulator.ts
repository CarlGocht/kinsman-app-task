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
  private random: () => number;
  private sequence = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private running = false;
  constructor(private settings: Readonly<SensorSettings>, private emit: (measurement: Measurement) => void) {
    this.random = seededRandom(settings.seed);
  }
  private later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.running) callback();
    }, delay);
    this.timers.add(timer);
  }
  private schedule() {
    const s = this.settings;
    const interval = s.sampleIntervalMs + (this.random() * 2 - 1) * s.sampleJitterMs;
    this.later(() => {
      const timeAtSample = new Date().toISOString();
      const radius = Math.sqrt(this.random()) * s.positionRadiusMeters;
      const angle = this.random() * 2 * Math.PI;
      const degreesPerMeter = 180 / (Math.PI * 6371008.8);
      const latitude = s.latitude + radius * Math.sin(angle) * degreesPerMeter;
      const longitude = ((s.longitude + radius * Math.cos(angle) * degreesPerMeter / Math.cos(s.latitude * Math.PI / 180) + 540) % 360) - 180;
      const measurement: Measurement = {
        sensorId: s.sensorId, uniqueId: randomUUID(), sequentialId: ++this.sequence,
        latitude, longitude, timeAtSample, timeAtSend: timeAtSample,
        accuracyMeters: s.accuracyMeters + (this.random() * 2 - 1) * s.accuracyJitterMeters,
        velocityData: {
          speedMetersPerSecond: this.random() * s.speedMaxMetersPerSecond,
          headingDegrees: ((this.random() * 2 - 1) * s.headingJitterDegrees + 360) % 360,
        },
      };
      this.later(() => {
        measurement.timeAtSend = new Date().toISOString();
        this.emit(measurement);
      }, this.random() * s.sendDelayMaxMs);
      this.schedule();
    }, interval);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }
  stop() {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
