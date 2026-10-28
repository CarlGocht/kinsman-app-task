import { createApp } from './app.js';
import { settingsFromEnv } from './settings.js';

try {
  const port = process.env.PORT === undefined ? 3001 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  const app = createApp(settingsFromEnv(process.env));
  const actualPort = await app.listen(port);
  console.log(`Sensor server: http://127.0.0.1:${actualPort}/api/settings`);
  console.log(`Stream: ws://127.0.0.1:${actualPort}/ws (seed ${app.settings.seed})`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => console.log('Sensor server stopped.')).catch((error) => {
        console.error(error); process.exitCode = 1;
      });
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
