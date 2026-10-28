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
  it('rejects WebSocket upgrades outside /ws', async () => {
    const { port } = await setup();
    const client = new WebSocket(`ws://127.0.0.1:${port}/other`);
    clients.push(client);
    await expect(once(client, 'open')).rejects.toThrow();
  });
});
