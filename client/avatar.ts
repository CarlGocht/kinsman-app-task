import { destination } from '../shared/geo.js';
import type { MovementState } from '../shared/protocol.js';

export interface MotionSnapshot { state: MovementState; receivedAt: number }

// Render between authoritative snapshots without extrapolating beyond the command lease.
export function avatarPosition(snapshot: MotionSnapshot, now: number) {
  const { state, receivedAt } = snapshot;
  const elapsedMs = Math.max(0, now - receivedAt);
  const travelMs = Math.min(elapsedMs, state.expiresInMs);
  return {
    ...destination(state.latitude, state.longitude, state.headingDegrees, state.speedMetersPerSecond * travelMs / 1000),
    headingDegrees: state.headingDegrees,
    moving: state.speedMetersPerSecond > 0 && elapsedMs < state.expiresInMs,
  };
}
