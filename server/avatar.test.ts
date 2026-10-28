import { describe, expect, it } from 'vitest';
import { avatarPosition } from '../client/avatar.js';
import type { MotionSnapshot } from '../client/avatar.js';

const snapshot: MotionSnapshot = { receivedAt: 1000, state: {
  latitude: 43.61811797437582, longitude: -72.20972127777227,
  north: 0, east: 1, headingDegrees: 90, speedMetersPerSecond: 5, expiresInMs: 1000,
} };

describe('avatar frame projection', () => {
  it('moves between sensor ticks with no additional sensor measurement', () => {
    const first = avatarPosition(snapshot, 1000);
    const nextFrame = avatarPosition(snapshot, 1016);
    const halfSecond = avatarPosition(snapshot, 1500);
    expect(nextFrame.longitude).toBeGreaterThan(first.longitude);
    expect(halfSecond.longitude).toBeGreaterThan(nextFrame.longitude);
    expect(nextFrame.moving).toBe(true);
    expect(nextFrame.headingDegrees).toBe(90);
    expect(snapshot.state.longitude).toBe(-72.20972127777227);
  });
  it('stops extrapolating when the movement command expires', () => {
    expect(avatarPosition(snapshot, 2000).moving).toBe(false);
    expect(avatarPosition(snapshot, 5000)).toEqual(avatarPosition(snapshot, 2000));
  });
  it('keeps a stopped avatar still and handles a frame before receipt', () => {
    expect(avatarPosition(snapshot, 900)).toEqual(avatarPosition(snapshot, 1000));
    const stopped = { ...snapshot, state: { ...snapshot.state, speedMetersPerSecond: 0, expiresInMs: 0 } };
    const result = avatarPosition(stopped, 5000);
    expect(result.latitude).toBeCloseTo(snapshot.state.latitude, 10);
    expect(result.longitude).toBeCloseTo(snapshot.state.longitude, 10);
    expect(result.moving).toBe(false);
  });
});
