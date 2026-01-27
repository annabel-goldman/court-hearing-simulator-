import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Base path for GitHub Pages - will be set by CI/CD
  // For user/org pages (username.github.io), use '/'
  // For project pages (username.github.io/repo-name), use '/repo-name/'
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
