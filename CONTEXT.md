# SOUPCON — Development Context

This document exists to re-establish context for a new development session
(with Claude or otherwise) without needing to replay prior conversation
history. It covers infrastructure, decisions made and why, known gotchas,
and shelved work — things that aren't visible just from reading the code.
For what the app *does* and how the code is organized, see `README.md`.

## What this project is

SOUPCON ("Soup Conditions") is a fork of [frtcon.com](https://frtcon.com)
("French Toast Conditions"), rebranded and rebuilt around a different
concept: instead of classifying winter-storm alert severity, it classifies
the rain outlook (currently raining / rain soon / rain later / cloudy /
clear) into a 5-level "should I make soup and stay home" scale. It kept
FRTCON's plumbing (React/Vite, no backend, NWS-API-driven, PWA install
flow, the general code layout) but replaced the classification logic, data
sources, content, and branding. `frtcon.com` itself is untouched and
continues to exist separately — this is a new, independent site at
soupcon.org, not a migration of the old one. The rebuild was done item by
item against `SOUP_PLAN.md` (a running plan in the same spirit as
`PLAN.md`, but for this build-out rather than a code review) — read that
file's "Decisions locked in" section and its per-item "Done:" notes before
re-touching anything the rebuild already covered, for the same reason
`PLAN.md`'s own "Done:" notes matter.

The owner is primarily a backend developer using this project (both as
FRTCON and now as this fork) to build frontend and AI-assisted development
experience — development has been done largely via Claude, with the owner
directing architecture, reviewing/testing, and owning infrastructure and
branding decisions (the SOUPCON name/scale definition, the icon artwork,
and the color palette were all the owner's own calls, not Claude's).

## Infrastructure

**Live.** `soupcon.org` is deployed and serving real traffic through the
same Cloudflare Tunnel frtcon.com uses (tunnel `dd742d1d-...`), reusing the
existing origin server rather than standing up anything new:

