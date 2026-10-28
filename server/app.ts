import { applyJson } from './httpJson.js';
import { settingsPatchError } from '../shared/settingsControls.js';
import type { SettingsPatch } from '../shared/settingsControls.js';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { MovementCommand, ServerMessage, SensorSettings } from '../shared/protocol.js';
import { createSettings } from './settings.js';
import { Simulator } from './simulator.js';

export function createApp(input: Partial<SensorSettings> = {}) {
  let settings = createSettings(input);
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/api/faults/bad-data') {
      if (request.method === 'GET') { response.end(JSON.stringify(simulator.getFaultState())); return; }
      if (request.method === 'POST') {
        request.resume();
        response.end(JSON.stringify(simulator.triggerBadDataFault()));
        return;
      }
      response.writeHead(405, { Allow: 'GET, POST' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    if (request.url === '/api/movement') {
      if (request.method === 'GET') { response.end(JSON.stringify(simulator.getMovement())); return; }
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'GET, POST' }); response.end(JSON.stringify({ error: 'Method not allowed' })); return;
      }
      applyJson(request, response, (body) => simulator.setMovement(body as MovementCommand));
      return;
    }
    if (request.url === '/api/settings') {
      if (request.method === 'GET') { response.end(JSON.stringify(settings)); return; }
      if (request.method === 'PATCH') {
        applyJson(request, response, (body) => {
          const error = settingsPatchError(body, settings);
          if (error) throw new Error(error);
          const next = createSettings({ ...settings, ...body as SettingsPatch });
          simulator.updateSettings(next);
          settings = next;
          broadcast({ type: 'settings', data: settings });
          return settings;
        });
        return;
      }
      response.writeHead(405, { Allow: 'GET, PATCH' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
  function broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message);
    for (const client of sockets.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // Disconnect a stalled consumer rather than accumulating unbounded data.
      if (client.bufferedAmount > 1024 * 1024) { client.terminate(); continue; }
      client.send(payload, (error) => { if (error) client.terminate(); });
    }
  }
  sockets.on('error', (error) => { console.error('WebSocket server error:', error.message); });
  const status = () => broadcast({ type: 'status', data: { simulation: 'running', connectedClients: sockets.clients.size } });
  sockets.on('connection', (client) => {
    client.on('error', () => client.terminate());
    client.on('close', status);
    status();
    broadcast({ type: 'motion', data: simulator.getMovement() });
    client.send(JSON.stringify({ type: 'settings', data: settings } satisfies ServerMessage));
    client.send(JSON.stringify({ type: 'faults', data: simulator.getFaultState() } satisfies ServerMessage));
  });
  const simulator = new Simulator(settings, (data) => broadcast({ type: 'measurement', data }), (data) => broadcast({ type: 'faults', data }));
  let motionTimer: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  return {
    get settings() { return settings; },
    async listen(port = 3001) {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      simulator.start();
      motionTimer = setInterval(() => broadcast({ type: 'motion', data: simulator.getMovement() }), 50);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      return address.port;
    },
    close() {
      if (closing) return closing;
      clearInterval(motionTimer);
      simulator.stop();
      for (const client of sockets.clients) client.terminate();
      closing = Promise.all([
        new Promise<void>((resolve) => sockets.close(() => resolve())),
        new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      ]).then(() => undefined);
      return closing;
    },
  };
}
