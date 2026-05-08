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
  server: {
    host: '0.0.0.0', // Allow access from any IP on network
    port: 5174,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (normalizedId.includes('/src/components/BpmnEditor/')) {
            return 'feature-bpmn'
          }

          if (normalizedId.includes('/src/pages/simulation-workbench/')) {
            return 'feature-simulation'
          }

          if (
            normalizedId.includes('/src/components/EntityCollaborationPanel.jsx') ||
            normalizedId.includes('/src/components/NotificationCenter.jsx')
          ) {
            return 'feature-collaboration'
          }

          if (!normalizedId.includes('node_modules')) {
            return undefined
          }

          if (normalizedId.includes('bpmn-js') || normalizedId.includes('bpmn-moddle') || normalizedId.includes('diagram-js')) {
            return 'bpmn'
          }

          if (normalizedId.includes('react-bootstrap') || normalizedId.includes('bootstrap')) {
            return 'bootstrap'
          }

          if (normalizedId.includes('react-router') || normalizedId.includes('@remix-run')) {
            return 'router'
          }

          if (normalizedId.includes('lucide-react') || normalizedId.includes('bootstrap-icons')) {
            return 'icons'
          }

          return 'vendor'
        },
      },
    },
  },
})
