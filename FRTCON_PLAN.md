# FRTCON Code Review

> Shared for portfolio & demonstration purposes. All rights reserved.

> **Historical.** This review covers the original FRTCON app ("French Toast
> Conditions," a winter-storm version of this app), before it was rebuilt
> as SOUPCON. Most of the files it mentions (`frtcon.js`,
> `alertMessages.js`, `FrtconBadge`, the zone-based alert lookup, and so
> on) no longer exist. It's kept because the fixes and reasoning still
> hold. See `SOUP_PLAN.md` for the rebuild.

A full review of the FRTCON codebase (2026-09-14), sorted by priority, with
each finding's fix and how it was checked. Lint and the production build
were clean at the start.

---

## Correctness

### 1. Alerts missed county- and storm-based warnings

**Problem.** Alerts were fetched by forecast zone, which only returns
alerts issued for that zone. Alerts issued by county or by storm polygon
were missed, including Snow Squall Warnings (FRTCON level 2). A live check
confirmed it: for four county-based flood alerts active at the time, the
zone query returned none, and a point query returned all four.

**Fix.** Fetch alerts by point (`/alerts/active?point=lat,lon`), cache by
rounded coordinates, and key the auto-refresh on coordinates instead of
the zone. Re-checked live against an active Flash Flood Warning: zone
query 0 results, point query 1.

### 2. The offline page reloaded forever

**Problem.** When a page load failed, the service worker's "Reconnecting…"
page reloaded every 1.5 seconds with no limit. In airplane mode or during
an outage, the installed app spun forever and drained the battery.

**Fix.** Back off (1.5 s, 3 s, 6 s, 6 s). After four tries, or right away
if the browser reports being offline, show "Can't reach FRTCON" with a
Retry button. Also retry when the connection comes back. The counter
resets once the app loads successfully. Checked by running the exact
generated page in a real browser, forcing the offline case, the full
backoff, Retry, and the reconnect event. Still untested: a real installed
app in airplane mode on a phone.

---

## UX and reliability

### 3. No refresh when the app came back to the foreground

**Problem.** Phones pause timers in background tabs and suspended apps, so
a reopened app could show hours-old alerts.

**Fix.** Record when data was fetched. When the page becomes visible again
and the data is more than 60 seconds old, refresh right away. Show
"Updated h:mm" on the card. Checked in a browser: no refresh when the data
was fresh, and exactly one refresh after waiting past 60 seconds.

### 4. Raw error messages shown to users

**Problem.** Users saw messages like "Request failed (404) for
https://api.zippopotam.us/us/00000."

**Fix.** Network errors carry their status. Each call site turns them
into plain language: "We couldn't find that ZIP code," "This location
isn't covered by the National Weather Service," or "The weather service
isn't responding right now." The technical details still go to the
console. Checked with a bad ZIP, a London location, a simulated 500 error,
and a forced timeout.

Not covered: a total network failure (offline, DNS) still shows the
browser's own message.

### 5. Failed lookups were remembered and retried on every visit

**Problem.** The lookup method was saved *before* the lookup finished. A
denied location permission or a nonexistent ZIP replayed on every visit.

**Fix.** Save only after a lookup succeeds. Skip the automatic location
lookup when permission is known to be denied. Checked in a browser: bad
ZIPs aren't saved, a later failure doesn't overwrite an earlier success,
and the automatic lookup is skipped when permission is "denied" but still
runs when it's "prompt."

### 6. Focus was lost after closing a menu-opened modal

**Problem.** The menu item that opened a modal was gone by the time the
modal opened, so when it closed, focus went to the top of the page.
Keyboard and screen-reader users lost their place.

**Fix.** The modal focus hook takes a fallback element (the menu button).
It's used when there was nothing real to return to. Checking whether the
saved element is still on the page wasn't enough, because the browser
reports the page body as focused and the body is always on the page. So
the hook treats the body as "nothing focused." Checked in a browser with
both Escape and the Close button.

### 7. iPads never saw "Add to Home Screen"

**Problem.** Safari on iPad (iPadOS 13 and later) identifies itself as a
Mac, so iOS detection failed.

**Fix.** Treat a "Macintosh" device with a touchscreen as iOS, and drop an
old Internet Explorer check. The instructions now say "your browser's
toolbar" instead of "Safari's," since other iOS browsers can add to the
home screen too. Checked with real iPad, Mac and iPhone browser
identifiers.

---

## Cleanup

### 8. The service worker handled every request for no reason

All scripts, styles, images and API calls went through the service
worker without any benefit. Now only page loads go through it. Installing
still works, since that only needs the handler to exist. Checked against
the running worker in a browser.

### 9. Leftover Vite starter CSS (`src/index.css`)

The template stylesheet was still loaded. It drew gray borders on desktop
in dark mode, among other side effects. I deleted it after tracing every
rule against the components, and moved over only what was actually in
use:

- left-aligned text in dialogs
- the paragraph margin reset
- heading font and weight
- the base font size (18px, or 16px on narrow screens), which most body
  text inherits

Deleting the file outright would have quietly shrunk most of the text and
changed every heading's font. Computed styles were identical before and
after, and screenshots matched pixel for pixel.

### 10. The README was out of date

The README was updated to describe how classification actually worked, to
present the PWA tags as already in place instead of a to-do, and to cover
the service worker's reconnect page.

### 11. No tests for the classification logic (replaced by SOUPCON)

Planned as a `vitest` suite for FRTCON's classifier. The rebuild replaced
that classifier, and the new one got tests from the start (see
`SOUP_PLAN.md` items 1 and 11).

### 12. Minor fixes

- Added a maskable Android icon, so Android doesn't shrink the icon inside
  a white shape.
- Added the standard `mobile-web-app-capable` tag next to Apple's
  deprecated one.
- Fixed a recipe step that said "pan" where it meant the baking dish.
- Expired cache entries are now cleared at startup, instead of piling up
  in `localStorage`.
- ZIP lookups now reuse one abort controller instead of creating and
  cancelling a second. Checked that back-to-back ZIP searches still cancel
  the first one properly.

---

## Product change

### 13. Frost Advisory and Freeze Warning lowered to level 4

A Frost Advisory is mainly a farming alert. It's common in spring and fall
and isn't a reason to stay home, yet a lone Frost Advisory in northern
Minnesota in mid-September scored FRTCON 3. Both Frost Advisory and Freeze
Warning moved to level 4. More serious alerts still win when both are
active. Level 4's existing "being watched" wording was kept.

---

## Checked and fine

- Handling of overlapping requests (abort controllers plus a sequence
  counter).
- No XSS risk: all NWS text is rendered as plain text.
- The offline page's inline script isn't blocked by a content security
  policy.
- Keyboard handling for the menu and modals (apart from #6).

---

© Jeffrey Morton. Shared for portfolio & demonstration purposes. All rights
reserved.
