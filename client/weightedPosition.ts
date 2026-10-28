import type { Measurement } from '../shared/protocol.js';

export interface WeightedPosition {
  windowMs: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timeAtSample: string;
  sources: { sequentialId: number; uniqueId: string; weight: number }[];
}

export const POSITION_WINDOW_MS = 3000;
export const RECENCY_HALF_LIFE_MS = 3000;

// Event-time window: (newest sample time - configured lookback, newest sample time].
// Arrival order and display-history limits do not determine the estimate.
export function positionWindow(history: readonly Measurement[], windowMs = POSITION_WINDOW_MS): Measurement[] {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return [];
  const timestamped = history.map((sample) => ({ sample, time: Date.parse(sample.timeAtSample) }))
    .filter(({ time }) => Number.isFinite(time));
  if (!timestamped.length) return [];
  const end = timestamped.reduce((latest, { time }) => Math.max(latest, time), -Infinity);
  const seen = new Set<string>();
  return timestamped.filter(({ time }) => time > end - windowMs)
    .sort((a, b) => b.time - a.time || b.sample.sequentialId - a.sample.sequentialId || a.sample.uniqueId.localeCompare(b.sample.uniqueId))
    .filter(({ sample }) => {
      if (seen.has(sample.uniqueId)) return false;
      seen.add(sample.uniqueId);
      return true;
    }).map(({ sample }) => sample);
}

// Uses every distinct measurement in the configured sample-time lookback.
export function weightedPosition(history: readonly Measurement[], windowMs = POSITION_WINDOW_MS): WeightedPosition | null {
  const samples = positionWindow(history, windowMs);
  if (!samples.length) return null;
  if (samples.some((sample) => !Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters <= 0
    || !Number.isFinite(sample.latitude) || Math.abs(sample.latitude) > 90
    || !Number.isFinite(sample.longitude) || Math.abs(sample.longitude) > 180)) return null;

  // Scale inverse-variance weights to avoid squaring reciprocals of tiny accuracies.
  const bestAccuracy = Math.min(...samples.map((sample) => sample.accuracyMeters));
  const end = Date.parse(samples[0].timeAtSample);
  const weights = samples.map((sample) => (bestAccuracy / sample.accuracyMeters) ** 2
    * 2 ** (-(end - Date.parse(sample.timeAtSample)) / RECENCY_HALF_LIFE_MS));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const anchor = samples[0];
  let latitudeOffset = 0;
  let longitudeOffset = 0;
  for (const [index, sample] of samples.entries()) {
    const weight = weights[index] / total;
    latitudeOffset += (sample.latitude - anchor.latitude) * weight;
    let delta = sample.longitude - anchor.longitude;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    longitudeOffset += delta * weight;
  }
  let longitude = anchor.longitude + longitudeOffset;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return {
    windowMs,
    latitude: anchor.latitude + latitudeOffset,
    longitude,
    // Nominal combined uncertainty only under independent, same-position errors.
    accuracyMeters: Math.hypot(...samples.map((sample, index) => sample.accuracyMeters * weights[index] / total)),
    timeAtSample: anchor.timeAtSample,
    sources: samples.map((sample, index) => ({ sequentialId: sample.sequentialId, uniqueId: sample.uniqueId, weight: weights[index] / total })),
  };
}
