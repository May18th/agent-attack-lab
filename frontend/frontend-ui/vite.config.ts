import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Pages serves this SPA from the domain root; keep asset URLs valid on the custom domain.
  base: '/',
  plugins: [react()],
  server: {
    allowedHosts: [
      'wiring-intimate-trees-mike.trycloudflare.com',
      '6586b7f3.r16.cpolar.top',
      '.trycloudflare.com',
    ],
  },
})
