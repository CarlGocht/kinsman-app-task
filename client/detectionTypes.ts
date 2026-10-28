export type DetectionReason = 'outside-prediction-area' | 'missing-samples' | 'sample-gap' | 'duplicate' | 'out-of-order' | 'frozen-position' | 'gradual-drift' | 'excessive-noise' | 'malformed' | 'connection-interruption';
export interface DetectedFault {
  sampleId: string;
  sequentialId: number | null;
  timeAtSample: string;
  predictionId?: string;
  errorMeters?: number;
  radiusMeters?: number;
  reason: DetectionReason;
  detail?: string;
  confidence?: 'observed' | 'suspected';
  payload?: string;
}
export const DETECTION_LABELS: Record<DetectionReason, string> = {
  'outside-prediction-area': 'Outside predicted area', 'missing-samples': 'Missing samples',
  'sample-gap': 'Excessive sample interval', duplicate: 'Duplicate sample', 'out-of-order': 'Out-of-order sample',
  'frozen-position': 'Suspected frozen position', 'gradual-drift': 'Suspected drift / velocity bias',
  'excessive-noise': 'Suspected excessive noise', malformed: 'Malformed sensor data', 'connection-interruption': 'Connection interrupted',
};
