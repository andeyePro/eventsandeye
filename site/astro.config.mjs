import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://events.andeye.com',
  // single page, one stylesheet: inline it so the page arrives styled in one round-trip
  build: { inlineStylesheets: 'always' },
});
