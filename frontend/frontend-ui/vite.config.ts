import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(() => ({
  base: '/',
  plugins: [react()],
  server: {
    allowedHosts: [
      'wiring-intimate-trees-mike.trycloudflare.com',
      '6586b7f3.r16.cpolar.top',
      '.trycloudflare.com',
    ],
    proxy: {
      '/__preview_api': {
        target: 'https://preview-api.yuanyiagentzhandui.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__preview_api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
        },
      },
    },
  },
}))
