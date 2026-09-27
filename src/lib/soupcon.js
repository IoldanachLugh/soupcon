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

// NWS words the same 3/8-5/8 sky cover as "Partly Sunny" by day and
// "Partly Cloudy" by night (confirmed live: each only ever appears in its
// own half of the day). "Partly Sunny" never matched CLOUDY_KEYWORDS, so
// "Partly Cloudy" matching via "cloudy" made the same sky level 4 at night
// but level 5 by day -- and since the near-term window always includes
// nights, fair outlooks kept dropping to 4. Per owner decision, partly
// cloudy/sunny skies don't count as cloudy at all; only Mostly Cloudy,
// Cloudy, Overcast, fog, etc. do. Stripped (not just skipped) so a
// combined "Partly Cloudy then Mostly Cloudy" still reads as cloudy.
const NOT_CLOUDY_PHRASES = ["partly cloudy"];
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

// Station "in vicinity" readings ("Showers in Vicinity", "Thunderstorm in
// Vicinity" -- METAR VCSH/VCTS, precipitation within ~5-10 miles but not
// at the station itself) deliberately count as currently precipitating:
// per owner decision, that's local enough for level 1. They match the rain
// keywords on their own, so no special handling is needed -- just don't
// add an exclusion for them.
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
  let text = (period?.shortForecast || "").toLowerCase();
  for (const phrase of NOT_CLOUDY_PHRASES) {
    text = text.replaceAll(phrase, "");
  }
  return matchesAny(text, CLOUDY_KEYWORDS);
}

// Level 1's fallback when no usable observation exists: the current hourly
// period stands in for "is it precipitating right now," which needs a
// higher bar than "is precipitation possible sometime in the next 12
// hours" (levels 2/3). Any rain wording counts for those, but here
// "Slight Chance Rain Showers" at 15% would otherwise announce "It's
// raining right now." So this requires the same 40% probability
// periodPrecipType's numeric fallback uses -- or, when NWS didn't report a
// probability at all, precip wording without a "chance" hedge (so a bare
// "Snow" or "Rain" period with no probability still counts, the exact case
// the snow-fallthrough gotcha in CONTEXT.md was about).
const CURRENT_PERIOD_MIN_PROBABILITY = 40;

function currentPeriodPrecipType(period) {
  const type = periodPrecipType(period);
  if (!type) return null;

  const prob = period.probabilityOfPrecipitation?.value;
  if (typeof prob === "number") {
    return prob >= CURRENT_PERIOD_MIN_PROBABILITY ? type : null;
  }
  return (period.shortForecast || "").toLowerCase().includes("chance") ? null : type;
}

// NWS doesn't trim its forecast responses to the current moment: live
// forecast/hourly responses routinely still lead with the hour that just
// ended (confirmed across several cities), and a cached copy (see
// HOURLY_FORECAST_CACHE_TTL_MS) ages further still. Without this, "the
// current hour" for the level-1 fallback could be an hour that's already
// over, and the 12h/48h windows would silently be an hour short. Periods
// without a parseable endTime are kept rather than guessed about.
function dropEndedPeriods(periods, now) {
  return periods.filter((period) => {
    const end = Date.parse(period?.endTime);
    return Number.isNaN(end) || end > now;
  });
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
// - `now`: injectable for tests; periods that ended before it are ignored
//   (see dropEndedPeriods).
export function classifySoupcon({
  hourlyPeriods: allHourlyPeriods = [],
  observation = null,
  extendedPeriods: allExtendedPeriods = [],
  now = Date.now(),
} = {}) {
  const hourlyPeriods = dropEndedPeriods(allHourlyPeriods, now);
  const extendedPeriods = dropEndedPeriods(allExtendedPeriods, now);

  // Level 1: currently precipitating. Prefer a real observation; fall back
  // to the current hourly period only when no observation is available at
  // all, so a temporarily-missing reading doesn't just silently skip
  // level 1 (with a stricter bar -- see currentPeriodPrecipType).
  const currentType = observation
    ? observationPrecipType(observation)
    : currentPeriodPrecipType(hourlyPeriods[0]);

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
  //
  // Precipitation in that window also means level 4, not 5: 4 twelve-hour
  // periods can reach past the 48 hourly periods checked above (e.g. a
  // lookup made in the evening), and a period worded just "Rain Showers"
  // has no cloudy keyword -- so it used to fall through to "Clear, sunny
  // weather is expected for the next several days" with rain in the
  // forecast, the same fallthrough trap as CONTEXT.md's snow gotcha.
  const nearTerm = extendedPeriods.slice(0, 4);
  if (nearTerm.some((period) => periodIndicatesCloudy(period) || periodPrecipType(period))) {
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
