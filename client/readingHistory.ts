import type { Measurement } from '../shared/protocol.js';
import { positionWindow, weightedPosition } from './weightedPosition.js';
import type { WeightedPosition } from './weightedPosition.js';

export interface ReadingPair {
  raw: Measurement;
  weighted: WeightedPosition | null;
}
export interface ReadingHistory {
  window: Measurement[];
  pairs: ReadingPair[];
}
export function emptyReadingHistory(): ReadingHistory { return { window: [], pairs: [] }; }

// Snapshot the estimate on receipt. Later arrivals never rewrite an earlier pair.
export function appendReading(previous: ReadingHistory, raw: Measurement): ReadingHistory {
  const window = positionWindow([raw, ...previous.window]);
  const pair: ReadingPair = { raw, weighted: weightedPosition(window) };
  return { window, pairs: [pair, ...previous.pairs].slice(0, 50) };
}
