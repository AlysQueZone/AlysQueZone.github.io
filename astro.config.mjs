import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages user site: https://alysquezone.github.io/
export default defineConfig({
  site: 'https://alysquezone.github.io',
  base: '/',
  vite: {
    plugins: [tailwindcss()],
  },
});
