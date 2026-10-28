export interface SensorSettings {
  sensorId: string;
  seed: number;
  latitude: number;
  longitude: number;
  sampleIntervalMs: number;
  sampleJitterMs: number;
  sendDelayMaxMs: number;
  positionRadiusMeters: number;
  accuracyMeters: number;
  accuracyJitterMeters: number;
  speedMaxMetersPerSecond: number;
  headingJitterDegrees: number;
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
  | { type: 'status'; data: { simulation: 'running'; connectedClients: number } };
