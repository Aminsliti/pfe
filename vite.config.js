import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('bpmn-js') || id.includes('bpmn-moddle') || id.includes('diagram-js')) {
            return 'bpmn'
          }

          if (id.includes('react-bootstrap') || id.includes('bootstrap')) {
            return 'bootstrap'
          }

          if (id.includes('react-router') || id.includes('@remix-run')) {
            return 'router'
          }

          return 'vendor'
        },
      },
    },
  },
})
