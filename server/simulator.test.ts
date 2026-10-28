import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Measurement } from '../shared/protocol.js';
import { createSettings } from './settings.js';
import { Simulator } from './simulator.js';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function run(seed: number, interval = 1000) {
  const measurements: Measurement[] = [];
  const settings = createSettings({ seed, sampleIntervalMs: interval });
  const simulator = new Simulator(settings, (sample) => measurements.push(sample));
  simulator.start();
  return { settings, simulator, measurements };
}

describe('stationary simulator', () => {
  it('keeps 1000 samples within the disk without drift, with valid IDs and fields', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-01-01T00:00:00Z');
    const { simulator, measurements, settings } = run(42);
    vi.advanceTimersByTime(1_010_000);
    simulator.stop();
    expect(measurements.length).toBeGreaterThanOrEqual(1000);
    expect(new Set(measurements.map((m) => m.uniqueId)).size).toBe(measurements.length);
    for (const [index, m] of measurements.entries()) {
      const north = (m.latitude - settings.latitude) * Math.PI / 180 * 6371008.8;
      const east = (m.longitude - settings.longitude) * Math.PI / 180 * 6371008.8 * Math.cos(settings.latitude * Math.PI / 180);
      expect(Math.hypot(north, east)).toBeLessThanOrEqual(0.0100001);
      expect(m.sensorId).toBe('sensor-1');
      expect(m.sequentialId).toBe(index + 1);
      expect(m.uniqueId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(m.accuracyMeters).toBeGreaterThanOrEqual(0.015);
      expect(m.accuracyMeters).toBeLessThanOrEqual(0.025);
      expect(m.velocityData.speedMetersPerSecond).toBeGreaterThanOrEqual(0);
      expect(m.velocityData.speedMetersPerSecond).toBeLessThanOrEqual(0.005);
      const heading = m.velocityData.headingDegrees;
      expect(heading >= 0 && heading < 360 && (heading <= 2 || heading >= 358)).toBe(true);
      const sent = Date.parse(m.timeAtSend), sampled = Date.parse(m.timeAtSample);
      expect(sent - sampled).toBeGreaterThanOrEqual(0);
      expect(sent - sampled).toBeLessThanOrEqual(5);
      if (index) {
        const delta = sampled - Date.parse(measurements[index - 1].timeAtSample);
        expect(delta).toBeGreaterThanOrEqual(990);
        expect(delta).toBeLessThanOrEqual(1010);
      }
    }
  });
  it('reproduces noise and schedule with the same seed and clock, independently of UUIDs', () => {
    vi.useFakeTimers();
    function capture(seed: number) {
      vi.setSystemTime('2026-01-01T00:00:00Z');
      const { simulator, measurements } = run(seed);
      vi.advanceTimersByTime(10000); simulator.stop();
      return measurements.map(({ uniqueId, ...rest }) => rest);
    }
    const first = capture(42);
    expect(capture(42)).toEqual(first);
    expect(capture(43)).not.toEqual(first);
  });
  it('uses overridden timing and stops pending samples and sends', () => {
    vi.useFakeTimers();
    const { simulator, measurements } = run(42, 100);
    simulator.start(); // Starting twice must not create another sampling loop.
    vi.advanceTimersByTime(1000);
    expect(measurements.length).toBeGreaterThanOrEqual(9);
    expect(measurements.length).toBeLessThanOrEqual(11);
    simulator.stop();
    expect(vi.getTimerCount()).toBe(0);
    const count = measurements.length;
    vi.advanceTimersByTime(1000);
    expect(measurements).toHaveLength(count);
  });
  it('clears a pending send on shutdown', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const simulator = new Simulator(createSettings({ seed: 42, sampleJitterMs: 0 }), emit);
    simulator.start(); vi.advanceTimersByTime(1000); simulator.stop();
    vi.advanceTimersByTime(100);
    expect(emit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
