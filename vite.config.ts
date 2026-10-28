import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.SENSOR_SERVER_URL ?? 'http://127.0.0.1:3001';
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    '/api': { target }, '/ws': { target, ws: true },
  } },
});
