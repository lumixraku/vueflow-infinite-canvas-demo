import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'model-viewer' } } })],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
