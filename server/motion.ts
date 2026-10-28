import { destination } from '../shared/geo.js';
import type { MovementCommand, MovementState, SensorSettings } from '../shared/protocol.js';

// Advance ground truth independently of measurement noise and sampling frequency.
export class Motion {
  private latitude: number;
  private longitude: number;
  private north = 0;
  private east = 0;
  private heading = 0;
  private updatedAt = performance.now();
  private expiresAt = this.updatedAt;
  constructor(private settings: Readonly<SensorSettings>) {
    this.latitude = settings.latitude;
    this.longitude = settings.longitude;
  }
  private advance(now: number) {
    const seconds = Math.max(0, Math.min(now, this.expiresAt) - this.updatedAt) / 1000;
    if ((this.north || this.east) && seconds > 0) {
      const point = destination(this.latitude, this.longitude, this.heading, this.settings.movementSpeedMetersPerSecond * seconds);
      this.latitude = point.latitude;
      this.longitude = point.longitude;
    }
    this.updatedAt = now;
    if (now >= this.expiresAt) { this.north = 0; this.east = 0; }
  }
  set(command: MovementCommand): MovementState {
    if (!command || !Number.isFinite(command.north) || !Number.isFinite(command.east) || Math.abs(command.north) > 1 || Math.abs(command.east) > 1) throw new Error('north and east must be finite numbers between -1 and 1');
    const now = performance.now();
    this.advance(now);
    const length = Math.hypot(command.north, command.east);
    this.north = length ? command.north / length : 0;
    this.east = length ? command.east / length : 0;
    if (length) this.heading = (Math.atan2(this.east, this.north) * 180 / Math.PI + 360) % 360;
    this.expiresAt = length ? now + this.settings.movementTimeoutMs : now;
    return this.get();
  }
  get(): MovementState {
    const now = performance.now();
    this.advance(now);
    return {
      latitude: this.latitude, longitude: this.longitude, north: this.north, east: this.east,
      speedMetersPerSecond: (this.north || this.east) ? this.settings.movementSpeedMetersPerSecond : 0,
      headingDegrees: this.heading, expiresInMs: Math.max(0, this.expiresAt - now),
    };
  }
}
