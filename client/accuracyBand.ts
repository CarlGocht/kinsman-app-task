import type { Measurement } from '../shared/protocol.js';
import { destination, distanceMeters } from '../shared/geo.js';
import { POSITION_WINDOW_MS, weightedPosition } from './weightedPosition.js';

export interface AccuracyBand {
  radiusMeters: number;
  reportedAccuracyMeters: number;
  disagreementMeters: number | null;
  historySpreadMeters: number | null;
  historyAccuracyMeters: number | null;
  comparedSamples: number;
}

// A conservative diagnostic radius, not a calibrated confidence probability.
// Compare against prior samples only, excluding the new reading and future samples.
export function accuracyBand(raw: Measurement, history: readonly Measurement[]): AccuracyBand | null {
  const time = Date.parse(raw.timeAtSample);
  if (!Number.isFinite(time) || !weightedPosition([raw])) return null;
  const projected = history.filter((sample) => {
    const age = time - Date.parse(sample.timeAtSample);
    return sample.uniqueId !== raw.uniqueId && age > 0 && age < POSITION_WINDOW_MS
      && Number.isFinite(sample.velocityData.speedMetersPerSecond) && sample.velocityData.speedMetersPerSecond >= 0
      && Number.isFinite(sample.velocityData.headingDegrees);
  }).map((sample) => ({
    ...sample,
    ...destination(sample.latitude, sample.longitude, sample.velocityData.headingDegrees,
      sample.velocityData.speedMetersPerSecond * (time - Date.parse(sample.timeAtSample)) / 1000),
  }));
  const estimate = weightedPosition(projected);
  const baseline: AccuracyBand = {
    radiusMeters: raw.accuracyMeters, reportedAccuracyMeters: raw.accuracyMeters,
    disagreementMeters: null, historySpreadMeters: null, historyAccuracyMeters: null, comparedSamples: 0,
  };
  if (!estimate) return baseline;
  const byId = new Map(projected.map((sample) => [sample.uniqueId, sample]));
  const spread = Math.sqrt(estimate.sources.reduce((sum, source) => sum + source.weight * distanceMeters(byId.get(source.uniqueId)!, estimate) ** 2, 0));
  const disagreement = distanceMeters(raw, estimate);
  return {
    radiusMeters: Math.max(raw.accuracyMeters, disagreement + spread + estimate.accuracyMeters),
    reportedAccuracyMeters: raw.accuracyMeters,
    disagreementMeters: disagreement, historySpreadMeters: spread,
    historyAccuracyMeters: estimate.accuracyMeters, comparedSamples: estimate.sources.length,
  };
}
