import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Measurement, ServerMessage } from '../shared/protocol.js';
import { createApp } from './app.js';

const apps: ReturnType<typeof createApp>[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = createApp({ seed: 42, sampleIntervalMs: 40, sampleJitterMs: 0, sendDelayMaxMs: 0 });
  apps.push(app);
  const port = await app.listen(0);
  return { app, port };
}
async function connect(port: number) {
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  clients.push(client);
  const messages: ServerMessage[] = [];
  client.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await once(client, 'open');
  return { client, messages };
}
function waitForMeasurements(client: WebSocket, count: number): Promise<Measurement[]> {
  return new Promise((resolve, reject) => {
    const samples: Measurement[] = [];
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for measurements')); }, 2000);
    function cleanup() { clearTimeout(timeout); client.off('message', receive); }
    function receive(data: Buffer) {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.type !== 'measurement') return;
      samples.push(message.data);
      if (samples.length === count) { cleanup(); resolve(samples); }
    }
    client.on('message', receive);
  });
}

describe('local API', () => {
  it('returns effective settings with no cache and browser CORS support', async () => {
    const { app, port } = await setup();
    const response = await fetch(`http://127.0.0.1:${port}/api/settings`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual(app.settings);
    expect((await fetch(`http://127.0.0.1:${port}/unknown`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'POST' })).status).toBe(405);
  });
  it('broadcasts ordered, identical measurements and keeps streaming after a disconnect', async () => {
    const { port } = await setup();
    const first = await connect(port), second = await connect(port);
    const [a, b] = await Promise.all([waitForMeasurements(first.client, 3), waitForMeasurements(second.client, 3)]);
    expect(a).toEqual(b);
    expect(a[1].sequentialId).toBe(a[0].sequentialId + 1);
    expect(a[2].sequentialId).toBe(a[1].sequentialId + 1);
    expect(a[0].timeAtSend).toMatch(/Z$/);
    expect(first.messages).toContainEqual({ type: 'status', data: { simulation: 'running', connectedClients: 2 } });
    const closed = once(first.client, 'close'); first.client.close(); await closed;
    const [next] = await waitForMeasurements(second.client, 1);
    expect(next.sequentialId).toBeGreaterThan(a[2].sequentialId);
    expect(second.messages).toContainEqual({ type: 'status', data: { simulation: 'running', connectedClients: 1 } });
  });
  it('closes active WebSocket and HTTP connections and supports repeated shutdown', async () => {
    const { app, port } = await setup();
    const { client } = await connect(port);
    const closed = once(client, 'close');
    await app.close(); await closed; await app.close();
    await expect(fetch(`http://127.0.0.1:${port}/api/settings`)).rejects.toThrow();
  });
  it('accepts movement controls and broadcasts measurements reflecting the motion', async () => {
    const { app, port } = await setup();
    const { client } = await connect(port);
    const url = `http://127.0.0.1:${port}/api/movement`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ north: 1, east: 0 }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ north: 1, east: 0, speedMetersPerSecond: 5, headingDegrees: 0 });
    const samples = await waitForMeasurements(client, 3);
    for (const sample of samples) {
      expect(sample.latitude).toBeGreaterThan(app.settings.latitude);
      expect(sample.velocityData.speedMetersPerSecond).toBeGreaterThanOrEqual(4.995);
      expect(sample.velocityData.speedMetersPerSecond).toBeLessThanOrEqual(5.005);
      expect(sample.velocityData.headingDegrees <= 2 || sample.velocityData.headingDegrees >= 358).toBe(true);
    }
    expect(samples[2].latitude).toBeGreaterThan(samples[0].latitude);
    const stopped = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"north":0,"east":0}' });
    expect(await stopped.json()).toMatchObject({ speedMetersPerSecond: 0 });
    expect(await (await fetch(url)).json()).toMatchObject({ north: 0, east: 0, expiresInMs: 0 });
  });
  it('rejects malformed movement commands and supports preflight', async () => {
    const { port } = await setup();
    const url = `http://127.0.0.1:${port}/api/movement`;
    for (const body of ['null', '{}', '{"north":2,"east":0}', '{"north":"1","east":0}', 'broken']) {
      expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status).toBe(400);
    }
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(1025) })).status).toBe(413);
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(url, { method: 'OPTIONS' })).status).toBe(204);
    expect(await (await fetch(url)).json()).toMatchObject({ speedMetersPerSecond: 0 });
  });
  it('rejects WebSocket upgrades outside /ws', async () => {
    const { port } = await setup();
    const client = new WebSocket(`ws://127.0.0.1:${port}/other`);
    clients.push(client);
    await expect(once(client, 'open')).rejects.toThrow();
  });
});
