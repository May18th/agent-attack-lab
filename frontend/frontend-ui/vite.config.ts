import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': 'http://127.0.0.1:8787',
      '/metrics': 'http://127.0.0.1:8787',
      '/battles': 'http://127.0.0.1:8787',
      '/reports': 'http://127.0.0.1:8787',
      '/leaderboard': 'http://127.0.0.1:8787',
      '/agent': 'http://127.0.0.1:8787',
      '/rpc': 'http://127.0.0.1:8787',
    },
    allowedHosts: [
      'wiring-intimate-trees-mike.trycloudflare.com',
      '6586b7f3.r16.cpolar.top',
    ],
  },
})
