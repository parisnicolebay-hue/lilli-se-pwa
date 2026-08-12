# lilli-se-pwa

Static front door for **lilli-se.vanillios.com**, hosted on GitHub Pages the
same way as `911dentist-pwa` (app.911dentist.org) and `today-tv-pwa`
(app.ontodaytv.com).

**This repo is public. It must never contain:** application code, patient or
synthetic-patient data, credentials, user lists, or a service worker.

Today it serves a bilingual private-pilot notice (noindex, nofollow, robots
disallow). The Lilli Sweden pilot application itself is developed privately
and will be hosted separately; when it goes live, this address moves (or
links) to that deployment.

No service worker is registered here on purpose: an installed worker on this
subdomain would fight the real app when hosting switches.
