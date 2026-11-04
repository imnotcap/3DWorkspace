import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import type { Plugin } from 'vite'

/**
 * OCR for plan import (room names and m²): tesseract's worker, its WebAssembly core and the
 * Danish + English language data are served from the site itself (public/ocr), so reading a
 * drawing never sends it anywhere.
 */
function ocrAssets(): Plugin {
  const files: [string, string][] = [
    ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['@tesseract.js-data/dan/4.0.0_best_int/dan.traineddata.gz', 'dan.traineddata.gz'],
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ]
  return {
    name: 'ocr-assets',
    buildStart() {
      const out = fileURLToPath(new URL('./public/ocr/', import.meta.url))
      mkdirSync(out, { recursive: true })
      for (const [from, to] of files) {
        const src = fileURLToPath(new URL(`./node_modules/${from}`, import.meta.url))
        if (existsSync(src)) copyFileSync(src, out + to)
      }
    },
  }
}

// BASE_PATH is set by the Pages workflow to "/<repo>/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), ocrAssets()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // three-mesh-bvh starts its BVH worker from `new URL(…, import.meta.url)`, which pre-bundling would break.
  optimizeDeps: { exclude: ['three-mesh-bvh'] },
  worker: { format: 'es' },
})
