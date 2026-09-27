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

### 2. New API layer — `src/lib/weatherApi.js`

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

### 3. Wire into `App.jsx`

- Replace the `frtcon`/`frtconMessage` `useMemo`s with `soupcon`/
  `soupconMessage`, fed by the new data instead of `result.alerts`.
- `result` shape grows to carry hourly/observation/extended data instead of
  (or alongside, if the alerts panel is kept) `alerts`.
- The refresh machinery (`fetchedAt`, `STALE_ON_VISIBLE_MS`,
  `visibilitychange` effect, auto-refresh interval) is data-shape-agnostic
  and should carry over largely unchanged.
- Resolve the "raw alerts panel" open question here, since it determines
  whether `AlertCard.jsx` and the alerts fetch stay in the tree at all.

### 4. Content rewrite

- New `src/data/soupMessages.js` (replaces `alertMessages.js`): 5 levels,
  soup/rain-themed headline + title + rotating commentary lines, same shape
  `pickRandomItems` already consumes.
- `src/data/recipe.js` → chicken noodle soup recipe (per decision above).
- Copy pass over hardcoded strings in `App.jsx` (Share button text,
  headings like "Active Zone Alerts", aria-labels mentioning FRTCON).

### 5. Component/file renames

- `src/lib/frtcon.js` → `src/lib/soupcon.js` (already done in item 1).
- `FrtconBadge.jsx` → `SoupconBadge.jsx`, `FrtconMessage.jsx` →
  `SoupconMessage.jsx` — mechanical renames + prop names.
- `RecipeModal.jsx` — title text, no structural change expected.
- Resolve `SnowOverlay.jsx`'s fate (open question above) and
  `AlertCard.jsx`'s fate (tied to item 3's decision).

### 6. CSS renames — `src/styles.css`

- `.frtcon-*` → `.soupcon-*` classes (`.frtcon-badge--level-N`,
  `.frtcon-condition-status`, `.frtcon-status-row`, `.frtcon-updated-at`,
  `.frtcon-matching-alerts*`, `.frtcon-title-large`, etc.).
- Verify visually in both light/dark and at phone width after, same as
  `PLAN.md` #9's verification approach.

### 7. Branding/meta pass

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

### 8. Domain/crawler files

- `public/robots.txt`, `public/sitemap.xml`, `public/index.md`: `frtcon.com`
  → `soupcon.org` URLs.
- `.htaccess` (if any domain-specific values are in it — check when this
  step is reached).

### 9. localStorage key prefixes — `src/lib/cache.js`

- `frtcon_zip_lookup_` / `frtcon_zone_lookup_` / `frtcon_alerts_` →
  `soupcon_*` equivalents, plus new prefixes for hourly/observation/extended
  caches from item 2. `frtcon_last_source` / `frtcon_last_zip` → `soupcon_*`.
- No migration shim needed — `soupcon.org` is a different origin, so old
  `frtcon_*` keys never exist there in the first place.

### 10. Docs rewrite — `README.md` and `CONTEXT.md`

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

### 11. Tests — `vitest`

- Add as dev dependency with a `test` script (same ask as old `PLAN.md`
  #11, but done this time as part of the rewrite instead of shelved).
- Cover `soupcon.js`: each level's representative forecast/observation
  shapes, the 12h-vs-48h boundary, day/night wording variants, and
  `pickRandomItems` (already covered, carries over unchanged).

### 12. Infra — soupcon.org

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

### 13. Cutover/launch checklist

- Build, deploy to the `dev` path first, verify there (remembering
  `CONTEXT.md`'s note that PWA/install behavior can't be meaningfully
  tested from `/dev/`, only from the promoted root).
- Promote to `soupcon.org` root, confirm PWA install flow, confirm
  robots.txt/sitemap.xml are being served and match the agent-readiness
  setup FRTCON already did.

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
