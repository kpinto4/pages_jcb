import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: [
      '.ngrok-free.dev',
      'hyperridiculously-monosymmetric-finley.ngrok-free.dev',
      'inversionesjcb.online',
      'www.inversionesjcb.online',
    ],
  },
});
