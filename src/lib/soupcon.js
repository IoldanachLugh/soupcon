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

// Rain-family conditions. Deliberately narrower than a winter-weather app's
// concerns would be (no snow/sleet/wintry-mix keywords) -- SOUPCON is a rain
// app, and NWS's own wording for winter precipitation doesn't use these
// terms anyway.
const RAIN_KEYWORDS = ["rain", "showers", "shower", "thunderstorm", "drizzle", "sprinkles"];

// "Cloudy" and "clear" are treated as mutually exclusive buckets: NWS's
// shortForecast phrasing ("Partly Cloudy", "Mostly Sunny", "Overcast",
// "Mostly Clear") reliably contains one or the other, not both, so a single
// substring pass against each list is enough without needing to rank them.
const CLOUDY_KEYWORDS = ["cloudy", "overcast", "fog", "foggy", "mist", "haze", "damp"];
const CLEAR_KEYWORDS = ["sunny", "clear"];

function matchesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

// Exported so the API layer (or a future UI) can reuse the exact same rain
// check the classifier uses, instead of re-implementing keyword matching.
export function periodIndicatesRain(period, { probabilityThreshold = 40 } = {}) {
  if (!period) return false;
  const text = (period.shortForecast || "").toLowerCase();
  if (matchesAny(text, RAIN_KEYWORDS)) return true;

  const prob = period.probabilityOfPrecipitation?.value;
  return typeof prob === "number" && prob >= probabilityThreshold;
}

export function observationIndicatesRain(observation) {
  if (!observation) return false;
  const text = (observation.textDescription || "").toLowerCase();
  if (matchesAny(text, RAIN_KEYWORDS)) return true;

  const precip = observation.precipitationLastHour?.value;
  return typeof precip === "number" && precip > 0;
}

function periodIndicatesCloudy(period) {
  const text = (period?.shortForecast || "").toLowerCase();
  return matchesAny(text, CLOUDY_KEYWORDS);
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
  // Level 1: currently raining. Prefer a real observation; fall back to the
  // current hourly period only when no observation is available at all, so
  // a temporarily-missing reading doesn't just silently skip level 1.
  const currentlyRaining = observation
    ? observationIndicatesRain(observation)
    : periodIndicatesRain(hourlyPeriods[0]);

  if (currentlyRaining) {
    return {
      level: 1,
      label: "SOUPCON1",
      title: "It's raining right now",
      reason: "Rain is currently falling at this location.",
    };
  }

  // Level 2: rain somewhere in the next 12 hours.
  const next12 = hourlyPeriods.slice(0, 12);
  if (next12.some((period) => periodIndicatesRain(period))) {
    return {
      level: 2,
      label: "SOUPCON2",
      title: "Rain is on its way",
      reason: "Rain is expected within the next 12 hours.",
    };
  }

  // Level 3: rain somewhere in the next 48 hours (already known not to be
  // in the next 12, from the check above).
  const next48 = hourlyPeriods.slice(0, 48);
  if (next48.some((period) => periodIndicatesRain(period))) {
    return {
      level: 3,
      label: "SOUPCON3",
      title: "Rain later in the outlook",
      reason: "Rain is expected within the next 48 hours.",
    };
  }

  // Levels 4/5: no rain expected soon. Look at the near-term extended
  // (12-hour period) forecast -- roughly the same ~2-day window as the
  // 48-hour rain check above -- for cloud cover. Any cloudy/damp period in
  // that window means level 4; otherwise default to level 5, the same
  // "nothing else matched" optimistic default FRTCON's own level 5 used.
  const nearTerm = extendedPeriods.slice(0, 4);
  if (nearTerm.some(periodIndicatesCloudy)) {
    return {
      level: 4,
      label: "SOUPCON4",
      title: "Cloudy and damp",
      reason: "No rain is expected soon, but skies are staying cloudy or damp.",
    };
  }

  return {
    level: 5,
    label: "SOUPCON5",
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
