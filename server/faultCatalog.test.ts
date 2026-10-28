import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulator } from './simulator.js';
import { createSettings } from './settings.js';
import { distanceMeters } from '../shared/geo.js';
import { SensorDetector } from '../client/sensorDetector.js';
import type { Measurement } from '../shared/protocol.js';
import type { FaultKind } from '../shared/faults.js';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function run(kind: FaultKind, moving = false) {
  vi.useFakeTimers();
  const settings = createSettings({ seed: 42, sampleIntervalMs: 1000, sampleJitterMs: 0, sendDelayMaxMs: 0, positionRadiusMeters: 0, speedMaxMetersPerSecond: 0, headingJitterDegrees: 0 });
  const samples: Measurement[] = [];
  const detector = new SensorDetector();
  const events: string[] = [];
  const interrupts: number[] = [];
  const simulator = new Simulator(settings, (sample) => { samples.push(sample); events.push(...detector.observe(sample, performance.now()).events.map((event) => event.reason)); }, undefined, (ms) => interrupts.push(ms));
  simulator.start();
  vi.advanceTimersByTime(5001);
  simulator.triggerFault(kind);
  for (let seconds = 0; seconds < 24; seconds++) {
    if (moving) simulator.setMovement({ north: 0, east: 1 });
    vi.advanceTimersByTime(1000);
    events.push(...detector.tick(performance.now()).map((event) => event.reason));
  }
  simulator.stop();
  return { samples, events, interrupts, settings };
}

describe('fault catalog injection and sensor-only detection', () => {
  it.each([
    ['missing-samples', 'missing-samples'], ['sample-gap', 'sample-gap'], ['duplicate', 'duplicate'],
    ['out-of-order', 'out-of-order'], ['gradual-drift', 'gradual-drift'], ['excessive-noise', 'excessive-noise'], ['malformed', 'malformed'],
  ] as const)('injects %s and produces %s evidence', (kind, expected) => {
    const result = run(kind);
    expect(result.events).toContain(expected);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('freezes coordinates while reported motion continues', () => {
    expect(run('frozen-position', true).events).toContain('frozen-position');
  });
  it('does not claim that a stationary freeze can be distinguished from a stationary sensor', () => {
    expect(run('frozen-position').events).not.toContain('frozen-position');
  });
  it('requests exactly one bounded transport interruption', () => {
    expect(run('connection-interruption').interrupts).toEqual([4000]);
  });
  it('returns to normal after a bounded drift scenario', () => {
    const result = run('gradual-drift');
    expect(distanceMeters(result.settings, result.samples.at(-1)!)).toBeLessThan(1e-6);
    expect(Math.max(...result.samples.map((sample) => distanceMeters(result.settings, sample)))).toBeGreaterThan(10);
  });
});

it('keeps an interruption active until its deadline and rejects overlapping scenarios', () => {
  vi.useFakeTimers();
  const simulator = new Simulator(createSettings({ seed: 42, sampleJitterMs: 0, sendDelayMaxMs: 0 }), () => {});
  simulator.start(); simulator.triggerFault('connection-interruption'); vi.advanceTimersByTime(3001);
  expect(simulator.getFaultState()).toMatchObject({ active: true, kind: 'connection-interruption' });
  expect(simulator.triggerFault('duplicate').kind).toBe('connection-interruption');
  vi.advanceTimersByTime(4000);
  expect(simulator.getFaultState().active).toBe(false);
  expect(simulator.triggerFault('duplicate')).toMatchObject({ pending: true, kind: 'duplicate' });
  simulator.stop();
});
