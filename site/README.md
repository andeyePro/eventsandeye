# events.andeye.com

The single-page website for Events&I, in the same treatment as andeye.com and vibe.andeye.com. All visible copy is in
[`src/home.md`](src/home.md); the layout is [`src/pages/index.astro`](src/pages/index.astro), and the
animated andeye mark is [`public/andeye-eye.js`](public/andeye-eye.js) (Events&I's variant is pink, with a small group of people as its iris; `glyph="calendar"` on `AndeyeEye` shows the alternative).

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

## Deploying on Cloudflare Pages

Workers & Pages → Create → Pages → Connect to Git → `andeyePro/eventsandeye`, project name `eventsandeye`, then:

- Production branch `main`; framework preset Astro; **root directory `site`**; build command `npm run build`;
  output directory `dist`; build variable `NODE_VERSION` = `22`.
- Under **Build watch paths**, include only `site/*`, so changes to Events&I itself don't rebuild the website.
- Custom domains → add `events.andeye.com` (the andeye.com zone is on Cloudflare, so the DNS record is added for you).

The page is static and has no Functions, no cookies and no analytics.
