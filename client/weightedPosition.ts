import type { Measurement } from '../shared/protocol.js';

export interface WeightedPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timeAtSample: string;
  sources: { sequentialId: number; uniqueId: string; weight: number }[];
}

// Input is newest first. This estimates a local position from the last three readings.
export function weightedPosition(history: readonly Measurement[]): WeightedPosition | null {
  const samples = history.slice(0, 3);
  if (!samples.length) return null;
  if (samples.some((sample) => !Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters <= 0
    || !Number.isFinite(sample.latitude) || Math.abs(sample.latitude) > 90
    || !Number.isFinite(sample.longitude) || Math.abs(sample.longitude) > 180)) return null;

  // Scale inverse-variance weights to avoid squaring reciprocals of tiny accuracies.
  const bestAccuracy = Math.min(...samples.map((sample) => sample.accuracyMeters));
  const weights = samples.map((sample) => (bestAccuracy / sample.accuracyMeters) ** 2);
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
    latitude: anchor.latitude + latitudeOffset,
    longitude,
    // Nominal combined uncertainty only under independent, same-position errors.
    accuracyMeters: bestAccuracy / Math.sqrt(total),
    timeAtSample: anchor.timeAtSample,
    sources: samples.map((sample, index) => ({ sequentialId: sample.sequentialId, uniqueId: sample.uniqueId, weight: weights[index] / total })),
  };
}
