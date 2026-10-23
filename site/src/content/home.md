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
  cta_inuse_href: "https://amybo.org/events/"
  cta_andeye_label: More from andeye
  sub_default: Built for meetups, open days, workshops and lab tours with tens of people, not thousands.
  sub_setup: Free and open source. The README walks you through Cloudflare, Resend and the admin page, step by step.
  sub_inuse: AMYBO, a non-profit sustainable protein community, uses Events&I for its events.
  sub_andeye: From the makers of Time&I and Vibe&I.
  fineprint: Free and open source under the AGPL-3.0. Early release, and feedback is very welcome.
  see_journey_label: "▾ follow a registration from sign-up to the day"
journey:
  eyebrow: How it works
  h2: From sign-up to the day
  lede: Click a step to see what your attendee gets. Every email is short, has their personal link, and only goes out when something has actually changed for them.
  window_title: Inbox
  steps:
    - id: register
      label: Register
      who: Attendee
      desc: On your event page, they choose in person or remote, pick a lab tour, tick the dinner and agree to the privacy notice.
      from: Example Organisers
      subject: "Complete your registration: Example Community Day"
      body:
        - "Someone, hopefully you, registered this address for the Example Community Day on Friday, 5 March 2027 at 10:00."
        - "Your registration is not complete yet. Please click the button below now to confirm your email address."
        - "You are confirming: an in-person place is held for you; a place is held for you on the 10:00 workshop tour; you would like to join us for dinner."
      button: Complete registration
    - id: confirm
      label: Confirm
      who: Attendee
      desc: Double opt-in. The place is held until they click, then their joining instructions arrive with calendar invitations.
      from: Example Organisers
      subject: "Joining instructions: Example Community Day, 5 March 2027"
      body:
        - "Thank you for registering for the Example Community Day, on Friday 5 March 2027."
        - "You have an in-person place. You are booked on the 10:00 workshop tour. You would like to join us for dinner."
        - "Where: Example Hall, 1 Example Street, Glasgow. Please sign in at reception."
        - "Your calendar: Example Community Day, and Dinner at The Example Arms. Add to Google, Outlook, Office 365, Yahoo or Apple."
      button: Manage my registration
    - id: waitlist
      label: Waiting list
      who: Attendee
      desc: When the room, a tour or the dinner is full, they join its waiting list, and you decide who gets a freed place.
      from: Example Organisers
      subject: "Your registration: Example Community Day"
      body:
        - "Thank you for confirming your registration for the Example Community Day."
        - "You will receive joining instructions if a place becomes available."
        - "You are joining us for dinner only."
        - "You are on the waiting list for dinner. We will email you if a place becomes available."
      button: Manage my registration
    - id: change
      label: A change
      who: Organiser
      desc: Move a session or change a room on the admin page. Only the people whose calendar entries change hear about it.
      from: Example Organisers
      subject: "Calendar update: Example Community Day"
      body:
        - "Your calendar entries for the Example Community Day have changed:"
        - "Example Community Day: Dinner: now Friday, 5 March 2027 at 18:00, The Example Arms, 2 Example Street, Glasgow."
        - "The attached invitations update your calendar."
      button: Manage my registration
    - id: host
      label: Session hosts
      who: Host
      desc: Whoever leads a tour gets the list of who is coming whenever it changes, with additions in bold and removals struck through.
      from: Example Organisers
      subject: "Attendee list changed: 10:00 workshop tour, Example Community Day"
      body:
        - "The list for 10:00 workshop tour (Friday, 5 March 2027 at 10:00) has changed. Changes are in bold (added or changed) or struck through (removed)."
        - "7 registered of 8 places: 1. Robin Example – booked … 7. **Sam Example – booked** (new)"
        - "Removed: ~~Alex Example – booked~~"
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
