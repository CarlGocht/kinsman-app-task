import { describe, expect, it } from 'vitest';
import { accuracyBand } from './accuracyBand.js';
import { destination } from '../shared/geo.js';
import type { Measurement } from '../shared/protocol.js';

function sample(id: number, ms: number, eastMeters = 0): Measurement {
  return { sensorId: 'sensor-1', uniqueId: `sample-${id}`, sequentialId: id,
    ...destination(43.6, -72.2, 90, eastMeters), accuracyMeters: 0.02,
    timeAtSample: new Date(Date.UTC(2026, 0, 1) + ms).toISOString(), timeAtSend: new Date(Date.UTC(2026, 0, 1) + ms + 1).toISOString(),
    velocityData: { speedMetersPerSecond: 0, headingDegrees: 0 } };
}

describe('estimated accuracy band', () => {
  it('starts with sensor accuracy until independent history is available', () => {
    expect(accuracyBand(sample(1, 1000), [])).toMatchObject({ radiusMeters: 0.02, comparedSamples: 0, disagreementMeters: null });
  });
  it('never claims a narrower band than the sensor when readings agree', () => {
    const band = accuracyBand(sample(3, 2000), [sample(2, 1000), sample(1, 0)])!;
    expect(band.radiusMeters).toBe(0.02);
    expect(band.disagreementMeters).toBeLessThan(1e-6);
    expect(band.comparedSamples).toBe(2);
  });
  it('widens for disagreement and excludes the current sample from its history comparison', () => {
    const current = sample(2, 1000, 10);
    const band = accuracyBand(current, [current, sample(1, 0)])!;
    expect(band.disagreementMeters).toBeCloseTo(10, 5);
    expect(band.radiusMeters).toBeGreaterThan(10);
    expect(band.comparedSamples).toBe(1);
  });
  it('accounts for historical spread in addition to average disagreement', () => {
    const band = accuracyBand(sample(3, 2000), [sample(2, 1000, 1), sample(1, 0, -1)])!;
    expect(band.historySpreadMeters).toBeGreaterThan(0.9);
    expect(band.radiusMeters).toBeGreaterThan(band.disagreementMeters! + 0.9);
  });
  it('projects older readings forward so steady movement is not mistaken for disagreement', () => {
    const previous = { ...sample(1, 0), velocityData: { speedMetersPerSecond: 20, headingDegrees: 90 } };
    const current = sample(2, 1000, 20);
    const band = accuracyBand(current, [previous])!;
    expect(band.disagreementMeters).toBeLessThan(1e-6);
    expect(band.radiusMeters).toBeCloseTo(0.02, 6);
  });
  it('does not use future, same-time, expired or invalid-time samples as historical evidence', () => {
    const current = sample(4, 4000);
    const history = [sample(5, 5000), sample(6, 4000), sample(1, 1000), { ...sample(2, 2000), timeAtSample: 'invalid' }];
    expect(accuracyBand(current, history)!.comparedSamples).toBe(0);
  });
  it('leaves malformed raw readings without a band', () => {
    expect(accuracyBand({ ...sample(1, 0), accuracyMeters: 0 }, [])).toBeNull();
  });
});
