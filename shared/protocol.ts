export interface SensorSettings {
  sensorId: string;
  seed: number;
  latitude: number;
  longitude: number;
  sampleIntervalMs: number;
  historyWindowSeconds: number;
  sampleJitterMs: number;
  sendDelayMaxMs: number;
  positionRadiusMeters: number;
  accuracyMeters: number;
  accuracyJitterMeters: number;
  speedMaxMetersPerSecond: number;
  headingJitterDegrees: number;
  movementSpeedMetersPerSecond: number;
  movementTimeoutMs: number;
}

export interface Measurement {
  sensorId: string;
  uniqueId: string;
  sequentialId: number;
  latitude: number;
  longitude: number;
  timeAtSample: string;
  timeAtSend: string;
  accuracyMeters: number;
  velocityData: { speedMetersPerSecond: number; headingDegrees: number };
}

export type ServerMessage =
  | { type: 'measurement'; data: Measurement }
  | { type: 'motion'; data: MovementState }
  | { type: 'settings'; data: SensorSettings }
  | { type: 'faults'; data: FaultState }
  | { type: 'status'; data: { simulation: 'running'; connectedClients: number } };

export interface MovementCommand { north: number; east: number }
export interface MovementState extends MovementCommand {
  latitude: number;
  longitude: number;
  speedMetersPerSecond: number;
  headingDegrees: number;
  expiresInMs: number;
}

// Injector control state is separate from sensor data and prediction inputs.
export interface FaultState {
  pending: boolean;
  delayMs: 3000;
  remainingDelayMs: number;
  eligibleAt: string | null;
  targetSequentialId: number | null;
  offsetMeters: 50;
  headingDegrees: 90;
  lastInjected: { uniqueId: string; sequentialId: number; timeAtSample: string } | null;
}
