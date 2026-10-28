import { describe, expect, it } from 'vitest';
import type { Measurement } from '../shared/protocol.js';
import { positionWindow, weightedPosition } from './weightedPosition.js';

function sample(id: number, latitude: number, accuracyMeters: number, longitude = -72.2): Measurement {
  return { sensorId: 'sensor-1', uniqueId: `sample-${id}`, sequentialId: id,
    latitude, longitude, accuracyMeters,
    timeAtSample: `2026-01-01T00:00:0${id}.000Z`, timeAtSend: `2026-01-01T00:00:0${id}.001Z`,
    velocityData: { speedMetersPerSecond: 0, headingDegrees: 0 } };
}

describe('client weighted position', () => {
  it('has no estimate before any readings arrive', () => {
    expect(weightedPosition([])).toBeNull();
  });
  it('warms up with one and two available samples', () => {
    const one = sample(1, 43.6, 0.02);
    expect(weightedPosition([one])).toMatchObject({ latitude: one.latitude, longitude: one.longitude, accuracyMeters: 0.02, sources: [{ sequentialId: 1, uniqueId: 'sample-1', weight: 1 }] });
    expect(weightedPosition([sample(2, 43.600002, 0.02), one])!.latitude).toBeCloseTo(43.6000011150133, 10);
    expect(weightedPosition([sample(2, 43.600002, 0.02), one])!.sources).toHaveLength(2);
  });
  it('equally weights equal accuracies and reports nominal combined accuracy', () => {
    const result = weightedPosition([sample(3, 43.600006, 0.02), sample(2, 43.600003, 0.02), sample(1, 43.6, 0.02)].map((sample) => ({ ...sample, timeAtSample: '2026-01-01T00:00:03.000Z' })))!;
    expect(result.latitude).toBeCloseTo(43.600003, 10);
    expect(result.accuracyMeters).toBeCloseTo(0.02 / Math.sqrt(3), 12);
    for (const source of result.sources) expect(source.weight).toBeCloseTo(1 / 3, 12);
  });
  it('gives 1 cm accuracy four times the weight of 2 cm accuracy', () => {
    const result = weightedPosition([sample(3, 43.600006, 0.01), sample(2, 43.6, 0.02), sample(1, 43.6, 0.02)].map((sample) => ({ ...sample, timeAtSample: '2026-01-01T00:00:03.000Z' })))!;
    expect(result.latitude).toBeCloseTo(43.600004, 10);
    expect(result.sources[0].weight / result.sources[1].weight).toBe(4);
    expect(result.sources.reduce((sum, source) => sum + source.weight, 0)).toBeCloseTo(1, 12);
  });
  it('excludes the exact three-second boundary and preserves raw input', () => {
    const input = [sample(4, 43.600009, 0.02), sample(3, 43.600006, 0.02), sample(2, 43.600003, 0.02), sample(1, 10, 0.0001)];
    const before = structuredClone(input);
    const result = weightedPosition(input)!;
    expect(result.latitude).toBeGreaterThan(43.600006);
    expect(result.latitude).toBeLessThan(43.600009);
    expect(result.sources.map((source) => source.sequentialId)).toEqual([4, 3, 2]);
    expect(result.timeAtSample).toBe(input[0].timeAtSample);
    expect(input).toEqual(before);
  });
  it('averages across the date line without jumping to zero longitude', () => {
    const result = weightedPosition([sample(2, 0, 0.02, 179.999), sample(1, 0, 0.02, -179.999)].map((sample) => ({ ...sample, timeAtSample: '2026-01-01T00:00:02.000Z' })))!;
    expect(Math.abs(result.longitude)).toBeCloseTo(180, 10);
  });
  it.each([0, -1, NaN, Infinity])('declines invalid reported accuracy %s', (accuracy) => {
    expect(weightedPosition([sample(1, 43.6, accuracy)])).toBeNull();
  });
  it('does not silently replace invalid coordinates with older readings', () => {
    expect(weightedPosition([sample(3, NaN, 0.02), sample(2, 43.6, 0.02), sample(1, 43.6, 0.02)])).toBeNull();
  });
});

