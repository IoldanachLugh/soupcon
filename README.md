# SOUPCON — Soup Conditions

A small weather app that checks the live National Weather Service forecast
and current conditions for your location and translates them into a **Soup
Condition (SOUPCON)** level — a tongue-in-cheek severity scale for "should I
make soup and stay home today?"

Live at [soupcon.org](https://soupcon.org).

## What it does

- Looks up the NWS hourly forecast, extended (multi-day) forecast, and
  current conditions for your location, either via browser geolocation or a
  manually entered US ZIP code. Outside the US (where NWS has no data) it
  uses Open-Meteo's worldwide forecast instead, reached through browser
  geolocation or the `lat`/`lon` URL parameters (see "Worldwide lookups"
  below).
- Accepts optional `lat` and `lon` URL parameters (e.g.
  `https://soupcon.org/?lat=47.6062&lon=-122.3321`) to load a specific
  location on page load. Both are required and must be in range, otherwise
  they're ignored. They take priority over the remembered lookup method,
  and a URL-driven lookup is not saved as the "last used" method.
- Classifies that data into a 5-level SOUPCON scale (see below), with a
  randomized bit of commentary per level.
- Remembers whichever method (location or ZIP) you used last, and
  automatically re-runs it on your next visit — no need to click a button
  again.
- Lists every raw active NWS alert covering your location (US only; the
  section is hidden for other locations), independent of
  the SOUPCON score itself (the score is forecast-based now, not
  alert-based — see "The SOUPCON scale" below).
- Has a collapsible "Sources" section
  under the alerts that lists every nearby station's latest reading
  (which one is used, which were skipped and why) plus the hourly/extended
  forecast periods the score is computed from. Collapsed by default. For
  locations outside the US (Open-Meteo, no stations) it shows the current
  model values, hourly rows, the 12-hour cloud blocks and the daily outlook
  instead.
- Has a printable recipe modal, one hamburger-menu item per recipe
  (currently Potsticker Soup, Senegalese Chicken Soup, and Lasagna Soup, extracted from
  the owner's own recipe wiki), that prints cleanly on its own,
  independent of the rest of the page.
- Has a "Share" button (Facebook-blue, next to the alert count) that copies
  the on-screen SOUPCON condition text to the clipboard and opens Facebook's
  share dialog in a new tab, so the user pastes the text into their post.
  Facebook's `sharer.php` only accepts a URL (no custom text), which is why
  the text goes via clipboard; the link card comes from the `u` param.
- Shows a "Soup of the day" pill ("Lets make {recipe title}!") next to the
  Share button — one recipe chosen at random per local calendar day (cached
  in `localStorage` until local midnight, then re-rolled on the next visit;
  see `src/lib/soupOfTheDay.js`), opening that recipe's modal on click.
- Shows a "Snow soon, check your FRTCON!" pill ("Snow! Check FRTCON!"
  when it's already snowing) next to the Share button whenever
  snow (not rain) is the driving forecast — a cross-promo link to
  [frtcon.com](https://frtcon.com), the winter-storm-severity sibling app
  this fork started from.
- Installable as a home-screen app on Android (via the in-app "Install App"
  menu item) and iOS (via a guided "Add to Home Screen" flow, since iOS has
  no programmatic install API).

### The SOUPCON scale

| Level | Meaning |
|---|---|
| **1** | Currently raining |
| **2** | Rain expected in the next 12 hours |
| **3** | Rain expected in the next 48 hours (but not the next 12) |
| **4** | Cloudy and damp, no rain expected soon |
| **5** | Clear and sunny for the next several days |

The **most urgent** condition that applies wins — currently raining always
outranks rain later, which outranks no rain expected at all — but every
level is decided by checking in that order (see `classifySoupcon` in
`src/lib/soupcon.js`).

Classification works from NWS forecast text (`shortForecast` on hourly and
extended-forecast periods) and a nearby station's current-conditions
`textDescription`/precipitation reading, matched against keyword lists
(precipitation words for levels 1-3, cloudy vs. clear words for the 4-vs-5
split). Unlike NWS's alert `event` field (a fixed, published list of
canonical strings), `shortForecast` is genuinely closer to free text, so
this is a real judgment call rather than a canonical-code lookup — the
keyword lists were checked against live NWS output across several cities
before being trusted, but an unusual phrasing could still be missed.
"Currently raining" prefers a real station observation when one is fresh
enough (within 90 minutes, checked across nearby stations at once —
every station within 60 miles, at least the nearest 2 however far, at most
5 — nearest usable one wins) and
actually reports weather (many stations post timely observations with a
blank description); if none qualifies, it falls back to the current hourly
forecast period instead — but only counts it as "raining right now" at a
40%+ chance (or, with no probability reported, unhedged wording like
"Rain" rather than "Chance Rain"). Station "in vicinity" readings
("Showers in Vicinity") count as currently raining. Forecast periods that
have already ended are ignored — NWS responses often still lead with the
hour that just passed.

For the 4-vs-5 split, "Partly Cloudy" (NWS's night wording) and "Partly
Sunny" (its day wording for the same sky) both count as fair skies; only
Mostly Cloudy, Cloudy, Overcast, fog and similar mean level 4. Any rain or
snow in the next four 12-hour extended periods also means level 4, never
"clear and sunny."

Levels 1-3 don't distinguish rain from snow for the *level* itself (both
mean "precipitation is happening or coming"), but the on-screen wording and
the falling-precipitation animation do: rain gets rain streaks and
rain-worded text ("It's raining right now"), snow gets falling snowflakes
and snow-worded text ("It's snowing right now"). "Freezing Rain" is treated
as rain (it falls and looks like rain, just freezes on contact); "Snow
Showers" and other mixed phrasing default to snow, the more specific and
disruptive condition. The rotating commentary lines in the condition box
are not type-specific — they stay rain-flavored (umbrellas, puddles, etc.)
regardless of whether it's actually raining or snowing, a known, accepted
gap rather than an oversight.

### Worldwide lookups (outside the US)

NWS covers US points only (including Puerto Rico, Hawaii, Alaska and Guam).
Every lookup tries NWS first; only when NWS answers that the point is
outside its coverage (HTTP 404 from `/points`) does it use
**[Open-Meteo](https://open-meteo.com/)** instead. An NWS outage is *not*
treated as "outside coverage" — it still fails, rather than silently
switching data source. See `src/lib/weatherProvider.js`.

- **Same scale, separate classifier.** `classifyOpenMeteo`
  (`src/lib/soupconOpenMeteo.js`) applies the same ordered 1-5 checks and
  returns the identical result shape, but decides from WMO weather codes and
  cloud-cover percentages (Open-Meteo gives no forecast text to keyword
  match). One table, `src/lib/wmoCodes.js`, maps each code to a readable
  label, rain/snow/none, and cloudy or not, and feeds both the classifier and
  the "Sources" panel.
- **Level 1** comes from Open-Meteo's `current` block (measured snowfall or
  rain amounts, then the weather code). It is a model estimate, not a
  station reading.
- **Levels 2-3**: any rain or snow code in the next 12 / 48 hourly rows. The
  hourly precipitation probability is shown but not used.
- **Level 4 vs. 5**: the next 48 hours are split into four 12-hour blocks; a
  block is cloudy if it has an overcast or fog hour or its average cloud
  cover is at least 70%. Any cloudy block means level 4. The daily outlook
  is display-only.
- **No alerts** outside the US (the alerts tag and section are hidden).
- **Place name**: outside the US the name comes from BigDataCloud's reverse
  geocoder *only* for a browser-geolocation lookup; `?lat=&lon=` coordinates
  show as "Lat 51.51, Lon -0.13" (its Fair Use Policy allows only the
  device's own location).
- Non-US ZIP/postal codes are not supported ("Search US ZIP").

## Tech stack

- React + Vite
- Plain CSS (no CSS-in-JS, no Tailwind) — see `src/styles.css`
- `vitest` for the classification logic's and API layer's test suites
- No backend — this is a fully static, client-side app. All data comes
  directly from public APIs, called from the browser.
- No build-time API keys or secrets of any kind are required.

## Project structure

```
src/
  App.jsx                   — top-level state + orchestration
  styles.css                — all styling, semantically class-named
  lib/
    weatherApi.js            — fetch/network layer (NWS + ZIP lookup APIs)
    wmoCodes.js              — WMO weather code -> readable label / precip type /
                                cloudy flag (one table for classifier + Sources)
    soupconOpenMeteo.js      — normalizes Open-Meteo data and classifies it
                                (classifyOpenMeteo)
    reverseGeocode.js        — place names for non-US lookups (BigDataCloud,
                                browser-geolocation only)
    weatherProvider.js       — picks NWS (US) or Open-Meteo (elsewhere) per lookup:
                                lookupWeather, refreshWeather, classifyLookup
    openMeteoApi.js          — Open-Meteo fetch layer (non-US fallback,
                                see SOUP_PLAN.md item 22)
    cache.js                 — localStorage caching helpers (TTL-based)
    soupcon.js                — pure classification logic (classifySoupcon,
                                pickRandomItems) — no React/DOM dependency,
                                covered by soupcon.test.js
    soupcon.test.js            — vitest suite for the above
    weatherApi.test.js         — vitest suite for the API layer's station
                                selection, request de-dup, and
                                empty-forecast handling (fetch stubbed)
    soupOfTheDay.js            — picks/caches the "soup of the day" pill's
                                recipe until local midnight
    soupOfTheDay.test.js       — vitest suite for the above
  data/
    soupMessages.js            — the SOUPCON 1–5 headline/title/commentary content
    recipes/
      potstickerSoup.js         — one recipe per file, each imported and
      senegaleseChickenSoup.js  — wired up separately (not a shared list)
      lasagnaSoup.js
  hooks/
    useModalBehavior.js       — shared modal a11y: focus trap, focus
                                restore, body scroll lock, Escape-to-close
  components/
    RainOverlay.jsx
    SnowOverlay.jsx
    SoupconBadge.jsx
    SoupconMessage.jsx         — the condition status box
    StationDebugPanel.jsx      — "Sources" panel (raw station and
                                forecast data behind the condition)
    AlertCard.jsx
    RecipeModal.jsx
    IOSInstallHelp.jsx
```

## Getting started

```
npm install
npm run dev       # local dev server
npm run build     # production build, outputs to dist/
npm run test      # run the classification test suite once
```

## Deployment notes

This app is served as static files (currently via Apache, behind a
Cloudflare Tunnel). A few things beyond the built `dist/` output need to be
in place for full functionality:

- **PWA install support** relies on `manifest.json`, `sw.js`, `icon-192.png`,
  `icon-512.png`, and `icon-512-maskable.png` living in `public/` (so Vite
  includes them in the build) and landing at the site root, plus these tags
  already present in `index.html`'s `<head>` — listed here so anyone
  rebuilding `index.html` from scratch knows they're required, not because
  they're currently missing:

  ```html
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#1a0f2e" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  ```

  `icon-512-maskable.png` is a separate asset from `icon-512.png`, not a
  duplicate reference to it: Android applies its own shape mask (circle,
  squircle, etc.) to a `purpose: "maskable"` icon, so it needs the artwork
  pre-shrunk into the center safe zone with a full-bleed background —
  unlike `icon-192.png`/`icon-512.png` (`purpose: "any"`), which have
  transparent corners around a rounded-square icon and are meant to be
  shown as-is.

  The service worker is intentionally minimal — it does not cache anything
  and always defers to the network. This is deliberate: SOUPCON shows live
  rain-forecast data, so serving a stale cached response (even briefly, even
  offline) would be actively misleading rather than just inconvenient. Its
  main job is satisfying Chrome's installability requirement (a registered
  service worker with a fetch handler); it also catches a failed page
  navigation (e.g. the network genuinely not being ready yet during an
  Android cold start) and serves a small self-contained "Reconnecting…"
  page that retries with backoff and then gives up with a manual Retry
  button, rather than spinning forever or falling through to Chrome's own
  blank-looking offline interstitial — see `public/sw.js` for the
  retry/give-up logic.

- **Crawler/agent files** in `public/`: `robots.txt` (content signals + AI
  crawler rules), `sitemap.xml`, `index.md` (served for `Accept:
  text/markdown` on `/`), and `.htaccess` (that rewrite plus `Link`
  headers; requires Apache `mod_rewrite`/`mod_headers` and `AllowOverride
  All`). Note `.htaccess` is a dotfile — copy `dist/` with something that
  includes hidden files (e.g. `cp -a dist/. target/`, not `dist/*`).

- **File permissions matter.** Static assets need to be world-readable by
  whatever user your web server runs as (e.g. `www-data`) — files left at
  owner-only permissions will fail to serve with no obvious error, which
  will silently break the PWA install flow specifically (Chrome just never
  fires its install-eligibility event, with nothing logged to explain why).

## APIs used

- **[api.weather.gov](https://www.weather.gov/documentation/services-web-api)**
  (National Weather Service) — hourly forecast, extended forecast, and
  current observations (all three drive the SOUPCON score), plus active
  alerts (shown as an independent list, not part of the score). No API key
  required.
- **[api.open-meteo.com](https://open-meteo.com/)** — current, hourly and
  daily forecast for points outside NWS coverage. No API key required; the
  free tier is for non-commercial use.
- **[api.bigdatacloud.net](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api)**
  — reverse geocoding (coordinates → place name) for non-US
  browser-geolocation lookups. No API key; client-side only, device location
  only.
- **[api.zippopotam.us](https://www.zippopotam.us/)** — ZIP code → lat/lon
  lookup, used as an alternative to browser geolocation. No API key
  required.

Note: NWS's API documentation asks server-side consumers to identify
themselves via a `User-Agent` header. This is intentionally **not** set on
requests from this app — browsers won't let client-side JS set a real
custom `User-Agent` (Chrome/Firefox silently ignore it; Safari sends it as
a genuine custom header, which then fails CORS preflight since NWS doesn't
allow it in `Access-Control-Allow-Headers`, breaking every request
specifically on iOS). If a server-side proxy is ever introduced, that would
be the right place to add proper NWS attribution.

## Known limitations

- Outside the US: no alerts; "currently raining" is a model estimate rather
  than a station reading; the snow code mapping has only been checked
  against tests, not live data (no snow in the forecasts when it was built);
  and `?lat=&lon=` places show as coordinates rather than a name.
- No offline support, by design (see service worker note above).
- The "Install App" button only appears on Android/Chrome once Chrome
  decides the app is install-eligible (includes an engagement heuristic —
  it won't appear instantly on first load even after deploying this).
- On iOS, there is no way to trigger installation programmatically at
  all — the in-app menu instead shows manual "Add to Home Screen" steps.
- Classification depends on NWS's `shortForecast` phrasing matching one of a
  known set of precipitation/cloudy/clear keywords (see "The SOUPCON scale"
  above) — checked against live data from several cities, but not
  exhaustive, so an unusual forecast phrasing could in principle be missed.
- The rotating commentary lines in the condition box stay rain-flavored
  even during a snow event — only the short title/reason text and the
  falling-precipitation animation are type-aware, by design (see "The
  SOUPCON scale" above).

## Ideas for later (not yet built)

- **Dedicated recipe pages**: recipes are currently shown in an overlay
  modal (`RecipeModal.jsx`), reused for whichever recipe is picked from
  the hamburger menu. Giving each recipe its own page instead (e.g. for
  a shareable/deep-linkable URL) is a possible later change, not started.
- **Web Share API on mobile**: the Facebook Share button (see "What it
  does") covers the desktop-style flow; a native share sheet on mobile
  (carrying the condition text + a link directly) is not built.
- **Server-rendered share previews**: accept ZIP/coordinates as URL
  parameters, render the initial page server-side with those inputs, and
  set Open Graph meta tags to match — so a shared link shows an accurate,
  personalized condition preview instead of a generic one. Requires moving
  off a purely static/client-side model.
- **Push notifications**: update a home-screen badge automatically on a
  schedule (not just on app open), which requires a small backend to poll
  NWS and push updates.
- **Affiliate integration**: Walmart/Amazon product links for soup
  ingredients or rainy-day gear, potentially using Walmart's Recipes API
  against the actual recipe ingredient list. Requires a server-side
  credential proxy either way.
