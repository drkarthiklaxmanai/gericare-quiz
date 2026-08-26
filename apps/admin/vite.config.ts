import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        rehearsal: resolve(__dirname, 'rehearsal.html'),
        participants: resolve(__dirname, 'participants.html'),
      },
    },
  },
});
