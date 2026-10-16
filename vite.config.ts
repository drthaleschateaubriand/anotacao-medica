/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Publicado em https://drthaleschateaubriand.github.io/anotacao-medica/ => base com subcaminho.
export default defineConfig({
  base: '/anotacao-medica/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
