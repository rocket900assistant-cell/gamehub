import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // allow tunnel hosts (cloudflare / localtunnel) during phone testing
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
