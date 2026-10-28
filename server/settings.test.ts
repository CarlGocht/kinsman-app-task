import { describe, expect, it } from 'vitest';
import { createSettings, settingsFromEnv } from './settings.js';

describe('settings', () => {
  it('provides immutable defaults and exposes a generated seed', () => {
    const settings = createSettings();
    expect(settings.sampleIntervalMs).toBe(1000);
    expect(settings.movementSpeedMetersPerSecond).toBe(20);
    expect(settings.accuracyMeters).toBe(0.02);
    expect(Number.isInteger(settings.seed)).toBe(true);
    expect(Object.isFrozen(settings)).toBe(true);
  });
  it('reads startup overrides', () => {
    expect(settingsFromEnv({ SAMPLE_INTERVAL_MS: '250', SEED: '42', SENSOR_ID: 'test' })).toMatchObject({ sampleIntervalMs: 250, seed: 42, sensorId: 'test' });
    expect(() => settingsFromEnv({ SEED: '' })).toThrow();
  });
  it.each([
    { sampleIntervalMs: 0 }, { sampleIntervalMs: -1 }, { sampleIntervalMs: Infinity },
    { sampleJitterMs: -1 }, { sampleIntervalMs: 15, sampleJitterMs: 10, sendDelayMaxMs: 5 },
    { accuracyMeters: 0.005 }, { accuracyJitterMeters: -1 }, { latitude: 90 },
    { longitude: 181 }, { seed: 1.5 }, { seed: -1 }, { seed: 2 ** 32 },
    { sensorId: '' }, { speedMaxMetersPerSecond: -1 }, { headingJitterDegrees: 181 },
    { movementSpeedMetersPerSecond: 0 }, { movementSpeedMetersPerSecond: 101 }, { movementTimeoutMs: 249 }, { movementTimeoutMs: 10001 },
    { positionRadiusMeters: -1 }, { sendDelayMaxMs: -1 }, { sampleIntervalMs: 2 ** 31 },
  ])('rejects invalid settings %j', (overrides) => {
    expect(() => createSettings(overrides)).toThrow();
  });
});
