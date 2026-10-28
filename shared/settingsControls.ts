import type { SensorSettings } from './protocol.js';

export const HISTORY_WINDOW_LIMITS = { min: 0.5, max: 30, default: 3, step: 0.5 } as const;

export const SETTINGS_CONTROLS = [
  { key: 'historyWindowSeconds', label: 'History weighting window', unit: 's', min: HISTORY_WINDOW_LIMITS.min, max: HISTORY_WINDOW_LIMITS.max, step: HISTORY_WINDOW_LIMITS.step },
  { key: 'sampleIntervalMs', label: 'Sample interval', unit: 'ms', min: 20, max: 10000, step: 10 },
  { key: 'positionRadiusMeters', label: 'Position jitter radius', unit: 'm', min: 0, max: 100, step: 0.01 },
  { key: 'accuracyMeters', label: 'Reported accuracy baseline', unit: 'm', min: 0.001, max: 100, step: 0.001 },
  { key: 'accuracyJitterMeters', label: 'Accuracy jitter ±', unit: 'm', min: 0, max: 100, step: 0.001 },
  { key: 'speedMaxMetersPerSecond', label: 'Speed noise limit', unit: 'm/s', min: 0, max: 20, step: 0.001 },
  { key: 'headingJitterDegrees', label: 'Heading jitter ±', unit: '°', min: 0, max: 180, step: 1 },
  { key: 'sampleJitterMs', label: 'Sample timing jitter ±', unit: 'ms', min: 0, max: 1000, step: 1 },
  { key: 'sendDelayMaxMs', label: 'Maximum send delay', unit: 'ms', min: 0, max: 1000, step: 1 },
] as const;
export type AdjustableSettingKey = typeof SETTINGS_CONTROLS[number]['key'];
export type SettingsPatch = Partial<Pick<SensorSettings, AdjustableSettingKey>>;

export function settingsPatchError(value: unknown, current: Readonly<SensorSettings>): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return 'Provide at least one adjustable setting';
  for (const [key, number] of Object.entries(value)) {
    const control = SETTINGS_CONTROLS.find((control) => control.key === key);
    if (!control) return `${key} cannot be changed at runtime`;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < control.min || number > control.max) return `${control.label} must be between ${control.min} and ${control.max} ${control.unit}`;
  }
  const next = { ...current, ...value as SettingsPatch };
  if (next.sampleIntervalMs - next.sampleJitterMs < 1 || next.sendDelayMaxMs >= next.sampleIntervalMs - next.sampleJitterMs) return 'Sample interval minus timing jitter must exceed the maximum send delay and leave at least 1 ms between samples';
  if (next.accuracyJitterMeters >= next.accuracyMeters) return 'Accuracy jitter must be smaller than the reported accuracy baseline';
  return null;
}
