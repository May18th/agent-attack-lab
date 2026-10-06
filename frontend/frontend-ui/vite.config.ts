import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'wiring-intimate-trees-mike.trycloudflare.com',
      '6586b7f3.r16.cpolar.top',
    ],
  },
})
