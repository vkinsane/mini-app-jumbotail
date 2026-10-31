import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The backend runs on :8090; the dev server proxies /api so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8090',
    },
  },
})
