# Events&I – TODO

## Open

- [ ] **Site kit v1 for events.andeye.com:** hero, eyebrow, padding, footer and the pink accent (#ff8fab, ruled 2026-10-26) match the kit; og.png is still the old green; still to copy from the private andeye.com repo (requested from andeye_com in brain2 coordination, 2026-10-26): the master `andeye-eye.js` (sha256 must match), `andeyeEye.astro`, the icon set and head tags. Then set `site_kit: 1` on the Events&I card. Discussions must be enabled on the repo for the footer link to work.
- [ ] **Leave early release** after the first events: collect feedback from attendees, hosts and organisers.
- [ ] **Generic programmes:** parallel sessions and tracks as well as sequential ones; several choice groups (not just `tour`); per-session attendance for multi-day events; calendar entries per chosen session when attendance is not "the whole day".
- [ ] **Calendar delivery:** test the invitation rendering in Gmail, Outlook (web and desktop), Apple Mail and Thunderbird with real Resend sends; consider a `text/calendar` alternative MIME part if Resend adds support. For events outside Europe/London, check that Outlook desktop accepts the generated VTIMEZONE (one-off observances, no RRULEs).
- [ ] **Events&I Plus:** fully hosted multi-tenant version (per-organisation Access, billing, custom domains, organisation branding in emails).
- [ ] **Waiting lists:** optional auto-promotion with an expiry window, as a per-event setting (off by default).
- [ ] **Waiting for the day but ticking the dinner (decision needed):** someone on the in-person waiting list who ticks an opt-in session is given a place at it, but gets no joining instructions or calendar entry until they have a day place. Either hold such people on the session's waiting list until they get a day place, or send them the session's instructions as if they came for it only.
- [ ] **Accessibility review** of the Astro components in a real browser, including colour contrast (the axe scan in jsdom cannot check contrast).
- [ ] **"Save without emailing anyone" and hosts:** a quiet session save still emails hosts their changed lists (and, since 2026-10-30, a replaced host the note to delete theirs). Either relabel the button ("without emailing attendees") or hold host emails back too.
- [ ] **Framework-neutral components:** plain HTML/JS versions of the booking, confirm and manage panels for non-Astro sites.
- [ ] **Polls, next steps:** several polls side by side are supported but untested in a real browser on small screens; drag and drop is mouse-only (touch and keyboard use the arrow buttons); suggestions are only on the manage page, as the booking form's address is not confirmed yet.
- [ ] **Poll email replies:** try real replies from Gmail, Outlook and Apple Mail through Email Routing, and check that Cloudflare's `Authentication-Results` header reaches the Worker (it has been reported missing on Worker delivery; replies without it are accepted on the From address and signed reference alone).
- [ ] **Packaging:** publish to npm with typed exports for the route handlers.

### Sharing contact details with session hosts (options to decide)

Hosts currently get names by default, and email addresses only for registrants who tick the optional sharing box. Other options considered:

1. **Names only, no sharing option** – simplest and most private; hosts contact attendees through the organiser.
2. **Opt-in email sharing** (current) – registrant chooses; changeable any time via their manage link; hosts are asked to delete lists after the session.
3. **Relay addresses** – hosts email a per-session alias that forwards to attendees without revealing addresses (needs inbound email routing).
4. **Host portal** – hosts sign in (Cloudflare Access) to see their list instead of receiving it by email, so nothing sits in inboxes.
5. **Organiser-sent messages per session** – the admin compose screen already filters by session; hosts could request messages rather than hold addresses.
