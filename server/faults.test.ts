import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulator } from './simulator.js';
import { createSettings } from './settings.js';
import { distanceMeters } from '../shared/geo.js';
import type { FaultState, Measurement } from '../shared/protocol.js';
import { appendReading, emptyReadingHistory } from '../client/readingHistory.js';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const overrides = { seed: 42, sampleIntervalMs: 1000, sampleJitterMs: 0, sendDelayMaxMs: 0 };

describe('one-shot bad position fault', () => {
  it('shifts one sample exactly 50 m without changing true motion, IDs, velocity, accuracy, or later noise', () => {
    vi.useFakeTimers();
    const healthy: Measurement[] = [], injected: Measurement[] = [], statuses: FaultState[] = [];
    const settings = createSettings(overrides);
    const normal = new Simulator(settings, (sample) => healthy.push(sample));
    const faulty = new Simulator(settings, (sample) => injected.push(sample), (state) => statuses.push(state));
    normal.start(); faulty.start();
    expect(faulty.triggerBadDataFault()).toMatchObject({ pending: true, targetSequentialId: null, remainingDelayMs: 3000, offsetMeters: 50, headingDegrees: 90 });
    expect(faulty.triggerBadDataFault().remainingDelayMs).toBe(3000);
    vi.advanceTimersByTime(5001);
    expect(injected).toHaveLength(5);
    expect(distanceMeters(healthy[2], injected[2])).toBeCloseTo(50, 5);
    for (let index = 0; index < 5; index++) {
      expect(injected[index].sequentialId).toBe(index + 1);
      expect(injected[index].velocityData).toEqual(healthy[index].velocityData);
      expect(injected[index].accuracyMeters).toBe(healthy[index].accuracyMeters);
      expect(injected[index].timeAtSample).toBe(healthy[index].timeAtSample);
      expect(injected[index].timeAtSend).toBe(healthy[index].timeAtSend);
      if (index !== 2) {
        expect(injected[index].latitude).toBe(healthy[index].latitude);
        expect(injected[index].longitude).toBe(healthy[index].longitude);
      }
    }
    expect(new Set(injected.map((sample) => sample.uniqueId)).size).toBe(5);
    expect(faulty.getMovement()).toEqual(normal.getMovement());
    expect(faulty.getFaultState()).toMatchObject({ pending: false, targetSequentialId: null, lastInjected: { uniqueId: injected[2].uniqueId, sequentialId: 3 } });
    expect(statuses.at(-1)!.pending).toBe(false);
    normal.stop(); faulty.stop();
  });
  it('targets the next generated reading rather than one already awaiting transmission', () => {
    vi.useFakeTimers();
    const samples: Measurement[] = [];
    const settings = createSettings({ ...overrides, sendDelayMaxMs: 900, positionRadiusMeters: 0 });
    const simulator = new Simulator(settings, (sample) => samples.push(sample));
    simulator.start(); vi.advanceTimersByTime(1000);
    expect(samples).toHaveLength(0);
    expect(simulator.triggerBadDataFault().targetSequentialId).toBeNull();
    vi.advanceTimersByTime(4000);
    expect(distanceMeters(settings, samples[0])).toBeLessThan(1e-6);
    expect(distanceMeters(settings, samples[3])).toBeCloseTo(50, 5);
    expect(simulator.getFaultState().lastInjected!.sequentialId).toBe(4);
    simulator.stop();
  });
  it('preserves a queued fault through settings changes and clears it on shutdown', () => {
    vi.useFakeTimers();
    const samples: Measurement[] = [];
    const settings = createSettings({ ...overrides, positionRadiusMeters: 0 });
    const simulator = new Simulator(settings, (sample) => samples.push(sample));
    simulator.start(); simulator.triggerBadDataFault();
    simulator.updateSettings(createSettings({ ...settings, sampleIntervalMs: 100 }));
    vi.advanceTimersByTime(3201);
    expect(distanceMeters(settings, samples[29])).toBeCloseTo(50, 5);
    expect(distanceMeters(settings, samples[30])).toBeLessThan(1e-6);
    simulator.triggerBadDataFault(); simulator.stop();
    expect(simulator.getFaultState().pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('allows independent client detection against a forecast saved before the delayed fault', () => {
    vi.useFakeTimers();
    let state = emptyReadingHistory();
    const samples: Measurement[] = [];
    const settings = createSettings({ ...overrides, positionRadiusMeters: 0, speedMaxMetersPerSecond: 0, headingJitterDegrees: 0 });
    const simulator = new Simulator(settings, (sample) => { samples.push(sample); state = appendReading(state, sample); });
    simulator.start(); vi.advanceTimersByTime(2001);
    simulator.triggerBadDataFault(); vi.advanceTimersByTime(3000);
    expect(simulator.getFaultState().lastInjected).toBeNull();
    const forecast = state.predictions[0].prediction;
    const before = structuredClone(forecast);
    vi.advanceTimersByTime(1000);
    expect(state.pairs[0].predictionEvaluation).toMatchObject({ prediction: forecast, insideArea: false });
    expect(state.pairs[0].predictionEvaluation!.errorMeters).toBeCloseTo(50, 5);
    expect(state.detections).toHaveLength(1);
    expect(state.detections[0].sampleId).toBe(samples[5].uniqueId);
    expect(forecast).toEqual(before);
    expect(Object.keys(samples[5])).not.toContain('fault');
    simulator.stop();
  });
  it('waits at least three seconds and repeat requests do not restart the countdown', () => {
    vi.useFakeTimers();
    const samples: Measurement[] = [];
    const settings = createSettings({ ...overrides, sampleIntervalMs: 100, positionRadiusMeters: 0 });
    const simulator = new Simulator(settings, (sample) => samples.push(sample));
    simulator.start();
    const armed = simulator.triggerBadDataFault();
    vi.advanceTimersByTime(2000);
    expect(simulator.triggerBadDataFault().remainingDelayMs).toBe(1000);
    expect(simulator.getFaultState().eligibleAt).toBe(armed.eligibleAt);
    vi.advanceTimersByTime(999);
    expect(simulator.getFaultState().lastInjected).toBeNull();
    expect(samples.every((sample) => distanceMeters(settings, sample) < 1e-6)).toBe(true);
    vi.advanceTimersByTime(102);
    expect(simulator.getFaultState().lastInjected!.sequentialId).toBe(30);
    expect(distanceMeters(settings, samples[29])).toBeCloseTo(50, 5);
    simulator.stop();
  });
});
