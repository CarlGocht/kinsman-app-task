import { describe, expect, it } from 'vitest';
import { SensorDetector, validateMeasurement } from './sensorDetector.js';
import { destination } from '../shared/geo.js';
import type { Measurement } from '../shared/protocol.js';
const epoch = Date.UTC(2026, 0, 1);
function sample(id: number, meters = 0, speed = 0): Measurement {
  return { sensorId: 'sensor-1', uniqueId: `sample-${id}`, sequentialId: id,
    ...destination(43.6, -72.2, 90, meters), timeAtSample: new Date(epoch + id * 1000).toISOString(), timeAtSend: new Date(epoch + id * 1000 + 1).toISOString(),
    accuracyMeters: 0.02, velocityData: { speedMetersPerSecond: speed, headingDegrees: 90 } };
}

describe('sensor-only stream detector', () => {
  it('accepts normal stationary and constant-velocity streams without alerts', () => {
    for (const speed of [0, 20]) {
      const detector = new SensorDetector();
      for (let id = 1; id <= 20; id++) expect(detector.observe(sample(id, id * speed, speed), id * 1000).events).toEqual([]);
    }
  });
  it('rejects malformed values before numerical consumers see them', () => {
    const detector = new SensorDetector();
    for (const value of [null, {}, { ...sample(1), latitude: 200 }, { ...sample(1), accuracyMeters: -1 }, { ...sample(1), velocityData: { speedMetersPerSecond: 'invalid' } }]) {
      const result = detector.observe(value, 0);
      expect(result.measurement).toBeNull();
      expect(result.events[0].reason).toBe('malformed');
      expect(result.events[0].confidence).toBe('observed');
    }
    expect(validateMeasurement(sample(1))).toEqual([]);
  });
  it('rejects duplicate measurement IDs and reports late/out-of-order arrivals', () => {
    const detector = new SensorDetector();
    detector.observe(sample(1), 1000);
    expect(detector.observe(sample(1), 1010)).toMatchObject({ measurement: null, events: [{ reason: 'duplicate' }] });
    detector.observe(sample(3), 3000);
    expect(detector.observe(sample(2), 3010).events.map((event) => event.reason)).toContain('out-of-order');
    expect(detector.tick(6000).some((event) => event.reason === 'missing-samples')).toBe(false);
  });
  it('reports permanently missing IDs only after a reorder grace period', () => {
    const detector = new SensorDetector();
    detector.observe(sample(1), 1000); detector.observe(sample(4), 4000);
    expect(detector.tick(4100).some((event) => event.reason === 'missing-samples')).toBe(false);
    expect(detector.tick(5600).find((event) => event.reason === 'missing-samples')?.detail).toContain('2, 3');
  });
  it('learns cadence, detects silence and does not repeat an ongoing timeout', () => {
    const detector = new SensorDetector();
    for (let id = 1; id <= 5; id++) detector.observe(sample(id), id * 1000);
    expect(detector.tick(8100).map((event) => event.reason)).toContain('sample-gap');
    expect(detector.tick(9000)).toEqual([]);
    const delayed = { ...sample(6), timeAtSample: new Date(epoch + 10000).toISOString(), timeAtSend: new Date(epoch + 10001).toISOString() };
    expect(detector.observe(delayed, 10000).events.some((event) => event.reason === 'sample-gap')).toBe(false);
  });
  it('detects frozen coordinates with reported movement, but does not invent evidence while stationary', () => {
    for (const speed of [0, 20]) {
      const detector = new SensorDetector();
      const events = Array.from({ length: 8 }, (_, i) => detector.observe(sample(i + 1, 0, speed), (i + 1) * 1000).events).flat();
      expect(events.some((event) => event.reason === 'frozen-position')).toBe(speed > 0);
    }
  });
  it('suspects drift from persistent position/velocity disagreement, not from coherent motion alone', () => {
    for (const reported of [0, 1]) {
      const detector = new SensorDetector();
      const events = Array.from({ length: 10 }, (_, i) => detector.observe(sample(i + 1, i + 1, reported), (i + 1) * 1000).events).flat();
      expect(events.some((event) => event.reason === 'gradual-drift')).toBe(reported === 0);
    }
  });
  it('suspects excessive noise from inconsistent jumps relative to reported accuracy/velocity', () => {
    const detector = new SensorDetector();
    const events = Array.from({ length: 12 }, (_, i) => detector.observe(sample(i + 1, i % 2 ? 20 : -20), (i + 1) * 1000).events).flat();
    expect(events.some((event) => event.reason === 'excessive-noise')).toBe(true);
  });
  it('records observed socket interruption without guessing its cause', () => {
    expect(new SensorDetector().disconnected(100)).toMatchObject({ reason: 'connection-interruption', confidence: 'observed', sequentialId: null });
  });
});