function timed(id: number, ms: number, latitude = 43.6) {
  return { ...sample(id, latitude, 0.02), timeAtSample: new Date(Date.UTC(2026, 0, 1) + ms).toISOString() };
}

describe('sample-time position window', () => {
  it('includes all high-rate samples in three seconds rather than only three or fifty', () => {
    let window: Measurement[] = [];
    for (let id = 0; id <= 300; id++) window = positionWindow([timed(id, id * 10), ...window]);
    expect(window).toHaveLength(300);
    expect(window[0].sequentialId).toBe(300);
    expect(window.at(-1)!.sequentialId).toBe(1);
    expect(weightedPosition(window)!.sources).toHaveLength(300);
  });
  it('includes only the latest available sample at a rate slower than the window', () => {
    expect(weightedPosition([timed(3, 10000), timed(2, 5000), timed(1, 0)])!.sources.map((source) => source.sequentialId)).toEqual([3]);
  });
  it('produces the same weighted result regardless of arrival order', () => {
    const points = [timed(4, 4000, 43.600004), timed(3, 3000, 43.600003), timed(2, 2000, 43.600002), timed(1, 0, 43.6)];
    const expected = weightedPosition(points);
    expect(weightedPosition([points[2], points[0], points[3], points[1]])).toEqual(expected);
    expect(expected!.timeAtSample).toBe(points[0].timeAtSample);
  });
  it('accepts late samples inside the window and ignores older samples without rewinding', () => {
    let window = positionWindow([timed(4, 4000), timed(2, 2000)]);
    window = positionWindow([timed(3, 2500), ...window]);
    expect(window.map((sample) => sample.sequentialId)).toEqual([4, 3, 2]);
    const previous = weightedPosition(window);
    expect(weightedPosition([timed(1, 1000, 0), ...window])).toEqual(previous);
    window = positionWindow([timed(5, 5000), ...window]);
    expect(window.map((sample) => sample.sequentialId)).toEqual([5, 4, 3]);
  });
  it('uses sample time rather than send time and ignores invalid timestamps', () => {
    const latest = timed(2, 5000);
    const old = { ...timed(1, 0), timeAtSend: new Date(Date.UTC(2026, 0, 1) + 100000).toISOString() };
    const invalid = { ...timed(3, 6000), timeAtSample: 'invalid' };
    expect(positionWindow([old, invalid, latest])).toEqual([latest]);
    expect(weightedPosition([invalid])).toBeNull();
  });
  it('counts duplicate IDs once but keeps distinct samples at the same timestamp', () => {
    const first = timed(1, 1000);
    expect(positionWindow([first, timed(2, 1000), first]).map((sample) => sample.sequentialId)).toEqual([2, 1]);
    expect(weightedPosition([first, first])!.accuracyMeters).toBe(0.02);
  });
});

describe('recency weighting', () => {
  it('gently downweights older samples using sample time rather than arrival order', () => {
    const result = weightedPosition([timed(1, 0), timed(3, 2000), timed(2, 1000)])!;
    expect(result.sources.map((source) => source.sequentialId)).toEqual([3, 2, 1]);
    expect(result.sources[1].weight / result.sources[0].weight).toBeCloseTo(2 ** (-1 / 3), 12);
    expect(result.sources[2].weight / result.sources[0].weight).toBeCloseTo(2 ** (-2 / 3), 12);
    expect(result.sources[0].weight).toBeGreaterThan(result.sources[1].weight);
  });
  it('combines recency with reported accuracy rather than replacing accuracy weights', () => {
    const olderPrecise = { ...timed(1, 1000), accuracyMeters: 0.01 };
    const current = timed(2, 2000);
    const result = weightedPosition([current, olderPrecise])!;
    expect(result.sources[1].weight / result.sources[0].weight).toBeCloseTo(4 * 2 ** (-1 / 3), 12);
  });
});
