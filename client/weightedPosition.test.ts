import { describe, expect, it } from 'vitest';
import type { Measurement } from '../shared/protocol.js';
import { weightedPosition } from './weightedPosition.js';

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
    expect(weightedPosition([sample(2, 43.600002, 0.02), one])!.latitude).toBeCloseTo(43.600001, 10);
    expect(weightedPosition([sample(2, 43.600002, 0.02), one])!.sources).toHaveLength(2);
  });
  it('equally weights equal accuracies and reports nominal combined accuracy', () => {
    const result = weightedPosition([sample(3, 43.600006, 0.02), sample(2, 43.600003, 0.02), sample(1, 43.6, 0.02)])!;
    expect(result.latitude).toBeCloseTo(43.600003, 10);
    expect(result.accuracyMeters).toBeCloseTo(0.02 / Math.sqrt(3), 12);
    for (const source of result.sources) expect(source.weight).toBeCloseTo(1 / 3, 12);
  });
  it('gives 1 cm accuracy four times the weight of 2 cm accuracy', () => {
    const result = weightedPosition([sample(3, 43.600006, 0.01), sample(2, 43.6, 0.02), sample(1, 43.6, 0.02)])!;
    expect(result.latitude).toBeCloseTo(43.600004, 10);
    expect(result.sources[0].weight / result.sources[1].weight).toBe(4);
    expect(result.sources.reduce((sum, source) => sum + source.weight, 0)).toBeCloseTo(1, 12);
  });
  it('slides over only the latest three samples and preserves raw input', () => {
    const input = [sample(4, 43.600009, 0.02), sample(3, 43.600006, 0.02), sample(2, 43.600003, 0.02), sample(1, 10, 0.0001)];
    const before = structuredClone(input);
    const result = weightedPosition(input)!;
    expect(result.latitude).toBeCloseTo(43.600006, 10);
    expect(result.sources.map((source) => source.sequentialId)).toEqual([4, 3, 2]);
    expect(result.timeAtSample).toBe(input[0].timeAtSample);
    expect(input).toEqual(before);
  });
  it('averages across the date line without jumping to zero longitude', () => {
    const result = weightedPosition([sample(2, 0, 0.02, 179.999), sample(1, 0, 0.02, -179.999)])!;
    expect(Math.abs(result.longitude)).toBeCloseTo(180, 10);
  });
  it.each([0, -1, NaN, Infinity])('declines invalid reported accuracy %s', (accuracy) => {
    expect(weightedPosition([sample(1, 43.6, accuracy)])).toBeNull();
  });
  it('does not silently replace invalid coordinates with older readings', () => {
    expect(weightedPosition([sample(3, NaN, 0.02), sample(2, 43.6, 0.02), sample(1, 43.6, 0.02)])).toBeNull();
  });
});
