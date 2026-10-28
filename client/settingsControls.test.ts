import { describe, expect, it } from 'vitest';
import { settingsPatchError, SETTINGS_CONTROLS } from '../shared/settingsControls.js';
import { createSettings } from '../server/settings.js';

describe('shared live settings validation', () => {
  const settings = createSettings({ seed: 42 });
  it('allows the sampling interval and all noise controls to be updated together', () => {
    expect(SETTINGS_CONTROLS).toHaveLength(9);
    expect(settingsPatchError({ historyWindowSeconds: 5, sampleIntervalMs: 100, sampleJitterMs: 0, sendDelayMaxMs: 0, positionRadiusMeters: 0, accuracyMeters: 0.01, accuracyJitterMeters: 0, speedMaxMetersPerSecond: 0, headingJitterDegrees: 0 }, settings)).toBeNull();
  });
  it('explains timing and accuracy coupling before an API request', () => {
    expect(settingsPatchError({ sampleIntervalMs: 20, sendDelayMaxMs: 15 }, settings)).toContain('Sample interval');
    expect(settingsPatchError({ accuracyJitterMeters: 0.02 }, settings)).toContain('Accuracy jitter');
  });
  it('rejects nonfinite values, unsupported changes, and out-of-range controls', () => {
    for (const patch of [{ sampleIntervalMs: Infinity }, { speedMaxMetersPerSecond: NaN }, { seed: 2 }, { headingJitterDegrees: 181 }, { sampleIntervalMs: 10 }, { historyWindowSeconds: 0.4 }, { historyWindowSeconds: 31 }]) expect(settingsPatchError(patch, settings)).not.toBeNull();
  });
});
