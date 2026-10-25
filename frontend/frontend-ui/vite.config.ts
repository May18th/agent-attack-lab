import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * 让管理员入口和兼容别名命中 `admin/index.html`。
 *
 * 根目录的 index.html 是前台原型单页，Vite 的 SPA fallback 会把所有未命中
 * 的路径都交给它，因此无尾斜杠入口会错误地渲染前台页面。这里在静态中间件
 * 之前把管理员入口重写成 `/admin/`，目录请求就能落到 admin 入口。
 */
function adminEntryPlugin(): Plugin {
  return {
    name: 'admin-entry',
    configureServer(server) {
      // 直接 use（不 return）才能在 Vite 内部静态/回退中间件之前改写 URL。
      const rewriteAdminEntry = (req: { url?: string }, _res: unknown, next: () => void) => {
        const url = req.url ?? ''
        const match = url.match(/^\/(admin|dashboard)(?:\/[^?]*)?(\?.*)?$/)
        if (match) {
          req.url = '/admin/' + (match[2] ?? '')
        }
        next()
      }
      server.middlewares.use(rewriteAdminEntry)
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? ''
        const match = url.match(/^\/(admin|dashboard)(?:\/[^?]*)?(\?.*)?$/)
        if (match) req.url = '/admin/index.html' + (match[2] ?? '')
        next()
      })
    },
  }
}

export default defineConfig(() => ({
  base: '/',
  plugins: [react(), adminEntryPlugin()],
  build: {
    rollupOptions: {
      // index.html 是前台（command center 原型单页），admin/index.html 是
      // 独立的管理员后台（React + AdminApp），两者互不影响。
      input: {
        main: 'index.html',
        admin: 'admin/index.html',
      },
    },
  },
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
