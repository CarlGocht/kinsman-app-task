import { randomInt } from 'node:crypto';
import type { SensorSettings } from '../shared/protocol.js';

export function createSettings(overrides: Partial<SensorSettings> = {}): Readonly<SensorSettings> {
  const settings: SensorSettings = {
    sensorId: 'sensor-1', seed: randomInt(0, 2 ** 32),
    latitude: 43.61811797437582, longitude: -72.20972127777227,
    sampleIntervalMs: 1000, sampleJitterMs: 10, sendDelayMaxMs: 5,
    positionRadiusMeters: 0.01, accuracyMeters: 0.02, accuracyJitterMeters: 0.005,
    speedMaxMetersPerSecond: 0.005, headingJitterDegrees: 2,
    movementSpeedMetersPerSecond: 20, movementTimeoutMs: 1000,
    ...overrides,
  };
  if (typeof settings.sensorId !== 'string' || !settings.sensorId.trim()) throw new Error('sensorId must be nonempty');
  for (const [key, value] of Object.entries(settings)) {
    if (key !== 'sensorId' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${key} must be finite`);
  }
  if (!Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed >= 2 ** 32) throw new Error('seed must be a uint32');
  if (Math.abs(settings.latitude) >= 89 || Math.abs(settings.longitude) > 180) throw new Error('Coordinates must have latitude between -89 and 89 and longitude between -180 and 180');
  for (const key of ['sampleJitterMs', 'sendDelayMaxMs', 'positionRadiusMeters', 'accuracyJitterMeters', 'speedMaxMetersPerSecond', 'headingJitterDegrees'] as const) {
    if (settings[key] < 0) throw new Error(`${key} must be nonnegative`);
  }
  if (settings.sampleIntervalMs - settings.sampleJitterMs < 1 || settings.sampleIntervalMs + settings.sampleJitterMs > 2 ** 31 - 1 || settings.sendDelayMaxMs >= settings.sampleIntervalMs - settings.sampleJitterMs) throw new Error('Timing settings must allow positive, non-overlapping sampling cycles');
  if (settings.accuracyMeters <= settings.accuracyJitterMeters) throw new Error('Accuracy must stay positive');
  if (settings.movementSpeedMetersPerSecond <= 0 || settings.movementSpeedMetersPerSecond > 100 || settings.movementTimeoutMs < 250 || settings.movementTimeoutMs > 10000) throw new Error('Movement speed must be in (0, 100] m/s and timeout in [250, 10000] ms');
  if (settings.headingJitterDegrees > 180 || settings.positionRadiusMeters > 1000) throw new Error('Heading jitter must be <=180 degrees and position radius <=1000 meters');
  return Object.freeze(settings);
}

export function settingsFromEnv(env: NodeJS.ProcessEnv): Readonly<SensorSettings> {
  const overrides: Partial<SensorSettings> = {};
  const names: Record<Exclude<keyof SensorSettings, 'sensorId'>, string> = {
    movementSpeedMetersPerSecond: 'MOVEMENT_SPEED_METERS_PER_SECOND', movementTimeoutMs: 'MOVEMENT_TIMEOUT_MS',
    seed: 'SEED', latitude: 'LATITUDE', longitude: 'LONGITUDE', sampleIntervalMs: 'SAMPLE_INTERVAL_MS',
    sampleJitterMs: 'SAMPLE_JITTER_MS', sendDelayMaxMs: 'SEND_DELAY_MAX_MS', positionRadiusMeters: 'POSITION_RADIUS_METERS',
    accuracyMeters: 'ACCURACY_METERS', accuracyJitterMeters: 'ACCURACY_JITTER_METERS', speedMaxMetersPerSecond: 'SPEED_MAX_METERS_PER_SECOND', headingJitterDegrees: 'HEADING_JITTER_DEGREES',
  };
  for (const [key, name] of Object.entries(names)) {
    if (env[name] !== undefined) {
      if (!env[name]!.trim()) throw new Error(`${name} must not be empty`);
      Object.assign(overrides, { [key]: Number(env[name]) });
    }
  }
  if (env.SENSOR_ID !== undefined) overrides.sensorId = env.SENSOR_ID;
  return createSettings(overrides);
}
