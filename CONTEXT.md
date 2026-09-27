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

**Not yet set up.** `soupcon.org` has no deployment yet — this section will
get filled in with real facts (domain registration status, DNS zone,
Apache vhost path, certbot/cert details, Cloudflare Tunnel ingress rule)
once that work actually happens (`SOUP_PLAN.md` items 12-13), not before.

Planned shape, per `SOUP_PLAN.md`: the same general pattern frtcon.com
uses (Cloudflare Tunnel + Apache origin + certbot via
`certbot-dns-cloudflare`), likely the *same* Cloudflare account and
possibly the same Tunnel (an existing tunnel can route multiple hostnames —
see the cloudflared gotcha below), but as its **own** vhost, its **own**
TLS certificate (not an `--expand` of frtcon.com's cert, since these are
unrelated sites), and its own DNS zone/registration. Do not assume any of
frtcon.com's specific infrastructure facts (its tunnel ID, its vhost path,
its cert SANs) apply here until item 12 actually sets this fork's own
infrastructure up and this section is rewritten with what's actually true.

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
  and does have a test suite (`soupcon.test.js`, `vitest`), unlike FRTCON's
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
  text than an alert's `event` field, the rain/cloudy/clear keyword lists
  in `soupcon.js` were checked against live `api.weather.gov` output
  (several rain-prone cities, 48h of hourly + several extended periods)
  before being trusted, not just assumed — see `SOUP_PLAN.md` item 2's
  "Done" note for exactly what was checked. Still not a guaranteed-complete
  set, the same caveat FRTCON's own `event`-matching carried.
- **Nearest-station staleness:** a station listed as "the" observation
  station for a point isn't guaranteed to have reported recently.
  `getCurrentConditions` (`weatherApi.js`) tries up to 5 of the nearest
  stations in order and uses the first one with a reading within 90
  minutes; if none qualify, it returns `null` rather than throwing, and
  `classifySoupcon` falls back to the current hourly forecast period for
  the "currently raining" check in that case.
- **Shared gridpoint lookup + in-flight de-dup:** `getLocationLabel`,
  `getHourlyForecast`, `getExtendedForecast`, and `getCurrentConditions`
  all need the same NWS `/points/{lat},{lon}` response (grid office/x/y,
  the two forecast URLs, the observation-stations URL, and the location
  label). `App.jsx` calls all four concurrently for a single lookup, so
  a private `getGridpointInfo` in `weatherApi.js` both caches that
  response (TTL-based, like everything else in `cache.js`) and
  deduplicates concurrent in-flight requests for the same location via an
  in-memory `Map` of pending promises — otherwise a cold-cache lookup
  would fire 4 near-simultaneous requests for the exact same URL. This
  relies on this app's own call pattern always passing the same
  `AbortSignal` to concurrent calls for one location; it isn't a
  general-purpose per-caller-cancellation mechanism.
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

## Known gotchas (things that already bit us once)

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
  access to, rather than the intended one. **Directly relevant to this
  fork's own infra work (item 12):** if `soupcon.org` is a new zone on
  the same Cloudflare account used for frtcon.com, re-run `tunnel login`
  and explicitly authorize the `soupcon.org` zone before routing any
  hostname in it — don't assume the existing authorization covers it.
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