- **Tunnel config** (`cloudflared`'s `config.yml`) has one ingress rule per
  hostname, each pointing at a different loopback port on the origin:
  `thoughtleap.com`/`www.thoughtleap.com` → `127.0.0.1:8080`,
  `frtcon.com`/`www.frtcon.com`/`frtcon.thoughtleap.com` → `127.0.0.1:8081`,
  and `soupcon.org`/`www.soupcon.org`/`soupcon.thoughtleap.com` →
  `127.0.0.1:8082`. (`thoughtleap.com` is the owner's own personal/portfolio
  domain, sharing this same origin and tunnel — not previously documented
  here since it predates this fork.) A catch-all `service: http_status:404`
  rule is last, per cloudflared's requirement.
- **No TLS on the origin at all, by design.** Every one of those `service:`
  URLs is `http://`, not `https://` — cloudflared speaks plain HTTP to
  Apache on all three ports. This is safe specifically because none of
  these ports are exposed publicly (loopback-only, no port forwarding, no
  public IP — same model the original FRTCON infra summary described);
  Cloudflare's edge is what terminates the browser-facing HTTPS connection,
  completely independent of whatever the origin does. **No certbot
  certificate exists for soupcon.org, and none is needed** — this was a
  real question raised while building this fork's infra, resolved by
  checking the actual tunnel config rather than assuming frtcon.com's
  pattern (frtcon.com's own ingress rule turns out to be plain HTTP too,
  not HTTPS-to-`:443` as an earlier draft of this document assumed before
  the actual config was reviewed).
- **Apache vhost**: `<VirtualHost 127.0.0.1:8082>` (a corresponding
  `Listen 127.0.0.1:8082` is in `/etc/apache2/ports.conf`), `ServerName
  soupcon.thoughtleap.com` with `ServerAlias soupcon.org www.soupcon.org`,
  `DocumentRoot /home/soupcon/soupcon.org`, `AllowOverride All` (needed for
  `.htaccess`'s rewrite/header rules), and `Require ip 127.0.0.1 ::1` on
  the directory as defense-in-depth on top of the loopback-only bind.
- **Deploy path**: `/home/soupcon/soupcon.org/` is the production root,
  with a `dev/` subdirectory (`/home/soupcon/soupcon.org/dev/`) as the
  review-before-promote copy — the same pattern frtcon.com's
  `public_html/dev` serves, just a differently-named top-level directory.
  Both copies confirmed live (`200` responses) with correct world-readable
  permissions throughout (checked recursively — the file-permissions
  gotcha below does not currently apply here).
- **`mod_headers` was not enabled** on this Apache instance when soupcon.org
  first went live (only `mime`/`rewrite` were) — silently dropping the
  `Link` discovery headers `.htaccess` sets up, exactly the kind of
  graceful-degradation gap that config's own `<IfModule>` wrapping was
  designed to allow, just not actually wanted here. Fixed live (`a2enmod
  headers` + reload) once noticed — this was a **pre-existing gap
  affecting frtcon.com identically**, not something this deploy
  introduced, since it's the same shared Apache instance; confirmed both
  sites now send the `Link` header correctly.
- **Cloudflare's "Managed robots.txt"** is active on this zone and
  prepends its own Content-Signal boilerplate + crawler-disallow list
  ahead of this app's own `robots.txt` on the live response — confirmed via
  a direct fetch, exactly the scenario the Agent readiness section below
  already anticipated as a possibility. Practical effect: most robots.txt
  parsers only honor the *first* `User-agent: *` group, so Cloudflare's own
  directive (which omits `ai-input` entirely, i.e. "unspecified" rather
  than granted) likely shadows this app's own explicit `ai-input=yes`.
  **Not yet resolved** — left as-is; revisit if the explicit
  `ai-input=yes` policy stance matters enough to disable Cloudflare's
  managed robots.txt for this zone.
- No domain-registration/DNS-zone specifics (registrar, nameservers) were
  independently confirmed here beyond what's implied by the tunnel/DNS
  routing actually working live — assume the same Namecheap+Cloudflare
  pattern as frtcon.com unless told otherwise.

## Frontend architecture & conventions

- React + Vite, **no backend**, no build-time secrets.
- Code is split into modules (see README for the tree):
  `App.jsx` (orchestration only), `lib/` (pure logic + network calls),
  `data/` (static content), `components/`.
- **Styling**: plain CSS in `src/styles.css`, semantic kebab-case class
  names (e.g. `.soupcon-condition-status` for the condition box,
  `.soupcon-badge--level-N` modifier classes for severity colors). No
  CSS-in-JS, no inline `style={}` except for genuinely per-instance
  dynamic values (e.g. each raindrop's randomized position/timing in
  `RainOverlay.jsx`).
- `lib/soupcon.js` (`classifySoupcon`) is pure — no React/DOM dependency —
  and does have a test suite (`soupcon.test.js`, `vitest`; the API layer
  has `weatherApi.test.js` too, with `fetch` stubbed), unlike FRTCON's
  equivalent module, which never got one.
- **Classification data source (the single biggest architectural
  difference from FRTCON):** FRTCON classified a list of NWS *alerts* by
  matching each one's fixed, published `event` string. SOUPCON classifies
  *forecast text* instead — there's no NWS alert type for "it's raining
  right now" in the general case, so alerts aren't usable as the primary
  signal here. `classifySoupcon` takes three inputs:
  - `hourlyPeriods` (NWS gridpoint `forecast/hourly`) — drives the
    12h/48h rain windows (levels 2/3).
  - `observation` (nearest station's `/observations/latest`) — drives
    "currently raining" (level 1). See the station-staleness note below.
  - `extendedPeriods` (NWS gridpoint `forecast`, 12-hour periods) — drives
    the cloudy-vs-clear split (levels 4/5) once rain is ruled out for 48h.

  Because `shortForecast`/`textDescription` are genuinely closer to free
  text than an alert's `event` field, the precipitation/cloudy/clear
  keyword lists in `soupcon.js` were checked against live `api.weather.gov`
  output (several rain-prone cities, 48h of hourly + several extended
  periods) before being trusted, not just assumed — see `SOUP_PLAN.md`
  item 2's "Done" note for exactly what was checked. Still not a
  guaranteed-complete set, the same caveat FRTCON's own `event`-matching
  carried.
- **Rain vs. snow.** Levels 1-3 don't distinguish rain from snow for the
  *level* itself — a `SNOW_KEYWORDS` list (snow, sleet, ice pellets —
  stations' word for sleet — blizzard, flurries, wintry mix) is checked *before* `RAIN_KEYWORDS`, so a mixed/ambiguous
  phrase like "Snow Showers" reads as snow rather than being swallowed by
  the "showers" rain match. `classifySoupcon`'s result carries a
  `precipType` (`"rain"`/`"snow"`/`null`) that drives both the short
  title/reason wording ("It's raining" vs. "It's snowing") and which
  overlay component renders (`RainOverlay` vs. `SnowOverlay` in
  `App.jsx`) — but *not* the rotating commentary lines in the condition
  box (`soupMessages.js`), which stay rain-flavored regardless; a full
  parallel snow-flavored commentary set was considered and explicitly
  declined as out of scope when this was built. "Freezing Rain" is
  deliberately classified as rain, not snow (falls and reads visually as
  rain, freezes only on contact).
- **Nearest-station staleness:** a station listed as "the" observation
  station for a point isn't guaranteed to have reported recently.
  `getCurrentConditions` (`weatherApi.js`) fetches up to 5 of the nearest
  stations *in parallel* (sequentially, with a 10s timeout each, a slow
  NWS could hold the whole lookup for ~a minute) and uses the nearest one
  with a reading within 90
  minutes *that actually carries weather* (a non-blank `textDescription`
  or a numeric `precipitationLastHour` — fresh-but-blank observations are
  common, even from major airports, and would otherwise read as "not
  raining" while also suppressing the hourly fallback); if none qualify, it returns `null` rather than throwing, and
  `classifySoupcon` falls back to the current hourly forecast period for
  the "currently raining" check in that case.
- **NWS forecast responses aren't trimmed to "now."** Live
  `forecast/hourly` responses routinely still lead with the hour that just
  ended (seen in 3 of 7 cities checked at once), and cached copies age
  further. `classifySoupcon` drops any period whose `endTime` has passed
  (takes an injectable `now` for tests) before applying the 12h/48h
  windows or the level-1 hourly fallback.
- **Classifier judgment calls settled with the owner (SOUP_PLAN.md item
  16):** "Partly Cloudy"/"Partly Sunny" are the same sky cover (NWS uses
  one by night, the other by day — confirmed live), so neither counts as
  cloudy for level 4 (`NOT_CLOUDY_PHRASES`); the level-1 hourly fallback
  needs a 40%+ probability (or unhedged wording when none is reported),
  a stricter bar than levels 2/3, which take any precip wording; precip in
  the near-term extended periods forces level 4 rather than 5; and
  "in Vicinity" station readings deliberately count as level 1.
- **Shared gridpoint lookup + in-flight de-dup:** `getLocationLabel`,
  `getHourlyForecast`, `getExtendedForecast`, and `getCurrentConditions`
  all need the same NWS `/points/{lat},{lon}` response (grid office/x/y,
  the two forecast URLs, the observation-stations URL, and the location
  label). `App.jsx` calls all four concurrently for a single lookup, so
  a private `getGridpointInfo` in `weatherApi.js` both caches that
  response (TTL-based, like everything else in `cache.js`) and
  deduplicates concurrent in-flight requests for the same location via an
  in-memory `Map` of pending promises — otherwise a cold-cache lookup
  would fire 4 near-simultaneous requests for the exact same URL. The
  shared request runs on its first caller's `AbortSignal`, so an entry
  whose signal is already aborted is never joined — a new lookup for the
  same location starts its own request instead of inheriting the
  cancellation. It's still not a general per-caller-cancellation
  mechanism (joiners can't cancel the shared request themselves).
- **An empty hourly forecast is an error, not "clear."**
  `getHourlyForecast` throws (and doesn't cache) when NWS returns zero
  periods, since `classifySoupcon` would otherwise fall through to level 5.
- **Location label:** uses NWS's `relativeLocation` (city/state, e.g.
  "Seattle, WA") from the `/points` response, not a forecast-zone name —
  reads better for a rain app than FRTCON's old zone-name label did.
  `getZoneByPoint` (the old zone lookup) was deleted once this replaced
  its only use.
- **Raw alerts panel kept, decoupled from the score.** SOUPCON still shows
  every active NWS alert for the location (flood-family alerts are
  on-theme for a rain app), but purely as an independent info panel —
  `classifySoupcon` doesn't look at alerts at all, so there's no
  "alerts driving the score" concept anymore.
- PWA support exists: `manifest.json`, a no-cache/network-first `sw.js`
  (deliberate — this app shows live rain-forecast data, so caching would be
  actively misleading, not just stale), and install-flow UI in the
  hamburger menu (Android gets a real install button via
  `beforeinstallprompt`; iOS gets manual "Add to Home Screen"
  instructions, since no programmatic install API exists on iOS/WebKit,
  ever, at any effort level). The service worker registers at a path
  relative to `import.meta.env.BASE_URL` (so it works whether the build
  is in `public_html/dev` or promoted to the root), but `manifest.json`'s
  `start_url` and `scope` are deliberately left hardcoded to `"/"` — a
  JSON file has no build-time templating, so making those environment-
  aware isn't worth it for a review-only instance. Practical effect:
  install/PWA behavior can't be meaningfully tested from `/dev/`, only
  from production. `sw.js` also catches a failed page navigation (a bare
  `fetch()` failure, notably during Android cold-start before the OS has
  finished bringing the network stack back up) and serves a small
  self-contained "Reconnecting…" page instead of falling through to
  Chrome's own blank-looking offline interstitial — that page retries
  with capped backoff, then gives up with a manual Retry button rather
  than spinning forever on a real outage/airplane-mode; see `public/sw.js`
  for the retry/give-up logic.
- The app auto-resumes a returning visitor's last-used lookup method
  (browser geolocation vs. ZIP) on load, tracked via a
  `soupcon_last_source` localStorage key — but that key (and
  `soupcon_last_zip`) is only written once a lookup actually succeeds, and
  the silent auto-resume is skipped entirely if
  `navigator.permissions` reports geolocation as `denied`. (This behavior,
  and the reasoning behind it, carried over unchanged from FRTCON.)

- **Facebook Share button** (`handleShare` in `App.jsx`). Facebook's
  `sharer.php` accepts only a URL, so the button copies the text to the
  clipboard and opens `sharer.php?u=https://soupcon.org` in a new tab; the
  user pastes. Decisions (carried over from FRTCON, still accurate here):
  (1) the copied text is exactly what the `.soupcon-condition-status` box
  shows (headline, title, the same random commentary lines) -- so the
  random line selection lives in `App.jsx` (`soupconMessage`), not inside
  `SoupconMessage`, so share and display can't diverge; footnote omitted.
  (2) No URL in the copied text -- the link card already carries it.
  (3) Clipboard write runs *before* `window.open()`: opening the tab first
  shifted focus and made Chrome show a "wants to see text and images
  copied to the clipboard" permission prompt. (4) Toast after, not a
  confirm dialog before -- user's choice, to avoid an extra click.
  (5) Plain text only: no way to bold the headline on Facebook
  (Unicode-bold trick was offered and declined). The "f" icon is a
  hand-built SVG, not Meta's official brand asset.

- **Icon artwork and color palette** (added during the SOUPCON rebuild).
  Icon: a two-tone bowl (a circle with its top half erased, leaving an
  upward-facing semicircle "bowl body," plus an ellipse "rim" sitting on
  the flat cut line) under three raindrop shapes, on a solid background —
  design specified directly by the owner, iterated once for boldness (the
  first pass was judged "not bold enough"; the current version is a
  user-edited master SVG with a larger bowl/rim and bigger raindrops).
  Generated as PNG/ICO from that master via `rsvg-convert`/ImageMagick,
  with a separately-scaled variant for the maskable icon (Android's
  circular-crop safe zone) since the bold master's own extremes sit just
  outside a strict circular mask's safe radius. Palette: kept FRTCON's
  blue accent family (buttons, status-box border/text, alert chips)
  unchanged since it ties directly to the icon's raindrops -- "purple
  shell + blue rain accents" mirrors the icon. Converted only the navy
  "chrome" colors (page/card/modal backgrounds, borders, dropdown/input
  backgrounds) to a purple equivalent at matching lightness. Left
  unchanged: the Facebook-brand blue share button, the red error box, the
  amber condition-status callout box, and the five severity-badge colors
  — none of those are "the app's chrome," they're semantic/brand colors
  independent of the SOUPCON hue.

## Agent readiness

Carried over from FRTCON's own agent-readiness work (a Cloudflare scan
performed there on 2026-09-25) — this fork ships the same files, re-pointed
at soupcon.org:

- `robots.txt` -- `Content-Signal: search=yes, ai-input=yes, ai-train=no`,
  explicit `Disallow` for known training crawlers (GPTBot, ClaudeBot, CCBot,
  Google-Extended, Bytespider, Applebot-Extended, meta-externalagent), and a
  `Sitemap:` line. The ai-train=no stance is the owner's policy call; flip
  it there if that changes.
- `sitemap.xml` -- just `/` (single-page app).
- `index.md` + `.htaccess` -- `Accept: text/markdown` on `/` rewrites to
  `index.md` (mod_rewrite), with `Vary: Accept`; `Link` headers advertise
  the sitemap and the markdown alternate. `.htaccess` works because the
  vhost has `AllowOverride All`; every block is `<IfModule>`-guarded (see
  the `mod_headers` gotcha below for what that guard actually caught).
- **Confirmed active, not just a risk:** Cloudflare's own "Managed
  robots.txt" is enabled on this zone and prepends its own Content-Signal
  boilerplate + crawler-disallow list ahead of the file above on the live
  response (checked via a direct fetch against soupcon.org) — see the
  Infrastructure section for what that practically means for the
  `ai-input=yes` stance. Not resolved; a deliberate choice would need to
  disable Cloudflare's managed robots.txt for this zone specifically.

## Known gotchas (things that already bit us once)

- **A rain-only keyword list silently misclassifies snow as "clear and
  sunny," not just "unrecognized."** Before `SNOW_KEYWORDS` existed, a
  plain `"Snow"` forecast/observation with no `probabilityOfPrecipitation`
  reported (which happens — NWS doesn't always populate that field, and
  observation objects don't carry it at all) matched none of
  `RAIN_KEYWORDS`, none of `CLOUDY_KEYWORDS`, fell through every check, and
  landed on the optimistic default: SOUPCON5, "Clear and sunny." Confirmed
  live via direct testing (not just reasoned about) while it was actively
  snowing in the test data. The lesson: a keyword-based classifier's
  "nothing matched" fallback needs to be checked against every input
  family it might plausibly see, not just the one the app is nominally
  "about" — a rain app still needs to know what snow looks like in the
  same data feed, or its default answer becomes actively wrong instead of
  just incomplete.
- **Never set a custom `User-Agent` header on `fetch()` calls to
  api.weather.gov.** Chrome/Firefox silently ignore it, but Safari
  (all iOS browsers, since iOS mandates WebKit) sends it as a real
  header, which fails NWS's CORS preflight and breaks every request
  specifically on iPhone. This was already added once (in FRTCON), caused
  exactly this bug, and was removed — don't re-add it without a
  server-side proxy to hold it instead.
- **Static file permissions must be world-readable (644, correct
  owner:group matching the rest of the deployed site) or Apache silently
  fails to serve them.** This specifically broke FRTCON's PWA
  manifest/service worker/icons once (root-owned 600 files) with no
  visible error — Chrome just never fired `beforeinstallprompt`, with
  nothing to indicate why. Same risk applies here once this fork is
  actually deployed.
- **Don't install certbot via both snap and apt simultaneously** — the
  DNS plugin snap only registers with the snap `certbot` binary; a
  coexisting apt install causes "unrecognized arguments" errors that look
  like a plugin problem but are actually a PATH/installation conflict.
- **`cloudflared tunnel login`'s resulting `cert.pem` is scoped to a
  single zone**, chosen at authorization time. Running
  `cloudflared tunnel route dns` for a hostname in a zone that wasn't
  authorized doesn't error clearly — it silently creates a garbage
  record by concatenating the hostname onto whichever zone it does have
  access to, rather than the intended one. Didn't bite this fork's own
  soupcon.org rollout (it's live and routing correctly), but still worth
  checking explicitly if a *new* zone is ever added to this same
  tunnel/account later — don't assume an existing authorization covers a
  zone it was never run against.
- **`mod_headers` is not enabled by default on this origin's Apache** —
  bit soupcon.org's `Link`-header setup silently (the `.htaccess` rule is
  `<IfModule>`-wrapped specifically so a missing module degrades instead
  of erroring, which it did: no error, just no header). Turns out this
  gap already affected frtcon.com identically, on the same shared Apache
  instance, unnoticed until this fork's rollout prompted a live check.
  Fixed with `a2enmod headers` + reload; if this origin is ever rebuilt,
  confirm `mod_headers` (along with `rewrite`/`mime`, which were already
  enabled) is on before assuming `.htaccess`'s `Link`/markdown-negotiation
  rules are actually taking effect — a `curl -I` check against the live
  site catches this, `.htaccess` alone reading correctly does not.
- A one-off layout report (iOS: right-side margin missing, on FRTCON)
  turned out to be a **caching artifact**, not a real CSS bug — confirmed
  via incognito testing. Worth ruling out caching first for any "looks
  different on a specific device" report before assuming it's a real
  rendering issue.
- **Vite 8 (and therefore `npm run dev`/`build`/`test`) requires Node
  `^20.19.0 || >=22.12.0`.** An older Node fails two different ways: `vite
  build`/`vitest` themselves throw (`node:util` doesn't export `styleText`
  until Node 20), and — separately — `npm install` run under an old
  npm (9.x, as bundled with Node 18) can silently skip installing a
  platform-specific optional native binding (e.g.
  `@rolldown/binding-linux-x64-gnu`), a known npm bug (npm/cli#4828),
  leaving `node_modules` broken even for a later newer-Node run until it's
  reinstalled. This dev environment now has **nvm**, with a default alias
  pinned to a Node satisfying the above (confirm with `nvm current` if
  something in this list resurfaces).
- **Service workers update lazily, not on next deploy.** Shipping a new
  `sw.js` doesn't mean a device picks it up the next time the app opens —
  the *old* SW instance is still active and controlling the page. The
  update cycle is: new SW installs in the background on the next visit →
  `skipWaiting()`/`clients.claim()` force it to take over on that load →
  but in practice this can mean the app needs to be fully closed and
  reopened **twice** after a `sw.js` deploy before the new one is actually
  active. To force it immediately for testing, uninstall and reinstall the
  PWA rather than assuming one relaunch is enough to confirm a fix (or a
  regression) in service-worker behavior specifically.

## Deliberately decided against (don't re-litigate without new info)

- **Cloudflare Bot Fight Mode**: left off (carried over from FRTCON). No
  login/payment/auth surface on SOUPCON itself for it to meaningfully
  protect, and the Free-tier version has no exception/allowlist mechanism,
  with a known false-positive track record.
- **Native app / App Store distribution**: considered and rejected as
  disproportionate. The PWA install flow (manifest + service worker) gets
  most of the practical benefit without App Store review/cost/maintenance.
- **Dynamic per-state home-screen icon** (different icon graphic per
  SOUPCON level, auto-refreshing): confirmed **not possible** on the web
  platform at all, on either OS, at any level of engineering effort — no
  API lets a web app swap its own installed icon post-install. The
  Badging API (`navigator.setAppBadge`) is the closest real capability
  (a small number/dot overlay, not a full icon swap) if revisited.

## Shelved for later (not started, but scoped)

- **Rotating soup recipes.** The recipe modal currently shows one fixed
  recipe (chicken noodle). Multiple recipes with some rotation mechanism
  is a real planned feature, explicitly deferred during the rebuild rather
  than built speculatively — see `SOUP_PLAN.md` item 4.
- **Web Share API on mobile** (native share sheet carrying condition text +
  link). The Facebook Share button itself is built (see above); this
  mobile variant is not.
- **Server-rendered share previews.** Agreed shape: accept ZIP or
  coordinates as URL parameters, server-render the initial page using
  those inputs, and set Open Graph meta tags to match the resulting
  condition — so a shared link's preview (and the link itself) reflects
  a specific real location, and doubles as a genuinely useful "check this
  location" link for whoever receives it. Requires moving off a purely
  static/client-rendered model — this is the prerequisite for both this
  and the next item. (Carried over from FRTCON, unchanged.)
- **Push notifications** for badge/condition updates while the app isn't
  open (not just on open). Requires a small backend that polls NWS on a
  schedule and pushes updates to subscribed clients.
- **Affiliate integration** (Walmart and/or Amazon) for soup ingredients or
  rainy-day gear. Walmart's affiliate program was applied for (under the
  FRTCON project); requires no business entity (individual + SSN/W-9 is
  sufficient). Walmart's "Recipes and Bundle API" is a good fit given it
  can map an ingredient list (the recipe already on-site) to purchasable
  products. Any product-API-based approach (Walmart or Amazon PA-API)
  requires a server-side credential proxy — the API keys involved cannot
  be exposed client-side the way an AdSense publisher ID or Google
  Analytics ID can. Google AdSense itself was also discussed as a
  simpler, contextual-only (not manually curated) alternative if a full
  product-API integration ends up being more than it's worth.

All shelved items above except the rotating-recipes one converge on the
same prerequisite: introducing a real backend/server-rendering layer.
Worth treating as one combined migration rather than several separate ones
when the time comes.
