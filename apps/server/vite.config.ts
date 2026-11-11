import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { localizedStartup } from './scripts/localized-startup.mjs';

const webRoot = fileURLToPath(new URL('./web', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/web', import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react(), tailwindcss(), localizedStartup(fileURLToPath(new URL('./web/src/i18n/messages',import.meta.url))), {
    name: 'nonblocking-startup-css',
    transformIndexHtml: {
      order: 'post',
      handler: html => html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g,
        tag => tag.replace('rel="stylesheet"', 'rel="stylesheet" media="print" data-startup-style'))
    }
  }],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@heroui')) return 'heroui';
          if (id.includes('node_modules/@tanstack')) return 'tanstack';
          if (id.includes('node_modules/@phosphor-icons')) return 'icons';
        }
      }
    }
  }
});
