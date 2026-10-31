import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The backend runs on :8090; the dev server proxies /api so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    // Let the dev server answer through an ngrok tunnel.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    proxy: {
      '/api': 'http://localhost:8090',
    },
  },
})
