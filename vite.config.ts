import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under the GitHub Pages sub-path.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
