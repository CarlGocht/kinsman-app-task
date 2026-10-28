import { describe, expect, it } from 'vitest';
import { appendReading, emptyReadingHistory } from './readingHistory.js';
import type { Measurement } from '../shared/protocol.js';

function sample(id: number, ms: number, latitude = 43.6): Measurement {
  return { sensorId: 'sensor-1', uniqueId: `sample-${id}`, sequentialId: id,
    latitude, longitude: -72.2, accuracyMeters: 0.02,
    timeAtSample: new Date(Date.UTC(2026, 0, 1) + ms).toISOString(), timeAtSend: new Date(Date.UTC(2026, 0, 1) + ms + 1).toISOString(),
    velocityData: { speedMetersPerSecond: 0, headingDegrees: 0 } };
}

describe('paired raw and weighted reading history', () => {
  it('stores the raw measurement and its current weighted snapshot atomically', () => {
    const first = sample(1, 0);
    const state = appendReading(emptyReadingHistory(), first);
    expect(state.pairs[0].raw).toBe(first);
    expect(state.pairs[0].weighted).toMatchObject({ latitude: first.latitude, timeAtSample: first.timeAtSample });
    const next = appendReading(state, sample(2, 1000, 43.600002));
    expect(next.pairs[0].weighted!.latitude).toBeCloseTo(43.6000011150133, 10);
    expect(next.pairs[0].weighted!.sources.map((source) => source.sequentialId)).toEqual([2, 1]);
  });
  it('does not rewrite earlier pairs when new or out-of-order data arrives', () => {
    const first = appendReading(emptyReadingHistory(), sample(1, 1000));
    const snapshot = structuredClone(first);
    const second = appendReading(first, sample(3, 3000, 43.600006));
    const late = appendReading(second, sample(2, 2000, 43.600003));
    expect(first).toEqual(snapshot);
    expect(late.pairs[2]).toBe(first.pairs[0]);
    expect(late.pairs[1]).toBe(second.pairs[0]);
    expect(late.pairs[0].raw.sequentialId).toBe(2);
    expect(late.pairs[0].weighted!.sources).toHaveLength(3);
    expect(late.pairs[0].weighted!.timeAtSample).toBe(second.pairs[0].raw.timeAtSample);
  });
  it('caps history at 50 complete pairs while keeping every sample in the time window', () => {
    let state = emptyReadingHistory();
    for (let id = 0; id < 100; id++) state = appendReading(state, sample(id, id * 20));
    expect(state.pairs).toHaveLength(50);
    expect(state.window).toHaveLength(100);
    expect(state.pairs[0].weighted!.sources).toHaveLength(100);
    expect(state.pairs.at(-1)!.raw.sequentialId).toBe(50);
    expect(state.pairs.at(-1)!.weighted!.sources).toHaveLength(51);
    expect(emptyReadingHistory()).toEqual({ pairs: [], window: [], retained: [], predictions: [], detections: [] });
  });
  it('preserves raw data when its estimate is unavailable', () => {
    const raw = { ...sample(1, 0), accuracyMeters: 0 };
    expect(appendReading(emptyReadingHistory(), raw).pairs[0]).toEqual({ raw, weighted: null, band: null, predictionEvaluation: null });
  });
});

describe('changing historical lookback', () => {
  it('expands from retained samples and shrinks future snapshots without rewriting saved pairs', () => {
    const timing = { sampleIntervalMs: 1000, sampleJitterMs: 0, historyWindowSeconds: 1 };
    let state = emptyReadingHistory();
    for (let id = 0; id < 4; id++) state = appendReading(state, sample(id, id * 1000), timing);
    expect(state.window).toHaveLength(1);
    expect(state.retained).toHaveLength(4);
    const oldPair = state.pairs[0];
    state = appendReading(state, sample(4, 4000), { ...timing, historyWindowSeconds: 5 });
    expect(state.window).toHaveLength(5);
    expect(state.pairs[0].weighted!.windowMs).toBe(5000);
    expect(state.pairs[0].band!.comparedSamples).toBe(4);
    expect(state.predictions[0].prediction.historyWindowMs).toBe(5000);
    expect(state.pairs[1]).toBe(oldPair);
    expect(oldPair.weighted!.windowMs).toBe(1000);
    expect(oldPair.weighted!.sources).toHaveLength(1);
    state = appendReading(state, sample(5, 5000), { ...timing, historyWindowSeconds: 0.5 });
    expect(state.window).toHaveLength(1);
    expect(state.retained).toHaveLength(6);
    expect(state.pairs[0].weighted!.windowMs).toBe(500);
  });
});

describe('independent position anomaly detection', () => {
  it('logs misses against saved forecasts once without consulting injector metadata', () => {
    let state = appendReading(emptyReadingHistory(), sample(1, 0));
    state = appendReading(state, sample(2, 1000));
    const anomaly = sample(3, 2000, 43.601);
    state = appendReading(state, anomaly);
    expect(state.detections).toHaveLength(1);
    expect(state.detections[0]).toMatchObject({ sampleId: anomaly.uniqueId, sequentialId: 3, reason: 'outside-prediction-area' });
    expect(state.detections[0].errorMeters).toBeGreaterThan(state.detections[0].radiusMeters);
    const detection = state.detections[0];
    state = appendReading(state, anomaly);
    expect(state.detections).toHaveLength(1);
    expect(state.detections[0]).toBe(detection);
  });
  it('does not flag normal readings or readings without a matching saved forecast', () => {
    let state = appendReading(emptyReadingHistory(), sample(1, 0));
    state = appendReading(state, sample(2, 1000));
    state = appendReading(state, sample(3, 2000));
    state = appendReading(state, sample(4, 10000, 43.601));
    expect(state.detections).toEqual([]);
    expect(emptyReadingHistory().detections).toEqual([]);
  });
});

describe('prediction recovery after a detected anomaly', () => {
  it('retains bad data for review while preventing it from poisoning the next forecast', () => {
    let state = appendReading(emptyReadingHistory(), sample(1, 0));
    state = appendReading(state, sample(2, 1000));
    const bad = sample(3, 2000, 43.601);
    state = appendReading(state, bad);
    expect(state.detections).toHaveLength(1);
    expect(state.predictions.some((saved) => saved.prediction.sourceIds.includes(bad.uniqueId))).toBe(false);
    state = appendReading(state, sample(4, 3000));
    expect(state.pairs[0].predictionEvaluation).toBeNull();
    expect(state.predictions[0].prediction.sourceIds).not.toContain(bad.uniqueId);
    state = appendReading(state, sample(5, 4000));
    expect(state.detections).toHaveLength(1);
    expect(state.pairs.find((pair) => pair.raw.uniqueId === bad.uniqueId)).toBeDefined();
    expect(state.pairs[0].weighted!.sources.some((source) => source.uniqueId === bad.uniqueId)).toBe(true);
  });
});
