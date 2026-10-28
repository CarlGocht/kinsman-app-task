export const FAULT_SCENARIOS = [
  { kind: 'position-jump', label: '50 m position jump', description: 'Offsets one reading 50 m east.' },
  { kind: 'missing-samples', label: 'Missing data points', description: 'Drops three consecutive readings; sequence numbers continue.' },
  { kind: 'sample-gap', label: 'Excessive time between samples', description: 'Pauses sampling for at least 3 seconds without skipping sequence IDs.' },
  { kind: 'duplicate', label: 'Duplicate samples', description: 'Sends one measurement twice with the same unique ID.' },
  { kind: 'out-of-order', label: 'Out-of-order samples', description: 'Holds a reading and delivers it after the following reading.' },
  { kind: 'frozen-position', label: 'Frozen position', description: 'Holds coordinates for at least 8 seconds. Detectable when reported velocity indicates movement; stationary freezes are ambiguous.' },
  { kind: 'gradual-drift', label: 'Gradual drift', description: 'Adds an eastward drift of 1 m/s for at least 12 seconds. Detection can suspect position/velocity disagreement, not prove drift.' },
  { kind: 'excessive-noise', label: 'Excessive noise', description: 'Adds alternating 20 m position errors for at least 8 seconds.' },
  { kind: 'malformed', label: 'Malformed fields / values', description: 'Sends one reading with invalid coordinates, accuracy, and speed.' },
  { kind: 'connection-interruption', label: 'Connection interruption', description: 'Closes the stream and refuses reconnections for 4 seconds.' },
] as const;
export type FaultKind = typeof FAULT_SCENARIOS[number]['kind'];
export function isFaultKind(value: unknown): value is FaultKind { return FAULT_SCENARIOS.some((scenario) => scenario.kind === value); }
