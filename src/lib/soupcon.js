// Pure functions, no React/DOM dependency -- same reasoning as the old
// frtcon.js: classifySoupcon can be unit-tested directly against fake
// forecast/observation data, no network or React tree required.
//
// Unlike FRTCON (which classified a list of NWS *alerts* by matching a
// fixed, published `event` string), SOUPCON classifies *forecast text* --
// hourly periods' `shortForecast`, an observation's `textDescription`, and
// extended-forecast periods' `shortForecast`. These are genuinely closer to
// free text than NWS's alert `event` field is (NWS doesn't publish a fixed
// list of `shortForecast` strings), so keyword matching here is a judgment
// call more than a canonical-code lookup, and should be validated against
// real NWS output before being treated as final -- see SOUP_PLAN.md item 1.

// Rain-family conditions. "Freezing Rain" deliberately lands here (not in
// SNOW_KEYWORDS below) since it falls and reads visually as rain, freezing
// only on contact -- it's a winter hazard, but not a snow one.
const RAIN_KEYWORDS = ["rain", "showers", "shower", "thunderstorm", "drizzle", "sprinkles"];

// Snow-family conditions. Checked *before* RAIN_KEYWORDS wherever both are
// tested (see textPrecipType) so a mixed/ambiguous phrase like "Snow
// Showers" or "Rain and Snow" -- which would also match "showers"/"rain" --
// reads as snow, the more specific and more disruptive condition, rather
// than being silently folded into "rain."
const SNOW_KEYWORDS = ["snow", "sleet", "blizzard", "flurries", "wintry mix"];

// "Cloudy" and "clear" are treated as mutually exclusive buckets: NWS's
// shortForecast phrasing ("Partly Cloudy", "Mostly Sunny", "Overcast",
// "Mostly Clear") reliably contains one or the other, not both, so a single
// substring pass against each list is enough without needing to rank them.
const CLOUDY_KEYWORDS = ["cloudy", "overcast", "fog", "foggy", "mist", "haze", "damp"];
const CLEAR_KEYWORDS = ["sunny", "clear"];

function matchesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

// Returns "snow", "rain", or null -- never both. Text-only; the numeric
// probability fallback (no type info of its own) lives in the two
// exported functions below, since only they know which reading to fall
// back to (precipitationLastHour vs. probabilityOfPrecipitation).
function textPrecipType(text) {
  if (matchesAny(text, SNOW_KEYWORDS)) return "snow";
  if (matchesAny(text, RAIN_KEYWORDS)) return "rain";
  return null;
}

// Exported so the API layer (or a future UI) can reuse the exact same
// precipitation check the classifier uses, instead of re-implementing
// keyword matching. Returns the precip type ("rain"/"snow") or null.
export function periodPrecipType(period, { probabilityThreshold = 40 } = {}) {
  if (!period) return null;
  const text = (period.shortForecast || "").toLowerCase();
  const type = textPrecipType(text);
  if (type) return type;

  const prob = period.probabilityOfPrecipitation?.value;
  if (typeof prob === "number" && prob >= probabilityThreshold) {
    // A high probability with no type-indicating text at all is a rare
    // edge case -- NWS's shortForecast almost always names the
    // precipitation type when it reports a meaningful chance of it -- so
    // this defaults to the far more common case rather than leaving the
    // type undetermined.
    return "rain";
  }
  return null;
}

export function observationPrecipType(observation) {
  if (!observation) return null;
  const text = (observation.textDescription || "").toLowerCase();
  const type = textPrecipType(text);
  if (type) return type;

  const precip = observation.precipitationLastHour?.value;
  if (typeof precip === "number" && precip > 0) {
    // precipitationLastHour is a liquid-equivalent reading with no type of
    // its own, and textDescription almost always says "Snow" when it's
    // actually snowing -- same rare-edge-case reasoning as above.
    return "rain";
  }
  return null;
}

