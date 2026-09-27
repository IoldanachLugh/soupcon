# SOUP_PLAN.md — FRTCON → SOUPCON rebrand & rebuild

This is a running plan for turning this fork of frtcon.com into **soupcon.org
("Soup Conditions")** — worked one item at a time. Like `PLAN.md`, each item
gets a **Done:** note when finished (what changed, how it was verified), so a
later session doesn't redo work or re-litigate a decision already made here.
Unlike `PLAN.md`, this isn't a code-review list — it's a build-out plan for a
genuinely new app concept, sharing this codebase's plumbing (React/Vite, NWS
API, caching, PWA setup) but not its classification logic or content.

`frtcon.com` is explicitly **out of scope** and untouched — it keeps existing
as-is. `soupcon.org` is a new, independent deployment of this fork.

---

## Decisions locked in (2026-09-27, per user)

- **Concept:** SOUPCON = "Soup Conditions." Same 1=worst / 5=best shape as
  FRTCON, but about rain instead of winter storms:

  | Level | Meaning |
  |---|---|
  | **1** | Currently raining |
  | **2** | Rain expected in the next 12 hours |
  | **3** | Rain expected in the next 48 hours (but not the next 12) |
  | **4** | Cloudy and damp, no rain expected soon |
  | **5** | Clear and sunny for the next several days |

- **Data source:** NWS hourly forecast (gridpoint `forecast/hourly`) drives
  the 12h/48h windows, current conditions (nearest station's
  `/observations/latest`) drive "currently raining," and the multi-day
  `/forecast` drives the level-5 "clear for days" outlook. The alerts
  endpoint (`getActiveAlertsByPoint`) is **not** part of classification —
  see the open question below on whether it's kept for anything else.
- **Recipe modal:** replaced with a chicken noodle soup recipe for now.
  Rotating/multiple soup recipes are a real feature but explicitly
  "developed later" — don't build a rotation mechanism as part of this plan,
  just swap in the one recipe (matches this project's own "don't build for
  hypothetical future requirements" norm).
- **Infra:** `soupcon.org` gets its own domain registration, DNS zone, and
  Apache vhost, set up the same way `frtcon.com` was (Cloudflare Tunnel,
  Apache origin, certbot+DNS-01) but **as a separate site**, not folded into
  the existing frtcon.com config/cert.

## Open questions (resolve at the step that hits them, not now)

- **Raw alerts panel:** FRTCON shows every raw active NWS alert for the
  location alongside its score. Does SOUPCON keep an analogous "active NWS
  alerts here" panel (Flood Warning, Flood Advisory, etc. would still be
  genuinely relevant to a rain app), or drop it since the score itself is
  now forecast-based, not alert-based? Recommendation when we reach step 3:
  keep a lightweight version — flood-family alerts are on-theme — but this
  is a real product call, not a mechanical rename.
- **`SnowOverlay.jsx`:** falling-snow decoration doesn't fit a rain theme.
  Likely becomes a falling-rain (or sun-rays-on-clear-days) equivalent.
  Decide the specific visual when we get to step 5.
- **Location label:** FRTCON shows the NWS forecast *zone* name (from
  `getZoneByPoint`). NWS's `/points` response also returns
  `properties.relativeLocation` (city/state), which may read better for a
  "should I make soup" app than a zone name. Decide at step 2.
- **Nearest-station staleness:** `/observationStations` can return stations
  that haven't reported in hours. Step 1/2 needs a strategy (try the first
  N stations, take the freshest) rather than blindly using station #1 —
  flag as a real gotcha to test against live data, the way #1 in `PLAN.md`
  did for zone-vs-point alerts.
- **Visual theme:** FRTCON's palette (`#0b1f3a` deep blue, snow) is a winter
  palette. SOUPCON probably wants something rain/soup-coded (greys, warm
  broth tones?) — hold off until branding step (7), ask then if not obvious.
- **Domain registration status:** confirm `soupcon.org` is actually
  registered before step 12 (infra) is actionable at all.

---

## Sequenced work items

### 1. Core classification rewrite — `src/lib/soupcon.js` — ✅ FIXED

Replaces `src/lib/frtcon.js` (frtcon.js itself untouched for now — still
used by `App.jsx` until item 5). Pure functions, no React/DOM dependency
(same reason as before: directly unit-testable). Proposed shape:

- Input: hourly forecast periods (next ~48h), latest observation, and
  extended/daily forecast periods (next ~7 days) — not a list of alert
  features like `classifyAlert` took.
- `classifyForecast({ hourly, observation, extended })` → walks levels 1→5,
  first match wins (same ordered-checks pattern as `classifyAlert`):
  1. Observation's `textDescription`/present-weather indicates rain now.
  2. Any of the next 12 hourly periods' `shortForecast` /
     `probabilityOfPrecipitation` indicates rain.
  3. Any of hours 12–47 (but none of 0–11) indicate rain.
  4. Extended forecast reads cloudy/overcast/damp/foggy for the near term.
  5. Otherwise — extended forecast reads clear/sunny for the outlook window.
- Rain/clear keyword matching needs the same care `classifyAlert`'s comment
  gives NWS's `event` field: `shortForecast` **is** closer to free text than
  `event` was, so this needs real keyword lists (rain/showers/
  thunderstorms/drizzle vs. sunny/clear/mostly clear/mostly sunny) validated
  against live NWS output, not assumed — note day/night wording differs
  ("Sunny" vs. "Mostly Clear").
- Write `vitest` tests alongside this from the start (see item 11) instead
  of shelving them the way `PLAN.md` #11 got shelved for FRTCON.
- **Done:** implemented in `src/lib/soupcon.js` as `classifySoupcon`
  (plus exported helpers `periodIndicatesRain`/`observationIndicatesRain`
  and a copied-over `pickRandomItems`), following the proposed shape above:
  ordered checks 1→5, first match wins. Rain detection matches keywords
  (`rain`/`showers`/`shower`/`thunderstorm`/`drizzle`/`sprinkles`) in
  `shortForecast`/`textDescription`, or a ≥40% `probabilityOfPrecipitation`,
  or a positive `precipitationLastHour` reading. Level 1 prefers a real
  observation and only falls back to the current hourly period when no
  observation is available at all. Levels 2/3 split the hourly forecast at
  the 12-hour mark. Levels 4/5 look at the next 4 extended (12-hour)
  periods for cloudy/damp keywords, defaulting to level 5 (clear) when
  nothing matches — mirrors FRTCON's own "nothing else matched → level 5"
  default.
  - Added `vitest` as a dev dependency with a `"test": "vitest run"`
    script (pinned to `^2.1.9`, not the latest `5.x` — see the Node-version
    note below) and `src/lib/soupcon.test.js` covering: each level via
    representative fake data, the 12-vs-48-hour boundary, the
    no-observation fallback for level 1, the "only the next 4 extended
    periods count" boundary for the 4-vs-5 split, and `pickRandomItems`'s
    existing `min(count, length)` unique-items behavior. 19 tests, all
    passing.
  - **Not done in this step, left for item 5:** deleting `frtcon.js` or
    wiring `soupcon.js` into `App.jsx` — this item is scoped to the pure
    classification module only, so the app still runs on the old
    FRTCON/alerts logic for now, unchanged and still buildable.
  - **Environment note:** this shell's system Node (18.19.1) can't actually
    run `vitest`/`vite build` at all — Vite 8 needs Node 20.19+/22.12+, and
    a separate npm-9.x optional-dependency bug broke `node_modules` further
    until reinstalled under a newer npm. Verified `npm run test`, `npm run
    lint`, and `npm run build` all pass, but only after installing
    `node_modules` and running them with a Node 20+ binary (a scratch-space
    download, not a system upgrade — see the new `CONTEXT.md` gotcha for
    detail). No production/deploy environment is assumed to have this
    problem; it's specific to this dev shell as currently set up.

### 2. New API layer — `src/lib/weatherApi.js` — ✅ FIXED

- `getHourlyForecast(lat, lon, opts)` — `/points` → gridpoint URL →
  `/gridpoints/{office}/{x},{y}/forecast/hourly`.
