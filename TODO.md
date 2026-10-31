# Events&I – TODO

## Open

- [ ] **Site kit v1 for events.andeye.com:** hero, eyebrow, padding, footer and the pink accent (#ff8fab, ruled 2026-10-26) match the kit; og.png is still the old green; still to copy from the private andeye.com repo (requested from andeye_com in brain2 coordination, 2026-10-26): the master `andeye-eye.js` (sha256 must match), `andeyeEye.astro`, the icon set and head tags. Then set `site_kit: 1` on the Events&I card. Discussions must be enabled on the repo for the footer link to work.
- [ ] **Leave early release** after the first events: collect feedback from attendees, hosts and organisers.
- [ ] **Generic programmes:** parallel sessions and tracks as well as sequential ones; several choice groups (not just `tour`); per-session attendance for multi-day events; calendar entries per chosen session when attendance is not "the whole day". (Done 2026-10-30: events over several days, attended whole, get one calendar entry per day and their dates as a range in emails.)
- [ ] **Calendar delivery:** test the invitation rendering in Gmail, Outlook (web and desktop), Apple Mail and Thunderbird with real Resend sends; consider a `text/calendar` alternative MIME part if Resend adds support. For events outside Europe/London, check that Outlook desktop accepts the generated VTIMEZONE (one-off observances, no RRULEs).
- [ ] **Events&I Plus:** fully hosted multi-tenant version (per-organisation Access, billing, custom domains, organisation branding in emails).
- [ ] **Waiting lists:** optional auto-promotion with an expiry window, as a per-event setting (off by default).
- [ ] **Waiting for the day but ticking the dinner (decision needed):** someone on the in-person waiting list who ticks an opt-in session is given a place at it, but gets no joining instructions or calendar entry until they have a day place. Either hold such people on the session's waiting list until they get a day place, or send them the session's instructions as if they came for it only.
- [ ] **Accessibility review, beyond Chromium:** the components, admin page and plain HTML versions are checked in headless Chromium by `tests/browser/` (axe-core, keyboard, focus after errors, forced colours, 200% text, phone widths, dark mode; 2026-10-30). Still to do: Firefox and Safari (waiting on a Mac test account, T5), a real screen reader (VoiceOver, NVDA), touch dragging on a phone, and Starlight's real token values (the colour calculation used its defaults).
- [ ] **Quiet saves and hosts (decision pending, T1):** relabelled "Save without emailing attendees" on 2026-10-30 (hosts still get their lists, and a replaced host the note to delete theirs). If hosts should not be emailed either, hold their lists until the next normal save.
- [!] **Registering someone else's address (security audit, minor; parked 2026-10-30):** a stranger who registers a person's address first can, by registering it again (it replaces the pending one) or four times (the limit), delay that person's own registration until the hold lapses (48 hours at most). Parked on purpose: telling the form-filler that the address is waiting for confirmation would reveal that it is registered, which is the worse leak; the person can still ask the organiser, and the hold limit stops it costing anyone a place.
- [ ] **Release:** tag `v0.3.0-beta` when pushing, and turn on private vulnerability reporting (Settings → Code security) for SECURITY.md.
- [ ] **Polls, next steps:** two polls side by side on a phone are covered by `tests/browser/polls.mjs` (2026-10-30), but not yet on a real phone; drag and drop is mouse-only (touch and keyboard use the arrow buttons); suggestions are only on the manage page, as the booking form's address is not confirmed yet.
- [ ] **Poll email replies:** try real replies from Gmail, Outlook and Apple Mail through Email Routing, and check that Cloudflare's `Authentication-Results` header reaches the Worker (it has been reported missing on Worker delivery; replies without it are accepted on the From address and signed reference alone).
- [ ] **Moving an event and its polls:** moving an event moves its sessions and deadline but not a poll's closing time; moving a closed poll's close could reopen it, so decide whether polls move too.
- [ ] **Skipped hour on the admin page:** a time typed in the hour the clocks skip in spring is stored an hour earlier, not later as the comment in `ukLocalToIso` (and `wallToIso`) says. Pick one and make code and comment agree.
- [ ] **Packaging:** publish to npm with typed exports for the route handlers.

### Sharing contact details with session hosts (options to decide)

Hosts currently get names by default, and email addresses only for registrants who tick the optional sharing box. Other options considered:

1. **Names only, no sharing option** – simplest and most private; hosts contact attendees through the organiser.
2. **Opt-in email sharing** (current) – registrant chooses; changeable any time via their manage link; hosts are asked to delete lists after the session.
3. **Relay addresses** – hosts email a per-session alias that forwards to attendees without revealing addresses (needs inbound email routing).
4. **Host portal** – hosts sign in (Cloudflare Access) to see their list instead of receiving it by email, so nothing sits in inboxes.
5. **Organiser-sent messages per session** – the admin compose screen already filters by session; hosts could request messages rather than hold addresses.