// Short title/reason text per level+type, used by classifySoupcon below.
// Only levels 1-3 vary by type; 4/5 mean "no precipitation" and don't.
const PRECIP_WORDING = {
  1: {
    rain: { title: "It's raining right now", reason: "Rain is currently falling at this location." },
    snow: { title: "It's snowing right now", reason: "Snow is currently falling at this location." },
  },
  2: {
    rain: { title: "Rain is on its way", reason: "Rain is expected within the next 12 hours." },
    snow: { title: "Snow is on its way", reason: "Snow is expected within the next 12 hours." },
  },
  3: {
    rain: { title: "Rain later in the outlook", reason: "Rain is expected within the next 48 hours." },
    snow: { title: "Snow later in the outlook", reason: "Snow is expected within the next 48 hours." },
  },
};

function periodIndicatesCloudy(period) {
  const text = (period?.shortForecast || "").toLowerCase();
  return matchesAny(text, CLOUDY_KEYWORDS);
}

function firstPrecipType(periods) {
  for (const period of periods) {
    const type = periodPrecipType(period);
    if (type) return type;
  }
  return null;
}

// classifySoupcon walks levels 1 -> 5 in order, same "first match wins,
// most severe first" shape as FRTCON's determineFrtcon/classifyAlert.
//
// - `hourlyPeriods`: chronological hourly forecast periods starting from
//   the current hour (NWS gridpoint forecast/hourly `properties.periods`).
// - `observation`: the nearest reporting station's latest observation, or
//   null if none was available/fresh enough (see SOUP_PLAN.md's
//   nearest-station-staleness open question -- the API layer is
//   responsible for finding a usable one, or passing null).
// - `extendedPeriods`: chronological 12-hour forecast periods (NWS
//   gridpoint `forecast` `properties.periods`), used only to tell level 4
//   from level 5 once rain is ruled out for the next 48 hours.
export function classifySoupcon({ hourlyPeriods = [], observation = null, extendedPeriods = [] } = {}) {
  // Level 1: currently precipitating. Prefer a real observation; fall back
  // to the current hourly period only when no observation is available at
  // all, so a temporarily-missing reading doesn't just silently skip
  // level 1.
  const currentType = observation ? observationPrecipType(observation) : periodPrecipType(hourlyPeriods[0]);

  if (currentType) {
    return { level: 1, label: "SOUPCON1", precipType: currentType, ...PRECIP_WORDING[1][currentType] };
  }

  // Level 2: precipitation somewhere in the next 12 hours.
  const next12Type = firstPrecipType(hourlyPeriods.slice(0, 12));
  if (next12Type) {
    return { level: 2, label: "SOUPCON2", precipType: next12Type, ...PRECIP_WORDING[2][next12Type] };
  }

  // Level 3: precipitation somewhere in the next 48 hours (already known
  // not to be in the next 12, from the check above).
  const next48Type = firstPrecipType(hourlyPeriods.slice(0, 48));
  if (next48Type) {
    return { level: 3, label: "SOUPCON3", precipType: next48Type, ...PRECIP_WORDING[3][next48Type] };
  }

  // Levels 4/5: no precipitation expected soon. Look at the near-term
  // extended (12-hour period) forecast -- roughly the same ~2-day window as
  // the 48-hour check above -- for cloud cover. Any cloudy/damp period in
  // that window means level 4; otherwise default to level 5, the same
  // "nothing else matched" optimistic default FRTCON's own level 5 used.
  const nearTerm = extendedPeriods.slice(0, 4);
  if (nearTerm.some(periodIndicatesCloudy)) {
    return {
      level: 4,
      label: "SOUPCON4",
      precipType: null,
      title: "Cloudy and damp",
      reason: "No rain is expected soon, but skies are staying cloudy or damp.",
    };
  }

  return {
    level: 5,
    label: "SOUPCON5",
    precipType: null,
    title: "Clear and sunny",
    reason: "Clear, sunny weather is expected for the next several days.",
  };
}

// Copied from the old frtcon.js (deleted in SOUP_PLAN.md item 5) rather
// than moved -- this was already the only copy in use since item 3
// stopped importing frtcon.js, item 5 just removed the now-dead file.
export function pickRandomItems(items, count) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}
