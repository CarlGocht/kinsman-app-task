import { describe, expect, it } from 'vitest';
import { createPrediction, evaluatePrediction, predictionAt } from './prediction.js';
import { appendReading, emptyReadingHistory } from './readingHistory.js';
import { destination, distanceMeters } from '../shared/geo.js';
import type { Measurement } from '../shared/protocol.js';
const epoch = Date.UTC(2026, 0, 1);
function sample(id: number, ms: number, eastMeters = 0): Measurement {
  return { sensorId: 'sensor-1', uniqueId: `sample-${id}`, sequentialId: id,
    ...destination(43.6, -72.2, 90, eastMeters), accuracyMeters: 0.02,
    timeAtSample: new Date(epoch + ms).toISOString(), timeAtSend: new Date(epoch + ms + 1).toISOString(),
    velocityData: { speedMetersPerSecond: 20, headingDegrees: 90 } };
}
const history = [sample(3, 2000, 40), sample(2, 1000, 20), sample(1, 0)];

describe('saved constant-velocity area predictions', () => {
  it('predicts steady travel from the weighted trajectory', () => {
    const prediction = createPrediction(history, 1000)!;
    expect(distanceMeters(prediction, sample(4, 3000, 60))).toBeLessThan(0.01);
    expect(prediction.eastMetersPerSecond).toBeCloseTo(20, 3);
    expect(prediction.northMetersPerSecond).toBeCloseTo(0, 3);
    expect(prediction.sourceIds).not.toContain('sample-4');
    expect(prediction.targetTime).toBe(new Date(epoch + 3000).toISOString());
    expect(prediction.radiusMeters).toBeGreaterThan(0.02);
  });
  it('waits for distinct timestamps and handles a stationary sensor', () => {
    expect(createPrediction([history[0]], 1000)).toBeNull();
    expect(createPrediction([{ ...history[0] }, { ...history[0], uniqueId: 'other' }], 1000)).toBeNull();
    const prediction = createPrediction([sample(2, 1000), sample(1, 0)].map((s) => ({ ...s, velocityData: { speedMetersPerSecond: 0, headingDegrees: 359 } })), 1000)!;
    expect(distanceMeters(prediction, sample(3, 2000))).toBeLessThan(1e-6);
    expect(predictionAt(prediction, epoch + 4000).radiusMeters).toBeGreaterThan(prediction.radiusMeters);
  });
  it('scores actual sample time with a frozen model, independent of actual accuracy', () => {
    const prediction = createPrediction(history, 1000, 200)!;
    const before = structuredClone(prediction);
    const actual = { ...sample(4, 3100, 62), accuracyMeters: 1000 };
    const evaluation = evaluatePrediction(prediction, actual)!;
    expect(evaluation.errorMeters).toBeLessThan(0.01);
    expect(evaluation.insideArea).toBe(true);
    const miss = evaluatePrediction(prediction, { ...actual, ...destination(actual.latitude, actual.longitude, 0, 100) })!;
    expect(miss.insideArea).toBe(false);
    expect(miss.radiusMeters).toBe(evaluation.radiusMeters);
    expect(prediction).toEqual(before);
  });
  it('requires a matching target time and excludes its own source readings', () => {
    const prediction = createPrediction(history, 200)!;
    expect(prediction.targetTime).toBe(new Date(epoch + 2200).toISOString());
    expect(evaluatePrediction(prediction, history[0])).toBeNull();
    expect(evaluatePrediction(prediction, sample(4, 4000, 80))).toBeNull();
  });
  it('saves the forecast in prior state and evaluates it before admitting an outlier', () => {
    const first = appendReading(emptyReadingHistory(), sample(1, 0));
    const second = appendReading(first, sample(2, 1000, 20));
    const saved = second.predictions[0].prediction;
    const before = structuredClone(second);
    const third = appendReading(second, sample(3, 2000, 500));
    const result = third.pairs[0].predictionEvaluation!;
    expect(result.prediction).toBe(saved);
    expect(result.prediction.sourceIds).toEqual(['sample-2', 'sample-1']);
    expect(result.errorMeters).toBeGreaterThan(450);
    expect(result.insideArea).toBe(false);
    expect(second).toEqual(before);
    expect(third.predictions.find((entry) => entry.prediction.id === saved.id)!.evaluation).toBe(result);
  });
  it('can score a late reading against its original saved forecast without rewriting it', () => {
    let state = appendReading(emptyReadingHistory(), sample(1, 0));
    state = appendReading(state, sample(2, 1000, 20));
    const original = state.predictions[0].prediction;
    state = appendReading(state, sample(4, 3000, 60));
    const count = state.predictions.length;
    state = appendReading(state, sample(3, 2000, 40));
    expect(state.pairs[0].predictionEvaluation!.prediction).toBe(original);
    expect(state.predictions).toHaveLength(count);
    const result = state.pairs[0].predictionEvaluation;
    state = appendReading(state, sample(3, 2000, 40));
    expect(state.pairs[0].predictionEvaluation).toBeNull();
    expect(state.predictions.find((entry) => entry.prediction.id === original.id)!.evaluation).toBe(result);
  });
  it('fits across the date line and widens for reported-velocity disagreement', () => {
    const crossing = history.map((s, index) => ({ ...s, ...destination(0, 179.9999, 90, (2 - index) * 20) }));
    const prediction = createPrediction(crossing, 1000)!;
    expect(distanceMeters(prediction, destination(0, 179.9999, 90, 60))).toBeLessThan(0.01);
    const disagreeing = crossing.map((s) => ({ ...s, velocityData: { speedMetersPerSecond: 20, headingDegrees: 270 } }));
    expect(createPrediction(disagreeing, 1000)!.radiusMeters).toBeGreaterThan(prediction.radiusMeters + 30);
  });
  it('waits for loaded timing settings and resets the forecast ledger with the session', () => {
    let state = appendReading(emptyReadingHistory(), sample(1, 0), null);
    state = appendReading(state, sample(2, 1000, 20), null);
    expect(state.predictions).toEqual([]);
    expect(emptyReadingHistory().predictions).toEqual([]);
  });
});
