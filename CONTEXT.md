# SOUPCON — Design Notes

> Shared for portfolio & demonstration purposes. All rights reserved.

These notes cover the things you can't see by reading the code: why it's
built the way it is, how it's hosted, what went wrong along the way, and
what was set aside for later. For what the app does and how the code is
organized, see `README.md`.

## Background

SOUPCON ("Soup Conditions") is a fork of [frtcon.com](https://frtcon.com)
("French Toast Conditions"). FRTCON rates winter-storm alerts. SOUPCON
rates the rain outlook instead (raining now, rain soon, rain later, cloudy,
clear) on a 5-level "should I make soup and stay home?" scale.

The fork kept FRTCON's plumbing: React and Vite, no backend, the National
Weather Service API, the installable PWA, and the general code layout. The
classification logic, data sources, content and branding are all new.
frtcon.com still runs as its own separate site. The rebuild went one item
at a time, logged in `SOUP_PLAN.md`.

I'm mainly a backend developer, and I used FRTCON and then SOUPCON to get
more frontend experience and to practice AI-assisted development. Claude
wrote much of the code. I made the architecture and product decisions,
reviewed and tested the work, and handled the hosting and branding (the
name, the scale, the icon artwork, and the color palette).

## Hosting

- The site is plain static files served by Apache behind a Cloudflare
  Tunnel, on the same origin server as frtcon.com. Nothing on the origin
  is exposed to the internet directly. The tunnel is the only way in.
- **No TLS certificate on the origin, on purpose.** The tunnel talks plain
  HTTP to Apache over loopback, and Cloudflare's edge handles HTTPS for
  visitors. An origin certificate would add upkeep and no security. (The
  original plan assumed a certbot setup like the one FRTCON was thought to
  have. Reading the actual tunnel config showed FRTCON doesn't use one
  either.)
- The Apache site allows `.htaccess` overrides (needed for the rewrite and
  header rules) and only accepts connections from localhost.
- There are two copies of the site: production at the root, and a `dev/`
  copy for checking a build before promoting it.
- **`mod_headers` was off when the site launched**, so Apache quietly
  dropped the `Link` headers set in `.htaccess`. The rules are wrapped in
  `<IfModule>`, which meant no error, just missing headers. It turned out
  frtcon.com had the same problem on the same server. Enabling the module
  fixed both.
- **Cloudflare's "Managed robots.txt" is on for this domain.** It inserts
  its own rules ahead of the app's `robots.txt`. Most crawlers only read
  the first `User-agent: *` group, so Cloudflare's version probably
  overrides the app's explicit `ai-input=yes`. This is still undecided.
  Fixing it would mean turning off the managed robots.txt for this domain.

## Frontend architecture

- React and Vite, no backend, no build-time secrets.
- `App.jsx` handles state and orchestration. `lib/` holds pure logic and
  network calls, `data/` holds static content, and `components/` holds the
  UI.
- **Styling** is plain CSS in `src/styles.css` with descriptive kebab-case
  class names (for example `.soupcon-condition-status` for the condition
  box and `.soupcon-badge--level-N` for level colors). Inline styles are
  used only for values that differ per element, like each raindrop's
  random position and timing in `RainOverlay.jsx`.
- `lib/soupcon.js` (`classifySoupcon`) is pure, with no React or DOM
  dependency, and has a full `vitest` suite. The API layer has its own
  tests with `fetch` stubbed out. FRTCON never had either.

### How the level is decided

This is the biggest difference from FRTCON. FRTCON matched each NWS
alert's `event` name, which comes from a fixed published list. There's no
NWS alert for "it's raining right now," so SOUPCON reads the forecast text
instead. `classifySoupcon` takes three inputs:

- **Hourly forecast** (`forecast/hourly`) sets the 12-hour and 48-hour rain
  windows (levels 2 and 3).
- **Station observation** (`/observations/latest` from a nearby station)
  sets "raining right now" (level 1).
- **Extended forecast** (`forecast`, 12-hour periods) decides cloudy vs.
  clear (levels 4 and 5) once rain is ruled out for 48 hours.

Forecast text like `shortForecast` is much closer to free text than an
alert name. So the rain, cloud and clear keyword lists were checked against
live NWS output for several rain-prone cities before I relied on them.
Even so, they can't be guaranteed complete.

Some details:

- **Rain vs. snow.** Snow keywords (snow, sleet, ice pellets, blizzard,
  flurries, wintry mix) are checked *before* rain keywords, so "Snow
  Showers" counts as snow instead of matching the "showers" rain keyword.
  The result carries a `precipType` that picks the wording ("It's raining"
  or "It's snowing") and the animation (`RainOverlay` or `SnowOverlay`).
  The rotating commentary lines in `soupMessages.js` stay rain-themed
  either way. A separate snow set was considered and left out. Freezing
  rain counts as rain, since it falls as rain and only freezes on contact.
- **Finding a station with a fresh reading.** The station NWS lists first
  for a point isn't always reporting. `selectObservationStations` sorts
  nearby stations by actual distance, since NWS's own order is only
  roughly by distance. It takes every station within 60 miles, but always
  at least 2 and never more than 5. (Rural points can have one station in
  range, and Seattle has 41.) They're all fetched in parallel, and the
  nearest one with a reading less than 90 minutes old that actually
  reports weather wins. Fresh but blank readings are common, even at major
  airports. If no station qualifies, the classifier falls back to the
  current hourly forecast period.
- **Ended forecast periods are dropped.** Live hourly forecasts often still
  start with the hour that just ended, and cached copies age further. The
  classifier ignores any period whose end time has passed. It accepts an
  injectable `now` for tests.
- **Judgment calls in the classifier:**
  - "Partly Cloudy" (NWS's night wording) and "Partly Sunny" (its day
    wording) describe the same sky, so neither counts as cloudy.
  - The hourly fallback for level 1 needs a 40% chance of rain, or unhedged
    wording when NWS gives no percentage. That's a higher bar than levels
    2 and 3, where any rain wording counts.
  - Rain anywhere in the next four extended periods means level 4, never
    "clear and sunny."
  - Station readings like "Showers in Vicinity" count as raining now.
- **An empty forecast is an error, not "clear."** If NWS returns zero
  hourly periods, `getHourlyForecast` throws instead of letting the
  classifier fall through to level 5.
- **One shared `/points` lookup.** The label, hourly, extended and
  observation calls all need the same NWS `/points` response.
  `getGridpointInfo` caches it and merges concurrent requests for the same
  location into one. A pending request whose abort signal has already
  fired is never reused.
- **Sky cover for the chart only.** The Sources panel's 48-hour chart uses
  NWS's raw gridpoint `skyCover` percentage instead of guessing a number
  from words like "Mostly Cloudy." It's fetched only while the panel is
  open, and it isn't used for scoring.
- **Alerts are shown but not scored.** The app still lists every active
  NWS alert for the location (flood alerts fit a rain app), but the level
  doesn't depend on them.

### Outside the US (Open-Meteo)

NWS only covers US points. `weatherProvider.js` asks NWS first and switches
to [Open-Meteo](https://open-meteo.com/) only when NWS returns a **404** for
`/points`. London and Vancouver return 404. Puerto Rico, Hawaii, Alaska and
Guam don't, which is why this doesn't use a bounding box. Any other NWS
failure is treated as an error, so an NWS outage never quietly switches
data sources. A background refresh sticks with the provider the lookup
used.

- **Same scale, separate classifier.** `classifyOpenMeteo` decides from WMO
  weather codes and cloud-cover percentages. One table in `wmoCodes.js`
  feeds both the classifier and the Sources panel, so their wording can't
  drift apart. Both classifiers build results the same way, so each level
  reads the same whichever provider decided it.
  - Level 1 comes from Open-Meteo's `current` block, which is a model
    estimate, not a station reading.
  - Levels 2 and 3 count any rain or snow code in the next 12 or 48 hours.
    The precipitation chance is shown but not used.
  - For levels 4 and 5, the next 48 hours are split into four 12-hour
    blocks. A block is cloudy if it has an overcast or fog hour or
    averages at least 70% cloud cover. The 70% is my estimate of where
    NWS starts saying "Mostly Cloudy." The daily outlook is display-only,
    because a day's code reflects its worst hour.
- **Request details.** Times are requested as Unix timestamps, since local
  time strings carry no offset. The time zone is set to the location's
  own, so daily rows start at local midnight. The hourly series starts at
  the current hour.
- **Place names.** BigDataCloud's free reverse geocoder may only be called
  with the device's *own* location. Other coordinates can get the
  visitor's IP banned. So it's used only for browser-geolocation lookups.
  `?lat=&lon=` links show coordinates instead. The app waits at most 3
  seconds for a name, and a failure falls back to coordinates.
- **City search.** Choosing a country other than USA swaps the ZIP field
  for a city search using Open-Meteo's geocoding API. It returns populated
  places only, so airports don't crowd the list. Search by name has no
  device-location restriction.
- **Terms.** Open-Meteo's free tier is non-commercial only. That's fine
  for now, but it needs another look before adding ads or affiliate links.
- **Out of scope:** non-US postal codes, non-US alerts, and city search
  inside the US (ZIP covers that). The snow codes are covered by tests
  only, since nothing was forecasting snow when this was built.

### Other features

- **PWA.** There's a manifest, a service worker, and an install option in
  the menu. Android gets a real install button. iOS gets "Add to Home
  Screen" instructions, since iOS has no way to install programmatically.
  The service worker deliberately caches nothing, because stale rain data
  would be misleading. If a page load fails, it shows a small
  "Reconnecting…" page that retries with backoff and then offers a Retry
  button. `manifest.json` hard-codes `start_url` and `scope` to `/`, so the
  install flow can only be tested on the production copy, not `/dev/`.
- **Remembering the last lookup.** The app re-runs a returning visitor's
  last lookup (location, ZIP, or city). It's saved only after a lookup
  succeeds, never for `?lat=&lon=` links, and skipped if location
  permission has been denied.
- **Facebook Share.** Facebook's `sharer.php` takes only a URL, so the
  button copies the condition text to the clipboard first and then opens
  the share dialog. The copied text matches the condition box exactly, so
  the random commentary lines are picked in `App.jsx` rather than inside
  the component. The clipboard write happens *before* the new tab opens.
  Opening the tab first moved focus away and set off a Chrome clipboard
  permission prompt.
- **Icon and palette.** The icon is a two-tone bowl under three raindrops.
  I designed it and edited it by hand, then generated PNG and ICO sizes
  from the master SVG. The maskable Android icon is a separately scaled
  version so it survives circular cropping. The palette keeps FRTCON's
  blue accents (they match the icon's raindrops) and shifts the navy
  background colors to purple. Brand colors (Facebook blue), the error red,
  the amber condition box and the five level colors were left alone.
- **Soup of the day.** A random recipe is picked per local calendar date,
  not on a timer, so it changes at midnight. The app also re-checks at
  midnight and whenever the page becomes visible again, so a tab left open
  overnight still changes. Adding a recipe means adding it to `ALL_RECIPES`
  in `App.jsx`.

## Crawler and AI-agent files

Carried over from FRTCON and pointed at soupcon.org:

- `robots.txt` sets `Content-Signal: search=yes, ai-input=yes,
  ai-train=no`, blocks known AI training crawlers, and points to the
  sitemap. (See the Cloudflare caveat under Hosting.)
- `sitemap.xml` lists just `/`.
- `index.md` and `.htaccess`: a request for `/` with `Accept:
  text/markdown` gets a plain markdown description of the app, and `Link`
  headers advertise the sitemap and the markdown version.

## Lessons learned

- **A keyword classifier's fallback needs to know about every kind of
  input.** Before snow keywords existed, a plain "Snow" forecast matched
  nothing and fell through to level 5, "Clear and sunny," while it was
  snowing. A rain app still has to recognize snow in the same data feed.
- **Never set a custom `User-Agent` on requests to api.weather.gov.**
  Chrome and Firefox ignore it, but Safari, and so every iOS browser,
  sends it as a real header. NWS's CORS preflight rejects it, which breaks
  every request on iPhone. This happened once in FRTCON. If NWS
  attribution is ever needed, it belongs in a server-side proxy.
- **Static files must be world-readable.** Apache won't serve files that
  only their owner can read, and there's no visible error. This once broke
  FRTCON's PWA install: Chrome just never offered to install.
- **Don't install certbot from both snap and apt.** The DNS plugin only
  works with the snap version, and having both causes confusing
  "unrecognized arguments" errors.
- **A `cloudflared tunnel login` certificate covers only one DNS zone.**
  Routing a hostname in a different zone doesn't fail clearly. Instead it
  creates a broken record under the zone you did authorize.
- **Rule out caching first** when a layout bug shows up on just one device.
  One iOS margin bug on FRTCON turned out to be a cached old version.
- **Vite 8 needs Node 20.19+ or 22.12+.** An older Node fails in confusing
  ways. An old npm can also skip a required native package, which leaves
  `node_modules` broken until it's reinstalled.
- **Service workers update lazily.** After deploying a new `sw.js`, the app
  may need to be closed and reopened twice before the new worker takes
  over. For testing, uninstall and reinstall the PWA.
- **Headless browser testing.** The app was tested by running a standalone
  `chrome-headless-shell` against `vite preview` and controlling it through
  the DevTools protocol (it can rewrite API responses to simulate snow).
  Two things to know:
  - The app accepts a location fix up to 10 minutes old, so changing the
    emulated location mid-session can still return the old position.
  - Use emulated browser geolocation sparingly. It goes through the
    reverse geocoder, whose terms forbid looking up arbitrary coordinates.

## Decided against

- **Dropping the high-accuracy location retry.** Location lookups try a
  quick low-accuracy fix first, then retry once with GPS. Removing the
  retry would report a failure sooner (15 seconds instead of 45), but the
  retry is what rescues the cases where low accuracy fails. I tried
  removing it and put it back.
- **Cloudflare Bot Fight Mode.** There's no login or payment page to
  protect, the free version has no allowlist, and it's known to block
  legitimate traffic.
- **A native app.** Out of proportion to the benefit. The PWA gets most of
  it without app store review or upkeep.
- **A home-screen icon that changes with the level.** Not possible on the
  web on any platform. The Badging API (a small number or dot) is the
  closest thing.

## Ideas for later

- **Separate pages for recipes**, instead of the pop-up, for shareable
  links. The app has no router yet.
- **The Web Share API on mobile**, for a native share sheet.
- **Server-rendered share previews.** Accept a ZIP or coordinates in the
  URL, render the page on the server, and set Open Graph tags so a shared
  link previews the real condition for that place.
- **Push notifications** to update the condition while the app is closed.
  This needs a small backend that polls NWS.
- **Affiliate links** for soup ingredients or rainy-day gear, possibly
  through Walmart's recipe API matched against the recipe's ingredients.
  Product APIs need keys that can't be exposed in the browser, so this
  needs a server-side proxy too. AdSense would be a simpler alternative.

Every idea above except recipe pages needs a backend or server rendering.
When the time comes, it makes sense to build that once for all of them.

---

© Jeffrey Morton. Shared for portfolio & demonstration purposes. All rights
reserved.
