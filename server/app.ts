import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage, SensorSettings } from '../shared/protocol.js';
import { createSettings } from './settings.js';
import { Simulator } from './simulator.js';

export function createApp(input: Partial<SensorSettings> = {}) {
  const settings = createSettings(input);
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/settings') {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      response.end(JSON.stringify(settings));
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
  const status = () => broadcast({ type: 'status', data: { simulation: 'running', connectedClients: sockets.clients.size } });
  sockets.on('connection', (client) => {
    client.on('error', () => client.terminate());
    client.on('close', status);
    status();
  });
  const simulator = new Simulator(settings, (data) => broadcast({ type: 'measurement', data }));
  let closing: Promise<void> | undefined;
  return {
    settings,
    async listen(port = 3001) {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      simulator.start();
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      return address.port;
    },
    close() {
      if (closing) return closing;
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
