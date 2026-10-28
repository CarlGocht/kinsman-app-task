import type { Measurement } from '../shared/protocol.js';
import { destination, distanceMeters } from '../shared/geo.js';
import { POSITION_WINDOW_MS, positionWindow, weightedPosition } from './weightedPosition.js';

// Initial process-model assumptions; these are not calibrated confidence bounds.
export const PREDICTION_ASSUMPTIONS = Object.freeze({
  speedFraction: 0.05,
  minimumSpeedUncertaintyMetersPerSecond: 0.05,
  headingUncertaintyDegrees: 2,
  accelerationUncertaintyMetersPerSecondSquared: 2,
});

export interface Prediction {
  id: string;
  createdAt: string;
  historyWindowMs: number;
  sourceIds: string[];
  sourceSequenceIds: number[];
  baseTime: string;
  targetTime: string;
  matchToleranceMs: number;
  baseLatitude: number;
  baseLongitude: number;
  eastMetersPerSecond: number;
  northMetersPerSecond: number;
  baseRadiusMeters: number;
  radiusGrowthMetersPerSecond: number;
  velocityUncertaintyFloorMetersPerSecond: number;
  accelerationUncertaintyMetersPerSecondSquared: number;
  timingUncertaintyMeters: number;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}
export interface PredictionEvaluation {
  prediction: Prediction;
  actualUniqueId: string;
  actualSequentialId: number;
  actualTime: string;
  predictedLatitude: number;
  predictedLongitude: number;
  radiusMeters: number;
  errorMeters: number;
  insideArea: boolean;
}
export interface SavedPrediction { prediction: Prediction; evaluation: PredictionEvaluation | null }

export function predictionAt(prediction: Prediction, time: number) {
  const seconds = Math.max(0, time - Date.parse(prediction.baseTime)) / 1000;
  const speed = Math.hypot(prediction.eastMetersPerSecond, prediction.northMetersPerSecond);
  const heading = Math.atan2(prediction.eastMetersPerSecond, prediction.northMetersPerSecond) * 180 / Math.PI;
  return {
    ...destination(prediction.baseLatitude, prediction.baseLongitude, heading, speed * seconds),
    radiusMeters: prediction.baseRadiusMeters + prediction.timingUncertaintyMeters
      + prediction.radiusGrowthMetersPerSecond * seconds
      + 0.5 * prediction.accelerationUncertaintyMetersPerSecondSquared * seconds ** 2,
  };
}

