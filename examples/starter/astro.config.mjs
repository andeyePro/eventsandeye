// @ts-check
import { defineConfig } from 'astro/config';

// A static site: Events&I's server side runs as Cloudflare Pages Functions from ./functions, beside the built pages.
export default defineConfig({
	site: 'https://example.org',
	trailingSlash: 'always',
});
