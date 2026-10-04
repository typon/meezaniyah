import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    host: '127.0.0.1',
    fs: { deny: ['**/secret.json', '**/.dev.vars*', '**/.local/**', '**/.env*', '**/data/**', '**/.wrangler/**', '**/.git/**', '**/*.{crt,pem,key}'] },
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { sourcemap: false, target: 'es2022' },
});
