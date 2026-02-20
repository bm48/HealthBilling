import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL || ''
  const anonKey = env.VITE_SUPABASE_ANON_KEY || ''

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    preview: {
      port: 9998
    },
    server: {
      proxy: {
        // Avoid CORS preflight in dev: browser calls same-origin /api/*, we forward to Supabase.
        '/api/send-contact': {
          target: supabaseUrl,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/send-contact/, '/functions/v1/smooth-endpoint'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (anonKey) proxyReq.setHeader('Authorization', `Bearer ${anonKey}`)
            })
          },
        },
        '/api/send-invite-email': {
          target: supabaseUrl,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/send-invite-email/, '/functions/v1/send-invite-email'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (anonKey) proxyReq.setHeader('Authorization', `Bearer ${anonKey}`)
            })
          },
        },
        '/api/get-invite-credentials': {
          target: supabaseUrl,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/get-invite-credentials/, '/functions/v1/get-invite-credentials'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (anonKey) proxyReq.setHeader('Authorization', `Bearer ${anonKey}`)
            })
          },
        },
      },
    },
  }
})
