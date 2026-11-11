import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { ffmpegAssets } from './scripts/ffmpeg-assets.ts';
import { playerPreview } from './scripts/player-preview.ts';

export default defineConfig({
  root: 'web',
  resolve: { alias: { '@edition': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  plugins: [react(), tailwindcss(), ffmpegAssets(), playerPreview()],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      input: { app: fileURLToPath(new URL('./web/index.html', import.meta.url)) },
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
