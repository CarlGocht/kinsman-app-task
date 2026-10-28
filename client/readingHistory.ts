import { HISTORY_WINDOW_LIMITS } from '../shared/settingsControls.js';
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
export interface DetectedFault {
  sampleId: string;
  sequentialId: number;
  timeAtSample: string;
  predictionId: string;
  errorMeters: number;
  radiusMeters: number;
  reason: 'outside-prediction-area';
}
export interface ReadingHistory {
  window: Measurement[];
  retained: Measurement[];
  pairs: ReadingPair[];
  predictions: SavedPrediction[];
  detections: DetectedFault[];
}
export function emptyReadingHistory(): ReadingHistory { return { window: [], retained: [], pairs: [], predictions: [], detections: [] }; }

// Snapshot the estimate on receipt. Later arrivals never rewrite an earlier pair.
export function appendReading(previous: ReadingHistory, raw: Measurement, timing: { sampleIntervalMs: number; sampleJitterMs: number; historyWindowSeconds?: number } | null = { sampleIntervalMs: 1000, sampleJitterMs: 10 }): ReadingHistory {
  // Score ONLY forecasts already saved in previous state, before admitting raw.
  const duplicate = previous.pairs.some((pair) => pair.raw.uniqueId === raw.uniqueId);
  const candidates = duplicate ? [] : previous.predictions.flatMap((saved) => {
    if (saved.evaluation) return [];
    const evaluation = evaluatePrediction(saved.prediction, raw);
    return evaluation ? [evaluation] : [];
  }).sort((a, b) => Math.abs(Date.parse(a.prediction.targetTime) - Date.parse(raw.timeAtSample)) - Math.abs(Date.parse(b.prediction.targetTime) - Date.parse(raw.timeAtSample)));
  const predictionEvaluation = candidates[0] ?? null;
  const detections: DetectedFault[] = predictionEvaluation && !predictionEvaluation.insideArea
    && !previous.detections.some((fault) => fault.sampleId === raw.uniqueId)
    ? [{ sampleId: raw.uniqueId, sequentialId: raw.sequentialId, timeAtSample: raw.timeAtSample,
      predictionId: predictionEvaluation.prediction.id, errorMeters: predictionEvaluation.errorMeters,
      radiusMeters: predictionEvaluation.radiusMeters, reason: 'outside-prediction-area' as const }, ...previous.detections].slice(0, 50)
    : previous.detections;
  let predictions = previous.predictions.map((saved) => predictionEvaluation?.prediction.id === saved.prediction.id ? { ...saved, evaluation: predictionEvaluation } : saved);
  const windowMs = (timing?.historyWindowSeconds ?? HISTORY_WINDOW_LIMITS.default) * 1000;
  const retained = positionWindow([raw, ...previous.retained], HISTORY_WINDOW_LIMITS.max * 1000);
  const window = positionWindow(retained, windowMs);
  const pair: ReadingPair = { raw, weighted: weightedPosition(window, windowMs), band: accuracyBand(raw, previous.retained, windowMs), predictionEvaluation };
  const advancesTime = !previous.window.length || Date.parse(raw.timeAtSample) > Date.parse(previous.window[0].timeAtSample);
  const rejected = predictionEvaluation !== null && !predictionEvaluation.insideArea;
  if (advancesTime && timing && !rejected) {
    const cleanWindow = window.filter((sample) => !detections.some((fault) => fault.sampleId === sample.uniqueId));
    const forecast = createPrediction(cleanWindow, timing.sampleIntervalMs, timing.sampleJitterMs, windowMs);
    if (forecast) predictions = [{ prediction: forecast, evaluation: null }, ...predictions].slice(0, 50);
  }
  return { detections, retained, window, pairs: [pair, ...previous.pairs].slice(0, 50), predictions };
}
