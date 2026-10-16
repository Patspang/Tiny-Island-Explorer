import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under the GitHub Pages sub-path.
  base: './',
  build: {
    target: 'es2022',
    // Rapier's compat build inlines its WebAssembly as base64 (~3.5 MB of the ~5 MB bundle,
    // 1.8 MB gzipped). Acceptable for a game page; revisit if load time becomes a problem.
    chunkSizeWarningLimit: 5500,
  },
});
