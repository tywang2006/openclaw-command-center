import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/cmd/',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5100',
      '/ws': { target: 'ws://127.0.0.1:5100', ws: true }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom']
        }
      }
    }
  }
})
