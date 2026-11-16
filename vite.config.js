// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Backend (Flask) address for API mode. hpc only serves HTTPS now (campus security audit).
// Override with:  LOTUS_API=http://localhost:5000 npm run dev
const API = process.env.LOTUS_API || 'https://hpc.psy.ntu.edu.tw:5000'
const proxyTo = { target: API, changeOrigin: true, secure: true }

export default defineConfig(({ mode }) => {
  const isStatic = loadEnv(mode, process.cwd()).VITE_DATA_MODE === 'static'
  return {
    // static mode is a plain folder of files that works from any address, so it uses relative paths
    base: isStatic ? './' : '/lotus-bf/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
    },
    server: {
      allowedHosts: ['hpc.psy.ntu.edu.tw'],
      host: '0.0.0.0',
      port: 3000,
      proxy: { '/terms': proxyTo, '/query': proxyTo, '/help': proxyTo }
    }
  }
})
