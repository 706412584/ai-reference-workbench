import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相对路径：file:// 与 Android WebView 虚拟源都能直接打开
  base: './',
  build: {
    // Android WebView 81 对应 Chrome 81
    target: ['chrome81', 'es2019'],
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
  },
})