- `getCurrentConditions(lat, lon, opts)` — `/points` →
  `properties.observationStations` → try stations in order until one has a
  recent `/observations/latest`.
- `getExtendedForecast(lat, lon, opts)` — same gridpoint's `/forecast`
  (12-hour periods, ~7 days).
- Decide here: keep `getZoneByPoint` (for a label) or switch to
  `relativeLocation` from the `/points` response — see open question above.
- Decide here: keep or drop `getActiveAlertsByPoint` per the open question
  above.
- Cache TTLs: observations should be short (comparable to today's 5-minute
  `ALERTS_CACHE_TTL_MS`); hourly forecast can be somewhat longer (NWS
  updates it roughly hourly); extended forecast longer still. New prefixes
  in `cache.js` (see item 9).
- **Done:** added three new exports to `weatherApi.js` —
  `getHourlyForecast`, `getExtendedForecast`, `getCurrentConditions` — plus
  a private, shared `getGridpointInfo(lat, lon)` helper that all three
  (and only they) use, so a single `/points` call/cache entry serves all
  three instead of each hitting `/points` separately for the same
  location.
  - **Location label decided:** `getGridpointInfo` reads
    `properties.relativeLocation.properties.city/state` off the same
    `/points` response and returns it as `locationLabel` (e.g. "Seattle,
    WA") — confirmed live against `api.weather.gov/points/47.6062,-122.3321`.
    Chosen over the FRTCON-era forecast-zone name per the open question
    above. `getZoneByPoint`/`getActiveAlertsByPoint` are untouched and
    still exported — item 3 decides whether either is still used.
  - **Nearest-station staleness handled:** a new private
    `findFreshObservation` tries up to 5 stations (in the order NWS's
    `/gridpoints/{office}/{x},{y}/stations` collection returns them) and
    takes the first with an observation timestamp within
    `OBSERVATION_MAX_AGE_MS` (90 minutes), rather than trusting station #1
    blindly. `getCurrentConditions` returns `null` (not a throw) if none
    qualify, or if the stations request itself fails — it's a best-effort
    secondary source and `classifySoupcon` already knows how to fall back
    to the current hourly period when observation is `null`.
  - **Cache TTLs added to `cache.js`:** `GRIDPOINT_CACHE_TTL_MS` (1h, same
    as the old zone cache), `HOURLY_FORECAST_CACHE_TTL_MS` (30m),
    `EXTENDED_FORECAST_CACHE_TTL_MS` (2h), `OBSERVATION_CACHE_TTL_MS` (5m,
    matching the existing alerts TTL) — with matching
    `GRIDPOINT_CACHE_PREFIX`/`HOURLY_FORECAST_CACHE_PREFIX`/
    `EXTENDED_FORECAST_CACHE_PREFIX`/`OBSERVATION_CACHE_PREFIX` keys (still
    `frtcon_`-namespaced for now — see item 9) and cache-key builders
    following the existing `makeZoneCacheKey`/`makeAlertsCacheKey` pattern.
    All four new prefixes were also added to `sweepExpiredCache`'s
    `TTL_MS_BY_PREFIX` map so they get swept the same way existing keys do.
    A `getCurrentConditions` miss (no fresh station found) is deliberately
    *not* cached, since `getCacheItem` can't distinguish a cached `null`
    from a genuine cache miss anyway (see `cache.js`) — no behavior lost by
    skipping the write.
  - **Verified against live `api.weather.gov`** (not just unit tests, since
    this item is almost entirely about matching real API shapes): fetched
    real `/points`, `/forecast/hourly`, `/forecast`, `/stations`, and
    `/observations/latest` responses for Seattle, WA and confirmed the
    exact field names/shapes this code assumes
    (`forecastHourly`/`forecast`/`observationStations`/`relativeLocation`
    URLs and fields, `stations.features[].id` being a full observation URL,
    `observations/latest`'s `timestamp`/`textDescription`/
    `precipitationLastHour` shape). Separately pulled 48h of hourly periods
    plus 6 extended periods across 5 rain-prone cities (Miami, New Orleans,
    Houston, Orlando, Tampa) and collected every distinct `shortForecast`
    string seen (`Chance Showers And Thunderstorms`, `Slight Chance Rain
    Showers`, `Showers And Thunderstorms Likely then Chance Showers And
    Thunderstorms`, plus the clear/cloudy variants) — confirmed all of them
    are caught by `soupcon.js`'s existing `RAIN_KEYWORDS`/`CLOUDY_KEYWORDS`/
    `CLEAR_KEYWORDS` lists with no surprises, so no changes were needed
    there. `npm run lint`, `npm run test` (19/19 still passing), and `npm
    run build` all pass.

### 3. Wire into `App.jsx` — ✅ FIXED

- Replace the `frtcon`/`frtconMessage` `useMemo`s with `soupcon`/
  `soupconMessage`, fed by the new data instead of `result.alerts`.
- `result` shape grows to carry hourly/observation/extended data instead of
  (or alongside, if the alerts panel is kept) `alerts`.
- The refresh machinery (`fetchedAt`, `STALE_ON_VISIBLE_MS`,
  `visibilitychange` effect, auto-refresh interval) is data-shape-agnostic
  and should carry over largely unchanged.
- Resolve the "raw alerts panel" open question here, since it determines
  whether `AlertCard.jsx` and the alerts fetch stay in the tree at all.
- **Done:**
  - **Alerts panel:** kept, decoupled from the score, per the plan's own
    recommendation. `result.alerts` is still fetched
    (`getActiveAlertsByPoint`) and rendered via `AlertCard`; the count tag
    next to the badge is unchanged. The one thing genuinely removed is the
    "Winter alerts driving the score" block -- `classifySoupcon` has no
    `matchingAlerts` equivalent (the score isn't alert-derived anymore), so
    that JSX block is gone, replaced with a comment explaining why.
  - **`result` shape:** now `{ source, lat, lon, locationLabel,
    hourlyPeriods, extendedPeriods, observation, alerts, fetchedAt }`.
    `zone` is gone; `getZoneByPoint` (and the now-orphaned
    `extractZoneIdFromUrl`, `makeZoneCacheKey`) were deleted from
    `weatherApi.js`/`cache.js` as confirmed-dead code once this was its
    only call site -- `ZONE_CACHE_PREFIX` itself was kept (just unused for
    new writes) so `sweepExpiredCache` can still clean up any leftover
    `frtcon_zone_lookup_*` keys from before this change.
  - **`runLookupFromCoordinates`** now fetches `getLocationLabel`,
    `getHourlyForecast`, `getExtendedForecast`, `getCurrentConditions`, and
    `getActiveAlertsByPoint` in parallel via `Promise.all` with the shared
    signal -- the first four collapse into a single `/points` request in
    practice via `getGridpointInfo`'s new in-flight de-dup (added in this
    step, not item 2, once the concurrent-call pattern this creates became
    concrete).
  - **Refresh machinery:** `refreshAlerts` generalized to
    `refreshWeatherData`, refetching all four SOUPCON-relevant sources
    (`skipCache: true`) on the same interval/visibilitychange triggers as
    before -- deliberately not staggering hourly/extended forecast to their
    own longer TTLs here, to keep this step's scope to wiring rather than a
    new tiered-refresh scheduler; those TTLs still do real work for a
    repeat lookup of the same location within the cache window. Flagging
    in case the extra request volume (4x vs. the old 1x every 5 minutes)
    is worth revisiting later.
  - **`handleShare`:** updated to the new variable names and
    `result.locationLabel` in place of `result.zone.zoneName`. Left
    otherwise untouched -- it still says "French Toast Condition" and
    still shares `frtcon.com`'s URL, which is content/domain work
    (items 4/7/8), not plumbing. Noting explicitly: this call site's
    hardcoded `frtcon.com` wasn't named in items 7/8's file lists (`index.html`,
    `manifest.json`, `robots.txt`, `sitemap.xml`, `index.md`) -- flagging it
    here so it doesn't get missed when those items land.
  - **Known, deliberate intermediate-state rough edges** (all scoped to
    later items, not oversights): the badge still literally renders the
    text "FRTCON" (hardcoded inside `FrtconBadge.jsx`, not a prop -- item
    5), `FrtconMessage` still says "French Toast Condition #N" (hardcoded
    -- item 5), the condition box's headline/title/commentary are still
    French-toast-flavored (`alertMessages.js` -- item 4), CSS classes are
    still `.frtcon-*` (item 6), and `SnowOverlay` still renders falling
    snow rather than rain (item 5). The *data* driving all of this --
    `soupcon.level`, `soupcon.title`, `soupcon.reason`, the location label
    -- is correctly SOUPCON-based as of this step; only the surrounding
    text/components haven't caught up yet.
  - **Verification:** `npm run lint`, `npm run test` (19/19), and `npm run
    build` all pass. Also smoke-tested that `npm run dev` serves the app
    without a compile/transform error (confirmed `App.jsx` and its new
    imports resolve correctly through Vite's dev server). **Not verified
    live in an actual browser** -- no browser automation tool was available
    this session (Claude in Chrome wasn't connected). This is a meaningful
    gap for a step this size (real ZIP/geolocation lookups, the parallel
    fetch, the refresh effects, and the share button are all exercised for
    the first time here) -- worth a real interactive pass before treating
    this as fully confirmed, the way earlier PLAN.md items were.

### 4. Content rewrite — ✅ FIXED

- New `src/data/soupMessages.js` (replaces `alertMessages.js`): 5 levels,
  soup/rain-themed headline + title + rotating commentary lines, same shape
  `pickRandomItems` already consumes.
- `src/data/recipe.js` → chicken noodle soup recipe (per decision above).
- Copy pass over hardcoded strings in `App.jsx` (Share button text,
  headings like "Active Zone Alerts", aria-labels mentioning FRTCON).
- **Done:**
  - **`src/data/soupMessages.js`** created with 5 levels matching the
    locked-in SOUPCON scale (currently raining / rain in 12h / rain in 48h
    / cloudy-damp / clear-sunny), each with a `#SOUPCONn CONDITION`
    headline, a short title, and 20 rotating commentary lines mirroring
    the old FRTCON copy's joke density and structure but reworked around
    rain/soup imagery (broth, stockpots, umbrellas, gutters, egg noodles)
    instead of French toast/winter imagery. Same `{headline, title, body}`
    shape as before, so `pickRandomItems`/the `App.jsx` consumption code
    needed no changes beyond the import swap.
  - **`alertMessages.js` deleted** (not just superseded) once confirmed to
    have no other consumers — `soupMessages.js` fully replaces it, unlike
    `frtcon.js` which item 1 deliberately left in place until item 5.
  - **`src/data/recipe.js`** replaced with a standard chicken noodle soup
    recipe (per decision above — rotating soup recipes are explicitly
    future work, not built here).
  - **`RecipeModal.jsx` cleanup found along the way:** the component had a
    `"Wait."`-prefix bold-emphasis special case written specifically for
    the old French toast recipe's phrasing ("Wait. You'll be tempted to
    flip too soon..."). The new recipe has no step matching that pattern,
    making the regex dead weight rather than a latent feature, so it was
    removed in favor of plain step rendering — a direct consequence of
    this item's content swap, not a tangential refactor, so handled here
    rather than deferred to item 5 (which only expected recipe *title*
    text to change, not this).
  - **Copy pass in `App.jsx`:** `<h1>` ("What's my Soup Condition?"), the
    subtitle ("Check the rain outlook for your area and see your current
    Soup Condition."), the dropdown menu item ("Soup Recipe"), the share
    text's "Soup Condition #N" line, and both "copy your ... status"
    toast messages (now "SOUPCON status"). Confirmed via grep that no
    `FRTCON`/`French Toast` text remains anywhere in `App.jsx` -- what's
    left there (`frtcon_*` localStorage keys, `.frtcon-*` CSS classes,
    `frtcon.com`'s share URL) is exactly and only the items 6/7/8/9
    territory called out in earlier Done notes.
  - `npm run lint`, `npm run test` (19/19), and `npm run build` all pass.
  - **Not verified live in a browser** (same gap as item 3 — Claude in
    Chrome isn't connected this session): the recipe modal's rendering and
    print view, and the on-screen condition box's new copy, haven't been
    visually confirmed, only reviewed as code/JSX.

### 5. Component/file renames — ✅ FIXED

- `src/lib/frtcon.js` → `src/lib/soupcon.js` (already done in item 1).
- `FrtconBadge.jsx` → `SoupconBadge.jsx`, `FrtconMessage.jsx` →
  `SoupconMessage.jsx` — mechanical renames + prop names.
- `RecipeModal.jsx` — title text, no structural change expected.
- Resolve `SnowOverlay.jsx`'s fate (open question above) and
  `AlertCard.jsx`'s fate (tied to item 3's decision).
- **Done:**
  - **`frtcon.js` deleted.** Confirmed zero remaining importers (item 3
    already stopped using it); `soupcon.js`'s own comment about the
    copied-not-imported `pickRandomItems` updated to reflect that it's now
    the only copy, not "still shared until item 5."
  - **`FrtconBadge.jsx` → `SoupconBadge.jsx`**, **`FrtconMessage.jsx` →
    `SoupconMessage.jsx`**: renamed exports, hardcoded label text fixed
    ("FRTCON N" → "SOUPCON N"; "French Toast Condition #N" → "Soup
    Condition #N"), and the `zoneName` prop renamed to `locationLabel` to
    match what `App.jsx` actually passes (a mismatch left over from item
    3's data plumbing, cleaned up now that this is the component-renames
    step). `SoupconMessage`'s footnote -- which specifically referenced
    "the French Toast Alert System" (a real thing FRTCON was parodying) --
    was rewritten rather than find-replaced, since that sentence describes
    a completely different concept for SOUPCON: now reads "* #SOUPCON only
    estimates whether rain is likely to disrupt your day where you live.
    It does not measure total rainfall, storm severity, or anything
    outside this 5-level rain-likelihood scale." CSS class names on both
    (`.frtcon-badge`, `.frtcon-condition-status`, etc.) deliberately left
    untouched -- that's item 6, not this one.
  - **`SnowOverlay.jsx` → `RainOverlay.jsx`** (resolves the open question):
    falling snowflake glyphs replaced with falling rain-streak `<span>`s
    (thin gradient lines, faster/straighter fall, no horizontal drift --
    rain doesn't sway side-to-side the way snow does). `.snow-overlay` →
    `.rain-overlay` and `@keyframes snowFall` → `@keyframes rainFall` in
    `styles.css` (a required part of this rename, not deferred to item 6,
    since the old class/keyframe would otherwise be orphaned dead CSS the
    moment the component using them was renamed).
    - **Density mapping also revisited, not just the visual:** FRTCON
      showed snow at every level, even level 5 ("all clear"), as a
      year-round mascot effect independent of severity. For SOUPCON,
      showing rain falling on screen when the score explicitly says "no
      rain expected" (levels 4/5) would contradict the app's own message,
      so those two levels now show zero rain rather than reusing FRTCON's
      old "always show at least a little something" floor of 8. Levels
      1-3 keep a declining-but-nonzero mapping (140/90/40) reflecting
      decreasing rain urgency. Renamed `snowCount` → `rainCount`
      accordingly.
  - **`AlertCard.jsx`:** no changes -- already resolved in item 3 (kept,
    decoupled from the score), and it has no FRTCON-specific naming to
    rename in the first place.
  - **`RecipeModal.jsx`:** no further changes needed here specifically (its
    `"Wait."` special-case cleanup already happened in item 4, as a direct
    consequence of the recipe content swap); title text already flows
    through `RECIPE.title` automatically.
  - Confirmed via repo-wide grep: no remaining `FrtconBadge`/
    `FrtconMessage`/`SnowOverlay`/`snowCount`/`lib/frtcon` references
    anywhere. Remaining `FRTCON`/`French Toast` hits are all in code
    comments (historical "unlike FRTCON..." explanations, fine to keep
    indefinitely) or in `styles.css` comments describing still-`.frtcon-*`
    -named CSS (item 6) -- nothing user-facing left unaddressed.
  - `npm run lint`, `npm run test` (19/19), and `npm run build` all pass.
  - **Not verified live in a browser** (same gap as items 3/4 -- Claude in
    Chrome still isn't connected this session): the rain visual itself
    (density, speed, whether it reads as rain rather than noise) is
    reviewed as code/CSS only, not seen rendered.

### 6. CSS renames — `src/styles.css` — ✅ FIXED

- `.frtcon-*` → `.soupcon-*` classes (`.frtcon-badge--level-N`,
  `.frtcon-condition-status`, `.frtcon-status-row`, `.frtcon-updated-at`,
  `.frtcon-matching-alerts*`, `.frtcon-title-large`, etc.).
- Verify visually in both light/dark and at phone width after, same as
  `PLAN.md` #9's verification approach.
- **Done:**
  - Every `.frtcon-*` class/id in `src/` (styles.css and the JSX that
    references them: `App.jsx`, `SoupconBadge.jsx`, `SoupconMessage.jsx`,
    `RecipeModal.jsx`) renamed to `.soupcon-*`, including the
    `frtcon-zip-input` DOM id (label/input pair) alongside the class
    renames, since it's the same category of internal branding-prefixed
    identifier even though it's technically an id, not a class.
  - **`.frtcon-matching-alerts`/`.frtcon-matching-alerts-title` deleted
    outright, not renamed** — exactly the dead CSS the plan's own example
    list flagged (`.frtcon-matching-alerts*`), confirmed via grep to have
    zero remaining JSX consumers since item 3 removed the "Winter alerts
    driving the score" block. CSS bundle shrank slightly (7.42 kB → 7.33
    kB) consistent with real dead-rule removal, not just a rename.
  - Section-header comments in `styles.css` that named "FRTCON" (e.g. "The
    beige/amber box containing the FRTCON headline...") updated to
    "SOUPCON" alongside the class renames in the same section.
  - Repo-wide grep confirms zero remaining `frtcon-` (hyphenated) hits
    anywhere in `src/`; all `frtcon` hits left are the already-known,
    already-deferred ones: `frtcon_last_*`/`frtcon_*_lookup_`/etc.
    (underscore-separated storage keys, item 9) and `frtcon.com` (domain,
    items 7/8).
  - **New scope item found while checking, not yet acted on:** `public/sw.js`
    has its own independent set of `frtcon-`/`frtcon_`-prefixed identifiers
    — DOM ids `frtcon-reconnect-text`/`frtcon-reconnect-retry` and a
    `frtcon_reconnect_attempts` sessionStorage key used by the offline
    "Reconnecting…" fallback page (see `CONTEXT.md`'s SW notes) — plus
    `src/main.jsx` clears that same sessionStorage key on a successful
    load. None of this is `src/styles.css` or JSX class names, so it's out
    of this item's scope, and it wasn't explicitly named in items 7/8/9's
    file lists either. Flagging here (as with the Share-button URL gap
    found in item 3) so it isn't missed when those items land — likely
    belongs with item 9 (storage/id key renames) rather than 7/8 (which
    are about domain references specifically), but worth double-checking
    then.
  - `npm run lint`, `npm run test` (19/19), and `npm run build` all pass.
  - **Not verified live in a browser** (same recurring gap — Claude in
    Chrome still isn't connected this session): light/dark mode, phone
    width, both modals, and the recipe print preview are all unverified
    visually; a class-name-only rename (no selector structure or property
    changes) is low-risk, but this is exactly the kind of change
    `PLAN.md`'s own #9 treated as warranting a real before/after visual
    pass, not just a successful build.

### 7. Branding/meta pass — ✅ FIXED

- `package.json` `name` (`frtcon_weather_alert_app` → something like
  `soupcon_weather_app`).
- `index.html`: `<title>`, meta description, OG tags, `og:image`/`og:url`
  domain refs → soupcon.org.
- `public/manifest.json`: `name`, `short_name`, `description`.
- Icons/favicon: current artwork (snowflake-on-blue) doesn't fit — needs new
  icon assets (192/512/512-maskable + favicon). Flag to the user rather
  than inventing brand artwork unilaterally.
- `theme-color`/`background_color` — pick together with the visual palette
  open question above.
- **Done:**
  - **Icons (asked, per decision above):** user specified the design
    directly — "a simple two tone bowl (oval on top of an upwards facing
    semicircle) in dark and light purple under some blue raindrops, all on
    a lavender background." First pass: hand-authored SVG (a full circle
    with its top half erased by a same-color rect, leaving a semicircle
    "bowl body"; an ellipse "rim"; three bezier teardrop raindrops above),
    rasterized via `rsvg-convert`/ImageMagick into all required sizes.
    User feedback on that pass: "weren't bold enough." **Regenerated from
    a user-provided master** (`/tmp/favicon.svg`, edited in Inkscape from
    the first pass) with a larger bowl/rim (1.667x) and larger raindrops
    (2.5x), more saturated colors (`#a28ead` bg, `#9042ad` bowl,
    `#602c74` rim, `#5b8def` drops unchanged), and content shifted upward
    for better balance. From that single master:
    - `favicon.svg`/`icon-192.png`/`icon-512.png` — the master as-is
      (already rounded-square clipped).
    - `apple-touch-icon.png` — same design with the rounded-square
      `clip-path` stripped (full-bleed square, no transparency, matching
      Apple's own convention of applying its own corner rounding).
    - `icon-512-maskable.png` — full-bleed square with the bowl/drops
      group scaled 0.85 and centered. Checked the math (not just eyeballed
      this time): the bold master's furthest extremes (bowl bottom tip,
      top raindrop tip) sit right at ~210px from center against a ~205px
      safe radius for an 80%-safe-zone circular mask -- i.e. the fully
      bold version was *just* outside safe for a strict circular crop, so
      the maskable variant specifically gets a modest 0.85 scale-down
      (much less conservative than the first pass's 0.72) rather than
      reusing the bold version unscaled or over-shrinking it again.
    - `favicon.ico` — multi-res 16/32/48 from the same master.
    Checked all sizes visually (512/192/64px) before finalizing --
    reads as bold and legible even at favicon size.
  - **Color palette (asked, "switch to a new rain-coded palette"):**
    proposed and applied keeping the *blue* accent family (buttons,
    status-box border/text, alert chips) unchanged -- it ties directly to
    the icon's raindrops, so "purple shell + blue rain accents" mirrors
    the icon exactly rather than going all-purple. Converted only the
    navy "chrome" colors (page/card/modal backgrounds, borders, dropdown
    background, input background, dark-text-on-light-button) to a purple
    equivalent at matching lightness, e.g. `#0b1f3a`→`#1a0f2e` (darkest
    bg), `#122b4d`→`#2d1b4a` (card bg), `#27466f`→`#4a3270` (border) --
    full mapping across `src/styles.css`, `index.html`'s theme-color,
    `manifest.json`'s theme/background colors, and `public/sw.js`'s
    fallback page (same app, needed the same palette). Deliberately left
    unchanged: the Facebook-brand blue share button, the red error box,
    the amber condition-status callout box, and the five severity-scale
    badge colors -- none of those are "the app's chrome," they're
    semantic/brand colors independent of the SOUPCON hue.
  - `package.json` name, `index.html` title/description/OG tags (text,
    separate from the theme-color/palette work above), and
    `manifest.json` name/short_name/description all updated to SOUPCON
    copy and the soupcon.org domain.
  - `npm run lint`, `npm run test` (22/22), and `npm run build` all pass;
    confirmed the new icons land in `dist/` and `manifest.json`/
    `package.json` are still valid JSON.
  - **Not verified live in a browser:** the icons/palette are reviewed as
    rendered PNGs (via the icon-generation step itself) and code, but the
    actual running app's look -- installed PWA icon, theme-color browser
    chrome tinting, overall in-app color harmony -- hasn't been seen
    live, same recurring gap as items 3-6.

### 8. Domain/crawler files — ✅ FIXED

- `public/robots.txt`, `public/sitemap.xml`, `public/index.md`: `frtcon.com`
  → `soupcon.org` URLs.
- `.htaccess` (if any domain-specific values are in it — check when this
  step is reached).
- **Done:**
  - `robots.txt`'s `Sitemap:` line and `sitemap.xml`'s `<loc>` both updated
    to `soupcon.org`.
  - `.htaccess` checked — no domain-specific values in it at all (just
    relative rewrite rules and headers), so no change needed.
  - `index.md` fully rewritten, not just domain-swapped -- it's a markdown
    mirror of the app's own description (served for `Accept: text/markdown`
    requests), so leaving FRTCON-era wording there while everything else
    changed would be a glaring, publicly-visible inconsistency. Now
    describes the SOUPCON scale and its actual data sources (hourly
    forecast, extended forecast, current observations -- not "active
    alerts").
  - **Also fixed while here, found as a gap in item 6's done note:** the
    Share button's Facebook `sharer.php?u=` URL and its surrounding
    comments in `App.jsx` (`handleShare`) still said `frtcon.com` -- not
    explicitly named in this item's file list, but clearly domain-scope
    work, so folded in now rather than left for later.
  - `npm run lint`, `npm run test` (22/22), and `npm run build` all pass.

### 9. localStorage key prefixes — `src/lib/cache.js` — ✅ FIXED

- `frtcon_zip_lookup_` / `frtcon_zone_lookup_` / `frtcon_alerts_` →
  `soupcon_*` equivalents, plus new prefixes for hourly/observation/extended
  caches from item 2. `frtcon_last_source` / `frtcon_last_zip` → `soupcon_*`.
- No migration shim needed — `soupcon.org` is a different origin, so old
  `frtcon_*` keys never exist there in the first place.
- **Done:**
  - All seven prefixes in `cache.js` renamed
    (`ZIP_CACHE_PREFIX`/`ZONE_CACHE_PREFIX`/`ALERTS_CACHE_PREFIX`/
    `GRIDPOINT_CACHE_PREFIX`/`HOURLY_FORECAST_CACHE_PREFIX`/
    `EXTENDED_FORECAST_CACHE_PREFIX`/`OBSERVATION_CACHE_PREFIX`), plus the
    stale comments explaining the temporary `frtcon_`-namespacing (no
    longer applicable) cleaned up.
  - `App.jsx`'s `soupcon_last_source`/`soupcon_last_zip` (both read and
    write call sites, plus a comment) renamed from `frtcon_last_*`.
  - **Also handled the gap found in item 6's done note**, since it belongs
    here: `src/main.jsx`'s `sessionStorage.removeItem(...)` call and
    `public/sw.js`'s own `STORAGE_KEY` constant, both now
    `soupcon_reconnect_attempts` (they share the same key across two
    files, so both needed updating together, not just one). Also renamed
    `sw.js`'s `frtcon-reconnect-text`/`frtcon-reconnect-retry` DOM ids
    (not strictly a storage key, but the same category of internal
    branding-prefixed identifier, found in the same file) and fixed its
    hardcoded `<title>Soup Conditions</title>` and "Can't reach SOUPCON
    right now" fallback-page text, plus a top-of-file comment describing
    what the app shows.
  - No migration code added, per the plan's own reasoning -- confirmed
    still applicable: `soupcon.org` is a new origin, so no `frtcon_*` keys
    exist there to migrate from.
  - Repo-wide grep confirms zero remaining `frtcon`/`FRTCON`/`French Toast`
    hits anywhere in `src/`, `public/`, `index.html`, or `package.json`
    except historical code comments explaining past decisions (e.g.
    "Unlike FRTCON...", "FRTCON-era getZoneByPoint name") -- all
    intentionally kept, matching this project's own established comment
    style.
  - `npm run lint`, `npm run test` (22/22), and `npm run build` all pass.
  - **Not verified live in a browser:** the reconnect-fallback page (only
    reachable via a real navigation failure) and the ZIP/source
    auto-resume behavior are reviewed as code only -- same recurring gap
    as items 3-7.

### 10. Docs rewrite — `README.md` and `CONTEXT.md` — ✅ FIXED

- Full rewrite once the app itself reflects the new concept (do this after
  items 1–9, not before, so it documents what's actually true): what it
  does, the SOUPCON scale table, the three-endpoint data source rationale,
  project structure, deployment notes.
- `CONTEXT.md`'s infra section gets soupcon.org's real infra facts once
  item 12 is done.
- Old `PLAN.md`'s still-open item (#11, classification tests) becomes moot
  once `frtcon.js` is replaced — note in `PLAN.md` that it's superseded by
  this plan rather than leaving it looking abandoned. Decide then whether
  `PLAN.md` itself gets archived/retired for this fork.
- **Done:**
  - **`README.md`** fully rewritten: SOUPCON scale table, the
    forecast/observation classification rationale (with its own caveat
    about keyword-matching free-text `shortForecast`, mirroring how the
    old README caveated `event`-matching), updated project structure
    (`soupcon.js`/`soupcon.test.js`, `soupMessages.js`, `RainOverlay`/
    `SoupconBadge`/`SoupconMessage`), `npm run test` added to "Getting
    started," the new `#1a0f2e` theme-color in the PWA `<head>` snippet,
    "APIs used" reworded to explain alerts are now independent of the
    score, a new limitations bullet about keyword-matching coverage, and
    "Ideas for later" updated (rotating soup recipes added; the affiliate
    idea reworded from winter-gear/French-toast groceries to
    soup-ingredients/rainy-day gear).
  - **`CONTEXT.md`** fully rewritten: new "What this project is" explains
    the fork relationship to frtcon.com explicitly (untouched, separate
    site) and points to `SOUP_PLAN.md`'s own "Decisions locked in"/Done
    notes the same way this file's own Done notes matter. Infrastructure
    section deliberately **not** filled in with invented soupcon.org
    specifics — replaced with a "not yet set up, here's the planned shape"
    note per the plan's own instruction, explicitly warning not to assume
    frtcon.com's specific facts (tunnel ID, vhost path, cert SANs) apply
    here. Frontend architecture section rewritten around the real new
    decisions: the forecast/observation-vs-alerts classification choice,
    station-staleness handling, the gridpoint in-flight de-dup, the
    location-label change, the decoupled alerts panel, and the icon/
    palette decisions (new subsection, since those were real
    owner-directed decisions worth recording the same way the old Share
    button decisions were). Gotchas/decided-against/shelved sections
    carried over with FRTCON-specific wording fixed (e.g. the cloudflared
    zone-scoping gotcha now explicitly flags it as relevant to this
    fork's own upcoming item-12 work) and one new shelved item added
    (rotating soup recipes, cross-referenced to item 4's decision).
  - **`PLAN.md`**: added a banner note at the top marking the whole
    document superseded/historical (kept, not deleted or rewritten in
    place, since its own Done notes are still an accurate record of real
    FRTCON-era decisions) and specifically annotated item #11 (classification
    tests) as superseded by `soupcon.test.js` rather than left looking
    like an abandoned open item.
  - **`CLAUDE.md` updated too** (not explicitly named in this item, but a
    real gap found while doing this work): its session-bootstrap list
    only mentioned `PLAN.md`, with no pointer to `SOUP_PLAN.md` at all --
    a new session could easily have missed this plan entirely. Reworded
    the `PLAN.md` bullet to reflect its now-historical status and added a
    fourth bullet for `SOUP_PLAN.md`, plus updated "Keeping these in sync"
    to reference `SOUP_PLAN.md` as the doc that gets new Done notes going
    forward.
  - Verified every file path named in the new README/CONTEXT actually
    exists (`soupcon.js`, `soupcon.test.js`, `soupMessages.js`,
    `RainOverlay.jsx`, `SoupconBadge.jsx`, `SoupconMessage.jsx`, etc.) and
    that no unintentional `frtcon.com`/FRTCON references remain (the ones
    that do remain in `CONTEXT.md` are deliberate: describing the sibling
    site's lineage and shared infra history). `npm run lint`, `npm run
    test` (22/22), and `npm run build` all still pass (docs-only change,
    but verified anyway per this project's own norms).

### 11. Tests — `vitest` — ✅ FIXED

- Add as dev dependency with a `test` script (same ask as old `PLAN.md`
  #11, but done this time as part of the rewrite instead of shelved).
- Cover `soupcon.js`: each level's representative forecast/observation
  shapes, the 12h-vs-48h boundary, day/night wording variants, and
  `pickRandomItems` (already covered, carries over unchanged).
- **Done:** `vitest` + the `test` script, and most of this coverage, were
  already added in item 1 (19 tests: each level, the 12h/48h boundary, the
  no-observation level-1 fallback, the 4-vs-5 extended-period window
  boundary, `pickRandomItems`). The one thing item 1 didn't yet have —
  **day/night wording variants** — added here as a new `describe` block in
  `src/lib/soupcon.test.js`:
  - Confirms daytime "Sunny"/"Mostly Sunny" and nighttime "Clear"/"Mostly
    Clear" both land on level 5, and "Partly Cloudy"/"Mostly Cloudy" both
    land on level 4 — i.e. the classifier doesn't only recognize daytime
    phrasing.
  - Also locks in the exact real `shortForecast` strings pulled from live
    `api.weather.gov` data during item 2's verification (including NWS's
    combined "X then Y" multi-condition phrasing,
    e.g. "Showers And Thunderstorms Likely then Chance Showers And
    Thunderstorms") as permanent regression tests, rather than leaving
    that verification as a one-off manual check that could silently
    regress later.
  - 22/22 tests passing; `npm run lint` and `npm run build` still pass.

### 12. Infra — soupcon.org — ✅ FIXED (done by the owner directly)

- Confirm domain registration (open question above).
- Cloudflare: new DNS zone for `soupcon.org`, nameservers pointed at
  Cloudflare, new ingress rule in the existing Tunnel's `config.yml` routing
  `soupcon.org`/`www.soupcon.org` to Apache — same tunnel, additional
  hostnames, not a new tunnel.
- Apache: new vhost `/etc/apache2/sites-available/soupcon.conf`, confirm
  which server/user it's served from (this repo already lives under
  `/home/soupcon/`, mirroring frtcon's `/home/frtcon/public_html` pattern —
  confirm that's the intended origin host before assuming it's the same
  physical server as `elephant`). Include a `dev` subpath mirroring
  frtcon.com's review-before-promote setup.
- TLS: certbot + `certbot-dns-cloudflare`, a cert covering `soupcon.org` +
  `www.soupcon.org` — a **separate** cert from frtcon.com's (unrelated
  site), not an `--expand` of the existing one.
- File permissions: world-readable (644), correct owner — this already bit
  FRTCON's PWA install flow once (see `CONTEXT.md` gotchas); check it
  explicitly during this step rather than after something silently fails.
- **Done:** set up directly by the owner (not Claude) — same Tunnel
  (`dd742d1d-...`), new ingress rule routing `soupcon.org`/
  `www.soupcon.org`/`soupcon.thoughtleap.com` to a new loopback port
  (`127.0.0.1:8082`), new vhost at `soupcon.conf` serving from
  `/home/soupcon/soupcon.org/` with a `dev/` subdirectory.
  - **Deviated from this item's own assumption, correctly:** no certbot
    cert was set up, and none is needed — the actual ingress rule (checked
    directly, for both soupcon.org and frtcon.com) speaks plain HTTP to
    the origin on all three loopback ports, not HTTPS-to-`:443` as this
    item and `CONTEXT.md`'s pre-rebuild wording assumed. Since nothing is
    publicly exposed except through the Tunnel, and Cloudflare's edge
    terminates the real browser-facing TLS regardless, an origin cert
    would add maintenance for no security benefit here. `CONTEXT.md`
    rewritten to reflect this (and to correct its own earlier assumption
    about frtcon.com's setup, which turned out to describe a config that
    doesn't match the real `config.yml`).
  - Verified live end-to-end (not just config review): `soupcon.org`,
    `www.soupcon.org`, and `soupcon.org/dev/` all return real `200`s
    through Cloudflare; file permissions checked recursively, all
    correctly world-readable; title/theme-color/content on the live site
    match the current build.
  - **Found and fixed along the way:** `mod_headers` wasn't enabled on
    this origin's Apache, silently dropping the `Link` discovery headers
    (`.htaccess`'s own `<IfModule>` guard degraded gracefully rather than
    erroring, exactly as designed, just not as *wanted* here) — this
    turned out to be a **pre-existing gap affecting frtcon.com
    identically**, not something this rollout introduced. Fixed with
    `a2enmod headers` + reload (done by the owner); confirmed both sites
    now send the header correctly.
  - **Found, not yet resolved:** Cloudflare's "Managed robots.txt" is
    active on this zone and prepends its own content ahead of this app's
    own `robots.txt`, likely shadowing the explicit `ai-input=yes` stance
    — see `CONTEXT.md`'s Agent readiness/Infrastructure sections. Left
    as-is pending a decision on whether that matters enough to disable it
    for this zone.

### 13. Cutover/launch checklist — ✅ FIXED (done by the owner directly)

- Build, deploy to the `dev` path first, verify there (remembering
  `CONTEXT.md`'s note that PWA/install behavior can't be meaningfully
  tested from `/dev/`, only from the promoted root).
- Promote to `soupcon.org` root, confirm PWA install flow, confirm
  robots.txt/sitemap.xml are being served and match the agent-readiness
  setup FRTCON already did.
- **Done:** live at both the `dev/` path and the promoted root, confirmed
  via direct HTTP checks against the real site (see item 12's Done note).
  robots.txt/sitemap.xml are served, though robots.txt's content is
  currently modified in-flight by Cloudflare's managed robots.txt feature
  (see above) — not a deployment bug, a platform-level behavior to
  separately decide on. **Not yet verified:** the actual PWA install flow
  (Chrome's `beforeinstallprompt` eligibility, home-screen icon, standalone
  launch) — everything checked so far has been HTTP-level (`curl`), not a
  real browser/device install, which is the one thing this app's own
  `CONTEXT.md` says can only be meaningfully tested from the promoted root,
  not `/dev/` — worth doing before calling this fully launched.

### 14. Rain-vs-snow classification and animation — ✅ FIXED

Raised as a question after the plan's original 13 items were all done: "what
happens if it snows instead of rains? should we be marking all
precipitation events the same?"

- **Bug found while investigating, not just a design gap:** tested directly
  against the real `classifySoupcon` and confirmed a plain `"Snow"`
  forecast/observation with no reported `probabilityOfPrecipitation`
  matched none of the existing rain/cloudy/clear keyword lists and fell
  through to SOUPCON5 "Clear and sunny" — the worst possible wrong answer,
  while it was actively snowing in the test data. `"Snow Showers"` was
  separately (also wrongly) swallowed into the rain bucket via the
  "showers" substring. Neither was a "we haven't gotten to this yet" gap;
  both were live, silent misclassifications.
- **Decision (per user):** word rain and snow separately, and swap in a
  snow-falling animation when snow is the primary forecast type, rather
  than either (a) treating all precipitation identically with one generic
  wording/animation, or (b) leaving snow unhandled/out of scope.
- **Scope check (asked, since it materially changed the size of this
  work):** the big rotating commentary box (`soupMessages.js`) has a lot of
  rain-specific imagery (umbrellas, puddles, storm drains) that reads
  oddly during snow. Asked whether that also needed a parallel
  snow-flavored set (~60 new lines) or should stay generic for now.
  **Answer: stay generic for now** — only `classifySoupcon`'s short
  title/reason text and the animation are type-aware; the commentary box
  is an accepted, documented gap, not an oversight.
- **Done:**
  - `src/lib/soupcon.js`: added `SNOW_KEYWORDS` (snow, sleet, blizzard,
    flurries, wintry mix), checked *before* `RAIN_KEYWORDS` so ambiguous
    phrases ("Snow Showers," "Rain and Snow") resolve to snow rather than
    being swallowed by a rain substring match. "Freezing Rain" stays rain
    (visually falls as rain, freezes on contact). Replaced the old
    boolean `periodIndicatesRain`/`observationIndicatesRain` with
    type-returning `periodPrecipType`/`observationPrecipType`
    (`"rain"`/`"snow"`/`null`); the numeric-probability fallback (no type
    info of its own) defaults to `"rain"` as the far more common case.
    `classifySoupcon`'s result now carries `precipType` (set for levels
    1-3, `null` for 4/5) alongside type-specific `title`/`reason` text via
    a small `PRECIP_WORDING` lookup table — the numeric level and its
    ordering/priority logic are unchanged, only the type-detection and
    wording layer is new.
  - `src/lib/soupcon.test.js`: renamed tests to match the new function
    names, added snow-specific coverage for all three levels, the
    ambiguous-phrase priority rule, the "Freezing Rain stays rain" rule,
    and a dedicated regression test reproducing the exact bug found above
    (bare "Snow," no probability, no longer falls through to level 5).
    30/30 passing (up from 22).
  - **Snow animation:** new `src/components/SnowOverlay.jsx` (a
    reintroduced version of FRTCON's original falling-snowflake effect —
    ❄ glyphs with a horizontal-drift `@keyframes snowDrift`), alongside the
    existing `RainOverlay.jsx` (straight-falling rain streaks, unchanged).
    `App.jsx` picks whichever component renders based on
    `soupcon?.precipType === "snow"`, defaulting to rain otherwise (levels
    4/5 render zero of either way, per the existing density mapping,
    unchanged from before). The shared positional container class was
    generalized from `.rain-overlay` to `.precip-overlay` (pure layout,
    no type-specific styling) so both components reuse one CSS rule.
  - **Docs:** `README.md` (scale explanation now covers the rain/snow
    split and the "commentary stays generic" caveat, project structure
    lists `SnowOverlay.jsx`, a new limitations bullet), `CONTEXT.md` (new
    architecture bullet on the rain-vs-snow design, and a new "Known
    gotchas" entry documenting the silent-misclassification bug as a
    general lesson about keyword-classifier fallback behavior, not just a
    changelog note).
  - `npm run lint`, `npm run test` (30/30), and `npm run build` all pass.
  - **Not verified live in a browser:** same recurring gap as most of this
    rebuild — the snow animation itself (does it read as snow, is the
    drift/density right) has been reviewed as code only, not seen
    rendered.

### 15. FRTCON.com cross-promo pill on snow — ✅ FIXED

- **Ask (per user):** "When snow is predicted, we should send them to
  FRTCON.com. Lets add a pill next to the facebook share. 'Snow soon,
  check your FRTCON!'"
- **Done:** a new `<a>` pill in `App.jsx`'s `.soupcon-status-row` (next to
  the Facebook Share button, as asked), shown only when
  `soupcon.precipType === "snow"` (i.e. any of the three snow-triggering
  levels — currently snowing, snow in 12h, or snow in 48h — not just
  "currently snowing"). Links to `https://frtcon.com` with
  `target="_blank" rel="noopener noreferrer"`, matching the safety pattern
  already used for the Facebook share's own `window.open` call. Styled as
  a pill (`.snow-crosslink-pill` in `styles.css`) reusing the app's
  existing blue accent color (`#60a5fa`/`#1a0f2e`, the same pairing
  `.btn-primary` already uses) rather than introducing a new color, and
  added to the same shared height/font-size selector group the badge/
  alert-tag/share-button already share so it sits level with them on the
  row. The row's existing `flex-wrap: wrap` handles this longer pill
  gracefully on narrow widths (wraps to its own line rather than
  overflowing or squeezing its siblings).
  - `README.md`'s feature list updated with a one-line mention.
  - `npm run lint`, `npm run test` (30/30, unchanged -- this is
    presentation-only, no classification logic changed), and `npm run
    build` all pass.
  - **Not verified live in a browser:** same recurring caveat.

### 16. Post-launch bug review — ✅ FIXED

- **Ask (per user):** "deep dive and analyze and make sure there are no
  bugs in the new implementation." Reviewed `soupcon.js`, `weatherApi.js`,
  `cache.js`, `App.jsx`, components, and `sw.js`, and probed live
  `api.weather.gov` (7 cities at once: hourly period timing, day/night
  sky wording, the 5 nearest stations' latest observations).
- **Done (clear-cut bugs, fixed):**
  - **Ended forecast periods counted as current.** Live NWS
    `forecast/hourly` responses led with an already-ended hour in 3 of 7
    cities (e.g. Minneapolis at 14:29 CDT led with 13:00–14:00). That made
    the level-1 hourly fallback read a past hour as "right now" and cut
    the 12h/48h windows short by an hour. `classifySoupcon` now drops
    periods whose `endTime` has passed (hourly and extended), with an
    injectable `now`; 3 new tests (33/33 passing).
  - **Blank observations read as "not raining."** Several stations,
    including Chicago's *nearest* station (KMDW), posted fresh
    observations with an empty `textDescription` and no
    `precipitationLastHour`. `findFreshObservation` accepted them, which
    both read as "definitely dry" and, being non-null, suppressed the
    hourly fallback. It now also requires a non-blank description or a
    numeric precip reading. Verified live: Chicago now skips KMDW and uses
    KORD's real reading.
  - `npm run lint`, `npm run test` (33/33), `npm run build` all pass.
- **Done (follow-up, owner-decided — "fix 3-6, include in-vicinity
  readings as local enough to count"):** these touch the locked-in
  keyword lists, so were raised as questions first rather than changed
  unilaterally.
  - **Partly Cloudy vs. Partly Sunny day/night asymmetry.** Live data
    (7 cities, all hourly periods) showed "Partly Sunny" only ever in
    daytime periods and "Partly Cloudy" only at night — the same sky
    cover, but "Partly Cloudy" matched `cloudy` (level 4) while "Partly
    Sunny" didn't (level 5). Since the near-term window always includes
    nights, fair outlooks kept dropping to 4. Now `NOT_CLOUDY_PHRASES`
    strips "partly cloudy" before the cloudy check, so both are level 5;
    Mostly Cloudy/Cloudy/Overcast/fog/etc. are still level 4, and
    "Partly Cloudy then Mostly Cloudy" still reads as cloudy. The old test
    that locked in "Partly Cloudy → 4" was replaced.
  - **"Slight Chance" read as "It's raining right now."** The level-1
    hourly fallback (no usable observation) now uses
    `currentPeriodPrecipType`: requires ≥40% probability, or — when NWS
    reports none — precip wording without "chance." Levels 2/3 are
    unchanged (any precip wording still counts there).
  - **Level 5 with rain in the extended forecast.** Precip in any of the
    next 4 extended periods now means level 4, closing the gap where rain
    past the 48 hourly periods, worded with no cloudy keyword ("Rain
    Showers," seen live), fell through to "clear and sunny."
  - **"In Vicinity" station readings:** kept counting as level 1, per
    owner ("local enough to count") — no logic change; documented in a
    comment and locked in with a test.
  - 6 net new tests (39/39). Lint and build pass. Also ran the real
    classifier against live NWS data for 7 cities; all results were
    sensible (e.g. Chicago's Mostly Sunny/Partly Cloudy outlook is now
    level 5, previously 4).
- **Done (second follow-up, per owner — "fix all four"):** the
  lower-severity findings from the same review.
  - **Sequential station lookups.** `findFreshObservation` walked up to 5
    stations one at a time, each with its own 10s timeout, inside the
    lookup's `Promise.all` — a slow NWS could hold "Looking up..." for
    ~a minute. Now fetched in parallel (worst case one timeout); the
    nearest *usable* station still wins, picked by station order rather
    than arrival order. Live timings across 7 cities: 145–1477 ms per
    full lookup.
  - **Aborted in-flight `/points` request reused.** `getGridpointInfo`'s
    de-dup map now stores each request's signal and never joins one
    that's already aborted (a new lookup starts its own); cleanup only
    deletes its own entry so it can't evict a newer replacement.
  - **Empty hourly forecast → "Clear and sunny."** `getHourlyForecast`
    now throws a user-facing "didn't return a forecast" error (not
    cached) instead of returning `[]`. Background refreshes that hit it
    keep the last good data, like any other refresh failure.
  - **"Ice Pellets"/"Hail" unrecognized.** Added `ice pellets` to
    `SNOW_KEYWORDS` (stations' wording for sleet) and `hail` to
    `RAIN_KEYWORDS`.
  - New `src/lib/weatherApi.test.js` (5 tests, `fetch` stubbed); the 3
    covering new behavior were confirmed to **fail against the
    pre-change `weatherApi.js`** and pass after, the other 2 guard
    behavior that shouldn't change (de-dup still collapses concurrent
    live requests; nearest usable station wins). Plus a keyword test in
    `soupcon.test.js`. 45/45 passing; lint and build pass; live 7-city
    classifier run unchanged.
- **Not verified live in a browser** — logic changes only, verified via
  tests and live-API runs of the classifier.

### 17. Observation station radius + snow pill wording — ✅ FIXED

- **Ask (per user), following item 16's review:** "why do we need 5
  stations? Can we do a haversine and only include stations that are
  within 60 miles (but use a minimum of 2 stations regardless). Also fix
  the 'snow soon' wording." Also confirmed: the 90-minute observation
  age limit is fine as-is.
- **Why 5 (answered):** an arbitrary cap from item 2, there because the
  nearest station is often stale or blank. Kept as an upper bound rather
  than dropped: with the stations fetched in parallel (item 16), an
  uncapped 60-mile radius would mean dozens of requests per lookup and
  per 5-minute refresh in dense areas (live counts within 60 miles:
  Seattle 41, Minneapolis 22, Chicago 14).
- **Done:**
  - New exported `haversineMiles` and `selectObservationStations` in
    `weatherApi.js`: sorts NWS's station list by computed distance (it
    isn't strictly sorted — confirmed live for Seattle, Minneapolis,
    Chicago), takes everything within 60 miles, at least the nearest 2
    regardless of distance, at most 5. Stations with no coordinates sort
    last and can only fill the minimum.
  - Verified live: Seattle/Chicago → 5 stations within 24 miles; Ely, NV
    → its one in-range station plus one at 64 mi; Big Bend, TX → 26 mi +
    72 mi; Jordan, MT → 5 within 53 mi, none with a usable reading, so it
    correctly fell back to the hourly forecast.
  - **Snow pill wording:** reads "Snow! Check FRTCON!" at level 1
    (already snowing; wording chosen by owner); "Snow soon, check your FRTCON!" is kept for
    levels 2/3.
  - 6 new tests (selection rules + haversine sanity check); existing
    station tests given coordinates. 51/51 passing; lint and build pass.
  - **Not verified live in a browser** (the pill wording change is JSX
    only).
- **Browser verification (first real one this rebuild):** Claude in
  Chrome wasn't available, so a standalone headless Chrome (downloaded to
  scratch space, driven over the DevTools protocol, `--no-sandbox` since
  this host's AppArmor blocks Chrome's sandbox; the snap Chromium won't
  start from a non-snap shell) was run against a `vite preview` of the
  production build. Confirmed working: page load + service worker
  registration; ZIP lookup (Seattle → SOUPCON 3, rain overlay, 4
  commentary lines, alerts count); `soupcon_last_*` saved only on success
  and auto-resume on reload; invalid ZIP → friendly error without
  overwriting the saved ZIP; geolocation lookup (Boston → SOUPCON 1, 140
  rain streaks, 3 real alerts rendered); recipe modal (focus moves in,
  scroll lock, Escape closes and returns focus to the menu button); Share
  (clipboard text matches on-screen box exactly, toast shown, Facebook tab
  opened); simulated snow via response rewriting (SOUPCON 1 → "Snow!
  Check FRTCON!" + snowflakes; SOUPCON 2 → "Snow soon, check your
  FRTCON!"); 390px phone width with no horizontal overflow. Only console
  error: the expected logged 404 for the invalid ZIP. **Still not
  verified:** the actual PWA install flow on a real device, and print
  preview.
  - **Recipe modal serif font (pre-existing from FRTCON) — ✅ FIXED:** the
    modal renders outside `.app-page` (for print isolation), so it never
    inherited the app's Arial and fell back to the browser's default
    serif. `.modal-card` now sets the same `font-family` as `.app-page`
    (no effect on IOSInstallHelp, which already inherited it; `h2` titles
    keep their own system-ui rule). Verified in headless Chrome: computed
    font is Arial on screen and under print media emulation; screenshot
    checked.
  - **Deliberately left as-is (per owner):** NWS alert descriptions keep
    NWS's own hard line breaks, so they wrap at about half the card width
    on desktop.
- **Deliberately left as-is (per owner, "leave that alone for now"):** an
  observation with a positive `precipitationLastHour` but no
  precipitation wording in `textDescription` still defaults to `"rain"`
  (`observationPrecipType`) — the reading has no type of its own. Also
  confirmed fine as-is: the 90-minute observation age limit.

### 18. Soup recipes from the owner's wiki — open, not started

Supersedes the "rotating soup recipes" deferral in item 4 with a concrete
shape, agreed 2026-09-27 (waiting on the owner to send the wiki URL).

- **Source:** the owner's own wiki, where their wife types in her
  recipes. Licensing/attribution is a non-issue (family-authored); no
  credit lines unless the owner asks for one.
- **Plan (proposed, owner hasn't objected):**
  - Extract recipes from the wiki page once, into static app data
    (`src/data/recipe.js` becomes a list), not fetched live. No backend,
    wikis often block cross-origin reads, and a wiki edit can't break the
    app. New recipes = ask for a re-extract + redeploy.
  - Reuse the existing `RecipeModal` (including its print view) for
    whichever recipe is chosen.
  - Menu shape decided by count once the page is seen: a few recipes →
    one hamburger-menu item each; more than ~4-5 → a single "Soup
    Recipes" item opening a picker.
  - Check the extraction against the page before wiring it in (wiki
    formatting varies); ask about anything ambiguous.
- **Open until the URL arrives:** whether the wiki is reachable from this
  machine (public, LAN-only, or login-gated — if gated, the owner exports
  the page instead). Live-loading from the wiki (auto-updating, but
  needs the wiki to allow cross-origin reads and makes the app depend on
  it) is the fallback if re-extract + redeploy gets tedious.

---

## Suggested order

1. **#1 + #2** (classification + API layer — the real architectural change)
2. **#3** (wire into `App.jsx`, resolving the alerts-panel question)
3. **#4 + #5 + #6** (content, component renames, CSS renames — the app now
   *works* and *looks* like SOUPCON end-to-end)
4. **#11** (tests, while the classification logic is still fresh)
5. **#7 + #8 + #9** (branding assets, domain-referencing static files,
   storage key renames — cosmetic/polish, safe to batch)
6. **#10** (docs rewrite, once there's a stable thing to document)
7. **#12 + #13** (infra + launch — last, and gated on domain registration)

## Status (updated 2026-09-27, after items 14-18)

The rebuild (items 1-11) and infra/launch (12-13, done by the owner) are
complete and `soupcon.org` is live. Items 14-17 are post-launch fixes and
features, all done; item 18 is open. What's left:

- **Item 18, wiki soup recipes** — waiting on the wiki URL (replaces the
  old "rotating soup recipes, deferred" entry).
- **Real-device verification** — the app was finally exercised in a real
  (headless) browser in item 17: lookups, overlays, recipe modal, share,
  snow pill, phone width. Still unverified: the PWA install flow on an
  actual phone (only testable from the production root, see
  `CONTEXT.md`), and an actual print preview of the recipe.
- **Cloudflare's managed robots.txt** shadowing the explicit
  `ai-input=yes` stance — a real, open decision (see `CONTEXT.md`), not a
  bug to fix.
- **Deliberately left as-is (owner decisions, don't re-raise):** an
  untyped `precipitationLastHour` reading defaults to rain; the 90-minute
  observation age limit; NWS alert descriptions' hard line breaks.