export function createPrediction(history: readonly Measurement[], intervalMs: number, jitterMs = 0, windowMs = POSITION_WINDOW_MS, createdAt = new Date().toISOString()): Prediction | null {
  const samples = positionWindow(history, windowMs);
  const weighted = weightedPosition(samples, windowMs);
  if (!weighted || samples.length < 2 || !Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(jitterMs) || jitterMs < 0) return null;
  const anchor = samples[0];
  const baseTime = Date.parse(anchor.timeAtSample);
  const metersPerDegree = Math.PI / 180 * 6371008.8;
  const longitudeScale = metersPerDegree * Math.cos(anchor.latitude * Math.PI / 180);
  const weights = new Map(weighted.sources.map((source) => [source.uniqueId, source.weight]));
  const points = samples.map((sample) => {
    let longitudeDelta = sample.longitude - anchor.longitude;
    if (longitudeDelta > 180) longitudeDelta -= 360;
    if (longitudeDelta < -180) longitudeDelta += 360;
    return { sample, weight: weights.get(sample.uniqueId)!, t: (Date.parse(sample.timeAtSample) - baseTime) / 1000,
      east: longitudeDelta * longitudeScale, north: (sample.latitude - anchor.latitude) * metersPerDegree };
  });
  const mean = points.reduce((m, p) => ({ t: m.t + p.weight * p.t, east: m.east + p.weight * p.east, north: m.north + p.weight * p.north }), { t: 0, east: 0, north: 0 });
  const variance = points.reduce((sum, p) => sum + p.weight * (p.t - mean.t) ** 2, 0);
  if (variance < 1e-8) return null; // Need measurements at distinct sample times.
  const eastVelocity = points.reduce((sum, p) => sum + p.weight * (p.t - mean.t) * (p.east - mean.east), 0) / variance;
  const northVelocity = points.reduce((sum, p) => sum + p.weight * (p.t - mean.t) * (p.north - mean.north), 0) / variance;
  const eastNow = mean.east - eastVelocity * mean.t;
  const northNow = mean.north - northVelocity * mean.t;
  const origin = destination(anchor.latitude, anchor.longitude, Math.atan2(eastNow, northNow) * 180 / Math.PI, Math.hypot(eastNow, northNow));
  const scatter = Math.sqrt(points.reduce((sum, p) => sum + p.weight * ((p.east - eastNow - eastVelocity * p.t) ** 2 + (p.north - northNow - northVelocity * p.t) ** 2), 0));
  const reported = points.filter((p) => Number.isFinite(p.sample.velocityData.speedMetersPerSecond) && p.sample.velocityData.speedMetersPerSecond >= 0 && Number.isFinite(p.sample.velocityData.headingDegrees));
  const reportedWeight = reported.reduce((sum, p) => sum + p.weight, 0);
  const velocityDisagreement = reportedWeight ? Math.sqrt(reported.reduce((sum, p) => {
    const radians = p.sample.velocityData.headingDegrees * Math.PI / 180;
    const speed = p.sample.velocityData.speedMetersPerSecond;
    return sum + p.weight * ((speed * Math.sin(radians) - eastVelocity) ** 2 + (speed * Math.cos(radians) - northVelocity) ** 2);
  }, 0) / reportedWeight) : 0;
  const span = Math.max(0.001, -Math.min(...points.map((p) => p.t)));
  const expectedAccuracy = points.reduce((sum, p) => sum + p.weight * p.sample.accuracyMeters, 0);
  const speed = Math.hypot(eastVelocity, northVelocity);
  const assumptions = PREDICTION_ASSUMPTIONS;
  const velocityFloor = Math.hypot(
    Math.max(assumptions.minimumSpeedUncertaintyMetersPerSecond, speed * assumptions.speedFraction),
    speed * Math.sin(assumptions.headingUncertaintyDegrees * Math.PI / 180),
  );
  // Measurement uncertainty still affects slope precision even if two points fit exactly.
  const slopeUncertainty = Math.sqrt(points.reduce((sum, p) => sum
    + (p.weight * (p.t - mean.t) * p.sample.accuracyMeters) ** 2, 0)) / variance;
  const prediction: Prediction = {
    id: anchor.uniqueId, createdAt, historyWindowMs: windowMs, sourceIds: samples.map((p) => p.uniqueId), sourceSequenceIds: samples.map((p) => p.sequentialId),
    baseTime: anchor.timeAtSample, targetTime: new Date(baseTime + intervalMs).toISOString(),
    matchToleranceMs: Math.max(50, jitterMs + 50, intervalMs * 0.25),
    baseLatitude: origin.latitude, baseLongitude: origin.longitude,
    eastMetersPerSecond: eastVelocity, northMetersPerSecond: northVelocity,
    baseRadiusMeters: 2 * (expectedAccuracy + scatter),
    radiusGrowthMetersPerSecond: Math.hypot(velocityDisagreement, scatter / span, 2 * slopeUncertainty, velocityFloor),
    velocityUncertaintyFloorMetersPerSecond: velocityFloor,
    accelerationUncertaintyMetersPerSecondSquared: assumptions.accelerationUncertaintyMetersPerSecondSquared,
    timingUncertaintyMeters: speed * jitterMs / 1000,
    latitude: 0, longitude: 0, radiusMeters: 0,
  };
  return { ...prediction, ...predictionAt(prediction, baseTime + intervalMs) };
}

// Only the saved model and the actual sample time determine the scoring area.
// Current coordinates/accuracy must never refit or widen their own forecast.
export function evaluatePrediction(prediction: Prediction, raw: Measurement): PredictionEvaluation | null {
  const time = Date.parse(raw.timeAtSample);
  if (!Number.isFinite(time) || time <= Date.parse(prediction.baseTime)
    || Math.abs(time - Date.parse(prediction.targetTime)) > prediction.matchToleranceMs
    || prediction.sourceIds.includes(raw.uniqueId)
    || !Number.isFinite(raw.latitude) || Math.abs(raw.latitude) > 90
    || !Number.isFinite(raw.longitude) || Math.abs(raw.longitude) > 180) return null;
  const point = predictionAt(prediction, time);
  const errorMeters = distanceMeters(point, raw);
  return { prediction, actualUniqueId: raw.uniqueId, actualSequentialId: raw.sequentialId, actualTime: raw.timeAtSample,
    predictedLatitude: point.latitude, predictedLongitude: point.longitude, radiusMeters: point.radiusMeters,
    errorMeters, insideArea: errorMeters <= point.radiusMeters };
}
