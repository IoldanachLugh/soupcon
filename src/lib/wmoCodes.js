// WMO weather interpretation codes, as returned by Open-Meteo's
// `weather_code` fields. One table drives both the classifier
// (soupconOpenMeteo.js) and the human-readable text in the "Sources" panel,
// so the wording on screen can't drift from what actually decides the score.
//
// - `precipType`: "rain", "snow" or null, matching classifySoupcon's own
//   precipType. "Freezing rain/drizzle" is rain, not snow, and hail
//   (thunderstorm with hail) is rain, both the same calls soupcon.js's
//   keyword lists make for NWS text.
// - `cloudy`: counts as "cloudy or damp" for the level 4 vs. 5 split. Partly
//   cloudy (2) is deliberately not cloudy, matching the "Partly Cloudy"
//   decision in soupcon.js (NOT_CLOUDY_PHRASES).
const RAIN = "rain";
const SNOW = "snow";

const WMO_CODES = {
  0: { label: "Clear sky" },
  1: { label: "Mainly clear" },
  2: { label: "Partly cloudy" },
  3: { label: "Overcast", cloudy: true },
  45: { label: "Fog", cloudy: true },
  48: { label: "Depositing rime fog", cloudy: true },
  51: { label: "Light drizzle", precipType: RAIN },
  53: { label: "Moderate drizzle", precipType: RAIN },
  55: { label: "Dense drizzle", precipType: RAIN },
  56: { label: "Light freezing drizzle", precipType: RAIN },
  57: { label: "Dense freezing drizzle", precipType: RAIN },
  61: { label: "Slight rain", precipType: RAIN },
  63: { label: "Moderate rain", precipType: RAIN },
  65: { label: "Heavy rain", precipType: RAIN },
  66: { label: "Light freezing rain", precipType: RAIN },
  67: { label: "Heavy freezing rain", precipType: RAIN },
  71: { label: "Slight snow fall", precipType: SNOW },
  73: { label: "Moderate snow fall", precipType: SNOW },
  75: { label: "Heavy snow fall", precipType: SNOW },
  77: { label: "Snow grains", precipType: SNOW },
  80: { label: "Slight rain showers", precipType: RAIN },
  81: { label: "Moderate rain showers", precipType: RAIN },
  82: { label: "Violent rain showers", precipType: RAIN },
  85: { label: "Slight snow showers", precipType: SNOW },
  86: { label: "Heavy snow showers", precipType: SNOW },
  95: { label: "Thunderstorm", precipType: RAIN },
  96: { label: "Thunderstorm with slight hail", precipType: RAIN },
  99: { label: "Thunderstorm with heavy hail", precipType: RAIN },
};

// Always returns `{ label, precipType, cloudy }`. A code missing from the
// table (none seen live, but the list isn't guaranteed complete) reads as
// "Weather code N" with no precipitation and not cloudy, so it shows up
// plainly in the Sources panel rather than being silently mislabeled.
export function describeWmoCode(code) {
  const entry = WMO_CODES[code];
  return {
    label: entry?.label ?? `Weather code ${code ?? "?"}`,
    precipType: entry?.precipType ?? null,
    cloudy: entry?.cloudy ?? false,
  };
}
