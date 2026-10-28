import { createPrediction, evaluatePrediction } from './prediction.js';
import type { PredictionEvaluation, SavedPrediction } from './prediction.js';
import { accuracyBand } from './accuracyBand.js';
import type { AccuracyBand } from './accuracyBand.js';
import type { Measurement } from '../shared/protocol.js';
import { positionWindow, weightedPosition } from './weightedPosition.js';
import type { WeightedPosition } from './weightedPosition.js';

export interface ReadingPair {
  raw: Measurement;
  weighted: WeightedPosition | null;
  band: AccuracyBand | null;
  predictionEvaluation: PredictionEvaluation | null;
}
export interface ReadingHistory {
  window: Measurement[];
  pairs: ReadingPair[];
  predictions: SavedPrediction[];
}
export function emptyReadingHistory(): ReadingHistory { return { window: [], pairs: [], predictions: [] }; }

// Snapshot the estimate on receipt. Later arrivals never rewrite an earlier pair.
export function appendReading(previous: ReadingHistory, raw: Measurement, timing: { sampleIntervalMs: number; sampleJitterMs: number } | null = { sampleIntervalMs: 1000, sampleJitterMs: 10 }): ReadingHistory {
  // Score ONLY forecasts already saved in previous state, before admitting raw.
  const duplicate = previous.pairs.some((pair) => pair.raw.uniqueId === raw.uniqueId);
  const candidates = duplicate ? [] : previous.predictions.flatMap((saved) => {
    if (saved.evaluation) return [];
    const evaluation = evaluatePrediction(saved.prediction, raw);
    return evaluation ? [evaluation] : [];
  }).sort((a, b) => Math.abs(Date.parse(a.prediction.targetTime) - Date.parse(raw.timeAtSample)) - Math.abs(Date.parse(b.prediction.targetTime) - Date.parse(raw.timeAtSample)));
  const predictionEvaluation = candidates[0] ?? null;
  let predictions = previous.predictions.map((saved) => predictionEvaluation?.prediction.id === saved.prediction.id ? { ...saved, evaluation: predictionEvaluation } : saved);
  const window = positionWindow([raw, ...previous.window]);
  const pair: ReadingPair = { raw, weighted: weightedPosition(window), band: accuracyBand(raw, previous.window), predictionEvaluation };
  const advancesTime = !previous.window.length || Date.parse(raw.timeAtSample) > Date.parse(previous.window[0].timeAtSample);
  if (advancesTime && timing) {
    const forecast = createPrediction(window, timing.sampleIntervalMs, timing.sampleJitterMs);
    if (forecast) predictions = [{ prediction: forecast, evaluation: null }, ...predictions].slice(0, 50);
  }
  return { window, pairs: [pair, ...previous.pairs].slice(0, 50), predictions };
}
