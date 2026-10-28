import { distanceMeters } from '../shared/geo.js';
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
    expect(await response.json()).toMatchObject({ north: 1, east: 0, speedMetersPerSecond: 20, headingDegrees: 0 });
    const samples = await waitForMeasurements(client, 3);
    for (const sample of samples) {
      expect(sample.latitude).toBeGreaterThan(app.settings.latitude);
      expect(sample.velocityData.speedMetersPerSecond).toBeGreaterThanOrEqual(19.995);
      expect(sample.velocityData.speedMetersPerSecond).toBeLessThanOrEqual(20.005);
      expect(sample.velocityData.headingDegrees <= 2 || sample.velocityData.headingDegrees >= 358).toBe(true);
    }
    expect(samples[2].latitude).toBeGreaterThan(samples[0].latitude);
    const stopped = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"north":0,"east":0}' });
    expect(await stopped.json()).toMatchObject({ speedMetersPerSecond: 0 });
    expect(await (await fetch(url)).json()).toMatchObject({ north: 0, east: 0, expiresInMs: 0 });
  });
  it('streams live motion independently of a slow sensor sample interval', async () => {
    const app = createApp({ seed: 42, sampleIntervalMs: 10000 });
    apps.push(app);
    const port = await app.listen(0);
    await fetch(`http://127.0.0.1:${port}/api/movement`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"north":0,"east":1}',
    });
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    clients.push(client);
    const messages: ServerMessage[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Missing independent motion updates')), 2000);
      client.on('error', reject);
      client.on('message', (data) => {
        const message = JSON.parse(data.toString()) as ServerMessage;
        messages.push(message);
        if (messages.filter((m) => m.type === 'motion').length === 4) { clearTimeout(timeout); resolve(); }
      });
    });
    const motion = messages.filter((m) => m.type === 'motion');
    expect(motion).toHaveLength(4);
    expect(motion[3].data.longitude).toBeGreaterThan(motion[0].data.longitude);
    expect(motion[0].data).toMatchObject({ speedMetersPerSecond: 20, headingDegrees: 90 });
    expect(messages.some((m) => m.type === 'measurement')).toBe(false);
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
  it('atomically patches settings, synchronizes clients, and changes real samples', async () => {
    const { app, port } = await setup();
    const first = await connect(port), second = await connect(port);
    const [before] = await waitForMeasurements(first.client, 1);
    const url = `http://127.0.0.1:${port}/api/settings`;
    const patch = { historyWindowSeconds: 5, sampleIntervalMs: 80, positionRadiusMeters: 0, accuracyMeters: 0.5, accuracyJitterMeters: 0, speedMaxMetersPerSecond: 0, headingJitterDegrees: 0 };
    const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    expect(response.status).toBe(200);
    const next = await response.json();
    expect(next).toMatchObject(patch);
    expect(await (await fetch(url)).json()).toEqual(next);
    expect(app.settings).toEqual(next);
    const samples = await waitForMeasurements(first.client, 3);
    expect(samples[0].sequentialId).toBeGreaterThan(before.sequentialId);
    expect(samples.at(-1)).toMatchObject({ latitude: app.settings.latitude, accuracyMeters: 0.5, velocityData: { speedMetersPerSecond: 0, headingDegrees: 0 } });
    expect(Date.parse(samples[2].timeAtSample) - Date.parse(samples[1].timeAtSample)).toBeGreaterThanOrEqual(79);
    for (const peer of [first, second]) expect(peer.messages).toContainEqual({ type: 'settings', data: next });
    expect((await fetch(url, { method: 'OPTIONS' })).headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });
  it('rejects invalid settings patches without modifying configuration or broadcasting changes', async () => {
    const { app, port } = await setup();
    const peer = await connect(port);
    await waitForMeasurements(peer.client, 1);
    const original = app.settings;
    const url = `http://127.0.0.1:${port}/api/settings`;
    for (const patch of [null, [], {}, { seed: 10 }, { latitude: 0 }, { sampleIntervalMs: 0 }, { sampleIntervalMs: '100' }, { sampleIntervalMs: 20, sendDelayMaxMs: 20 }, { accuracyJitterMeters: 0.1 }, { headingJitterDegrees: 181 }, { historyWindowSeconds: 0.4 }, { historyWindowSeconds: 31 }, { unknown: 1 }]) {
      const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      expect(response.status).toBe(400);
      expect(app.settings).toBe(original);
    }
    expect((await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'broken' })).status).toBe(400);
    expect((await fetch(url, { method: 'PATCH', body: '{}' })).status).toBe(415);
    expect((await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(1025) })).status).toBe(413);
    expect(peer.messages.filter((message) => message.type === 'settings')).toEqual([{ type: 'settings', data: original }]);
    expect(await (await fetch(url)).json()).toEqual(original);
  });
  it('arms and consumes a one-shot position fault across all connected clients', async () => {
    const app = createApp({ seed: 42, sampleIntervalMs: 300, sampleJitterMs: 0, sendDelayMaxMs: 0, positionRadiusMeters: 0 });
    apps.push(app);
    const port = await app.listen(0);
    const first = await connect(port), second = await connect(port);
    const url = `http://127.0.0.1:${port}/api/faults/bad-data`;
    expect(await (await fetch(url)).json()).toMatchObject({ pending: false, lastInjected: null });
    const armedResponse = await fetch(url, { method: 'POST' });
    expect(armedResponse.status).toBe(200);
    const armed = await armedResponse.json();
    expect(armed).toMatchObject({ pending: true, offsetMeters: 50, headingDegrees: 90 });
    const [samples, peerSamples] = await Promise.all([waitForMeasurements(first.client, 2), waitForMeasurements(second.client, 2)]);
    expect(samples).toEqual(peerSamples);
    const injected = samples.find((sample) => sample.sequentialId === armed.targetSequentialId)!;
    expect(injected).toBeDefined();
    expect(distanceMeters(app.settings, injected)).toBeCloseTo(50, 5);
    const normal = samples.find((sample) => sample.sequentialId > armed.targetSequentialId)!;
    expect(distanceMeters(app.settings, normal)).toBeLessThan(1e-6);
    const final = await (await fetch(url)).json();
    expect(final).toMatchObject({ pending: false, lastInjected: { uniqueId: injected.uniqueId, sequentialId: injected.sequentialId } });
    for (const peer of [first, second]) {
      expect(peer.messages).toContainEqual({ type: 'faults', data: armed });
      expect(peer.messages).toContainEqual({ type: 'faults', data: final });
    }
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  });
  it('rejects WebSocket upgrades outside /ws', async () => {
    const { port } = await setup();
    const client = new WebSocket(`ws://127.0.0.1:${port}/other`);
    clients.push(client);
    await expect(once(client, 'open')).rejects.toThrow();
  });
});
