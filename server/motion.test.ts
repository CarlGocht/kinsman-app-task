import { afterEach, describe, expect, it, vi } from 'vitest';
import { Motion } from './motion.js';
import { createSettings } from './settings.js';

afterEach(() => vi.useRealTimers());
function motion() { vi.useFakeTimers(); return new Motion(createSettings({ seed: 42 })); }
const metersPerDegree = Math.PI / 180 * 6371008.8;

describe('movement ground truth', () => {
  it.each([
    [1, 0, 0], [0, 1, 90], [-1, 0, 180], [0, -1, 270],
  ])('moves north=%s east=%s with heading %s', (north, east, heading) => {
    const subject = motion(); const start = subject.get();
    subject.set({ north, east }); vi.advanceTimersByTime(500);
    const end = subject.get();
    expect(end.headingDegrees).toBe(heading);
    expect(end.speedMetersPerSecond).toBe(20);
    const dy = (end.latitude - start.latitude) * metersPerDegree;
    const dx = (end.longitude - start.longitude) * metersPerDegree * Math.cos(start.latitude * Math.PI / 180);
    expect(dy).toBeCloseTo(north * 10, 4);
    expect(dx).toBeCloseTo(east * 10, 4);
  });
  it('normalizes diagonal input to the same speed', () => {
    const subject = motion(); const start = subject.get();
    subject.set({ north: 1, east: 1 }); vi.advanceTimersByTime(500);
    const end = subject.get();
    const dy = (end.latitude - start.latitude) * metersPerDegree;
    const dx = (end.longitude - start.longitude) * metersPerDegree * Math.cos(start.latitude * Math.PI / 180);
    expect(Math.hypot(dx, dy)).toBeCloseTo(10, 4);
    expect(end.headingDegrees).toBe(45);
  });
  it('integrates only until the lease expires, even with no samples or API calls', () => {
    const subject = motion(); const start = subject.get();
    subject.set({ north: 1, east: 0 }); vi.advanceTimersByTime(5000);
    const end = subject.get();
    expect((end.latitude - start.latitude) * metersPerDegree).toBeCloseTo(20, 5);
    expect(end).toMatchObject({ north: 0, east: 0, speedMetersPerSecond: 0, expiresInMs: 0 });
    vi.advanceTimersByTime(5000);
    expect(subject.get()).toEqual(end);
  });
  it('integrates turns and stop commands at their actual command times', () => {
    const subject = motion(); const start = subject.get();
    subject.set({ north: 1, east: 0 }); vi.advanceTimersByTime(500);
    subject.set({ north: 0, east: 1 }); vi.advanceTimersByTime(500);
    const end = subject.set({ north: 0, east: 0 });
    expect((end.latitude - start.latitude) * metersPerDegree).toBeCloseTo(10, 4);
    expect((end.longitude - start.longitude) * metersPerDegree * Math.cos(start.latitude * Math.PI / 180)).toBeCloseTo(10, 4);
    expect(end.speedMetersPerSecond).toBe(0);
    expect(end.headingDegrees).toBe(90);
    vi.advanceTimersByTime(1000);
    expect(subject.get()).toEqual(end);
  });
  it('refreshes the movement lease without resetting the location', () => {
    const subject = motion(); const start = subject.get();
    subject.set({ north: 1, east: 0 }); vi.advanceTimersByTime(800);
    subject.set({ north: 1, east: 0 }); vi.advanceTimersByTime(800);
    const end = subject.get();
    expect((end.latitude - start.latitude) * metersPerDegree).toBeCloseTo(32, 4);
    expect(end.speedMetersPerSecond).toBe(20);
  });
});
