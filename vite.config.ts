import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// BASE_PATH is set by the Pages workflow to "/<repo>/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // three-mesh-bvh starts its BVH worker from `new URL(…, import.meta.url)`, which pre-bundling would break.
  optimizeDeps: { exclude: ['three-mesh-bvh'] },
  worker: { format: 'es' },
})
