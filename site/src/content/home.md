---
title: Events&I
tagline: event registration you host yourself
description: Free, open source registration for small community events, on your own Cloudflare account. Double opt-in, waiting lists, calendar invitations, session hosts and only a few, useful emails.
hero:
  eyebrow: andeye · event registration you host yourself
  h1:
    - Small events,
    - well looked after
  lede: Free, open source registration for community events, running on your own Cloudflare account. Waiting lists, calendar invitations and joining instructions are handled for you, and attendees' details stay with you.
  cta_setup_label: Set it up from GitHub
  cta_setup_href: "https://github.com/andeyePro/eventsandeye#set-it-up"
  cta_inuse_label: See it in use
  cta_inuse_href: "https://amy.bo/event"
  cta_andeye_label: More from andeye
  sub_default: Built for meetups, open days, workshops and lab tours with tens of people, not thousands.
  sub_setup: Free and open source. The README walks you through Cloudflare, Resend and the admin page, step by step.
  sub_inuse: "AMYBO, a non-profit sustainable protein community, takes registrations for its 13 November event with Events&I."
  sub_andeye: From the makers of Time&I and Vibe&I.
  fineprint: Free and open source under the AGPL-3.0. Early release, and feedback is very welcome.
  see_journey_label: "▾ follow a registration from sign-up to the day"
journey:
  eyebrow: How it works
  h2: From sign-up to the day
  lede: Click a step to see what an attendee gets, using AMYBO's event as the example. Every email is short, has their personal link, and only goes out when something has actually changed for them.
  window_title: Inbox
  steps:
    - id: register
      label: Register
      who: Attendee
      desc: On the event page, they choose in person or remote, pick a lab tour, tick the dinner and agree to the privacy notice.
      from: AMYBO
      subject: "Complete your registration: AMYBO Event, London"
      body:
        - "Someone, hopefully you, registered this address for the AMYBO Event, London on Friday, 13 November 2026 at 10:30."
        - "Your registration is not complete yet. Please click the button below now to confirm your email address."
        - "You are confirming: an in-person place is held for you; a place is held for you on the 10:30 lab tour; you would like to join us for dinner."
      button: Complete registration
    - id: confirm
      label: Confirm
      who: Attendee
      desc: Double opt-in. The place is held until they click, then their joining instructions arrive with calendar invitations.
      from: AMYBO
      subject: "Joining instructions: AMYBO Event, 13 November 2026"
      body:
        - "Thank you for registering for the AMYBO Event, London, on Friday 13 November 2026."
        - "You have an in-person place. You are booked on the 10:30 lab tour. You would like to join us for dinner."
        - "Where: Room 516, the I-HUB, Imperial College White City campus, 84 Wood Lane, London W12 0BZ. Please sign in at reception, then come up to Room 516."
        - "Your calendar: AMYBO Event, London, and Dinner at The Hawk's Nest. Add to Google, Outlook, Office 365, Yahoo or Apple."
      button: Manage my registration
    - id: waitlist
      label: Waiting list
      who: Attendee
      desc: When the room, a tour or the dinner is full, they join its waiting list, and you decide who gets a freed place.
      from: AMYBO
      subject: "Your registration: AMYBO Event, London"
      body:
        - "Thank you for confirming your registration for the AMYBO Event, London."
        - "You will receive joining instructions if a place becomes available."
        - "You are joining us for dinner only."
        - "You are on the waiting list for dinner. We will email you if a place becomes available."
      button: Manage my registration
    - id: change
      label: A change
      who: Organiser
      desc: Move a session or change a room on the admin page. Only the people whose calendar entries change hear about it.
      from: AMYBO
      subject: "Calendar update: AMYBO Event, London"
      body:
        - "Your calendar entries for the AMYBO Event, London have changed:"
        - "AMYBO Event, London: Dinner: now Friday, 13 November 2026 at 17:30, The Hawk's Nest, Goldhawk Road, Shepherd's Bush Market, London W12 8DF."
        - "The attached invitations update your calendar."
      button: Manage my registration
    - id: host
      label: Session hosts
      who: Host
      desc: Whoever leads a tour gets the list of who is coming whenever it changes, with additions in bold and removals struck through.
      from: AMYBO
      subject: "Attendee list changed: 10:30 lab tour, AMYBO Event, London"
      body:
        - "The list for 10:30 lab tour (Friday, 13 November 2026 at 10:30) has changed. Changes are in bold (added or changed) or struck through (removed)."
        - "7 registered of 10 places: 1. Robin A. – booked … 7. **Sam K. – booked** (new)"
        - "Removed: ~~Alex M. – booked~~"
      button: null
features:
  eyebrow: What you get
  h2: Everything a small event needs, and no more
  items:
    - title: Places and waiting lists
      text: An in-person maximum, separate capacities for tours and dinners, and waiting lists you promote from with one click.
    - title: Calendar invitations that update
      text: Real invitations with reminders, including a "time to leave" one. Change a session and only the affected entries update.
    - title: Joining instructions, versioned
      text: Separate sections for in-person, remote and dinner-only guests, and a record of who has which version.
    - title: Messages and a sent log
      text: Email everyone or a filtered group, now or scheduled, with a per-person delivery record you can review.
    - title: Self-service for attendees
      text: Every email carries a personal link to view, change or cancel. Cancelling deletes their details.
    - title: Private by design
      text: Your own Cloudflare account, double opt-in, an admin page behind two-factor sign-in, and everything deleted 30 days after the event.
setup:
  eyebrow: What you need
  h2: Your own Cloudflare, your own data
  lede: Events&I runs on Cloudflare Pages, D1 and a small Worker, and sends email through Resend. A small event fits within their free plans. If your site is on Cloudflare Pages, setting it up takes an afternoon.
  items:
    - A Cloudflare account with your domain on it
    - A Resend account for sending email
    - A site on Cloudflare Pages (the ready-made form is an Astro component)
  cta_label: Read the setup guide
  cta_href: "https://github.com/andeyePro/eventsandeye#set-it-up"
who:
  eyebrow: Who it's for
  h2: Community organisers who would rather not hand their attendees to a platform
  lede: Non-profits, research groups, meetups and open source communities running events for tens of people, who want registration that is free, respectful of attendees and under their own control.
footer: andeye Ltd
---

**Events&I** is the registration system we wanted for our own community events: **free, open source and on your own account**, with the details that make a day run smoothly (waiting lists, calendar invitations that update, tour and dinner sign-ups) and **none of the tracking**.
