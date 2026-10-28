import type { IncomingMessage, ServerResponse } from 'node:http';

export function applyJson(request: IncomingMessage, response: ServerResponse, apply: (value: unknown) => unknown) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    response.writeHead(415); response.end(JSON.stringify({ error: 'Expected application/json' })); return;
  }
  let body = '';
  let oversized = false;
  request.on('data', (chunk: Buffer) => {
    if (oversized) return;
    body += chunk.toString();
    if (Buffer.byteLength(body) > 1024) {
      oversized = true;
      response.writeHead(413); response.end(JSON.stringify({ error: 'Body too large' }));
    }
  });
  request.on('end', () => {
    if (oversized) return;
    try { response.end(JSON.stringify(apply(JSON.parse(body)))); }
    catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid request' })); }
  });
}
