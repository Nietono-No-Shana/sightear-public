import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { courseLibraryPlugin } from './scripts/course-library-plugin';

export function courseChunkName(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');
  return /\/engine\/config\/(catalog-courses-\d+)\.ts$/.exec(normalized)?.[1];
}

export default defineConfig({
  // Relative base so the build works from a subpath (e.g. GitHub Pages project site).
  base: './',
  plugins: [courseLibraryPlugin()],
  build: {
    rollupOptions: {
      output: { manualChunks: courseChunkName },
    },
  },
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
    },
  },
});
