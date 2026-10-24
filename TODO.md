# Events&I – TODO

## Open

- [ ] **Leave early release** after the first events: collect feedback from attendees, hosts and organisers.
- [ ] **Generic programmes:** parallel sessions and tracks as well as sequential ones; several choice groups (not just `tour`); per-session attendance for multi-day events; calendar entries per chosen session when attendance is not "the whole day".
- [ ] **Event set-up front end:** create and edit events, sessions, capacities and joining instructions from the admin page; clone an event.
- [ ] **Time zones:** VTIMEZONE blocks for zones other than Europe/London (currently other zones fall back to UTC times).
- [ ] **Calendar delivery:** test the invitation rendering in Gmail, Outlook (web and desktop), Apple Mail and Thunderbird with real Resend sends; consider a `text/calendar` alternative MIME part if Resend adds support.
- [ ] **Events&I Plus:** fully hosted multi-tenant version (per-organisation Access, billing, custom domains, organisation branding in emails).
- [ ] **Waiting lists:** optional auto-promotion with an expiry window, as a per-event setting (off by default).
- [ ] **Waiting for the day but ticking the dinner (decision needed):** someone on the in-person waiting list who ticks an opt-in session is given a place at it, but gets no joining instructions or calendar entry until they have a day place. Either hold such people on the session's waiting list until they get a day place, or send them the session's instructions as if they came for it only.
- [ ] **Messages to just the opt-in sessions:** the audience filter has no "dinner only" or "signed up for X" option, and "In person" also reaches people coming only to the dinner.
- [ ] **Turnstile:** also check the `hostname` and an `action` in the siteverify response (a token minted on another site using the same key is accepted today).
- [ ] **Host list debounce:** a change of attendance re-emails every affected host at once; sending each host at most one list an hour from the cron would cut the noise during a busy sign-up day (self-service changes are capped at 10 emails an hour per registration for now).
- [ ] **Markdown renderer nits:** emphasis is applied inside code spans and `*` between numbers is read as italics; URLs containing `)` are cut short.
- [ ] **Accessibility review** of the Astro components in a real browser, including colour contrast (the axe scan in jsdom cannot check contrast).
- [ ] **Host changes:** when a session's host email changes, tell the previous host to delete the list they were sent.
- [ ] **Framework-neutral wording:** the form's attendance labels and the change-of-attendance email intro in `src/rsvp.ts` should come from event/session data rather than props.
- [ ] **Framework-neutral components:** plain HTML/JS versions of the booking, confirm and manage panels for non-Astro sites.
- [ ] **Packaging:** publish to npm with typed exports for the route handlers.

### Sharing contact details with session hosts (options to decide)

Hosts currently get names by default, and email addresses only for registrants who tick the optional sharing box. Other options considered:

1. **Names only, no sharing option** – simplest and most private; hosts contact attendees through the organiser.
2. **Opt-in email sharing** (current) – registrant chooses; changeable any time via their manage link; hosts are asked to delete lists after the session.
3. **Relay addresses** – hosts email a per-session alias that forwards to attendees without revealing addresses (needs inbound email routing).
4. **Host portal** – hosts sign in (Cloudflare Access) to see their list instead of receiving it by email, so nothing sits in inboxes.
5. **Organiser-sent messages per session** – the admin compose screen already filters by session; hosts could request messages rather than hold addresses.
