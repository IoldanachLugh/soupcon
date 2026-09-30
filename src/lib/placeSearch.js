import { COUNTRY_CODES } from "../data/countryCodes";
import { fetchJson, friendlyMessage } from "./weatherApi";

// City search for the non-US lookup (SOUP_PLAN.md item 24): Open-Meteo's
// geocoding API searches by name, optionally limited to one country. Free,
// no key, CORS open (checked live); same non-commercial terms as the
// forecast API. Results come back ranked (largest places first).
export const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";
export const MAX_PLACE_RESULTS = 8;
// Asked for more than we show, so that after dropping non-places (below) there
// are still enough left.
const PLACE_SEARCH_COUNT = 20;
export const MIN_PLACE_QUERY_LENGTH = 2; // the API returns nothing for 1 character
export const DEFAULT_COUNTRY = "US";

// `{ code, name }` for the Country dropdown: the US first (as "USA", and the
// default), then every other country alphabetically by its English name.
export function getCountryOptions() {
  let names;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  const nameOf = (code) => names?.of(code) ?? code;
  const others = COUNTRY_CODES.filter((code) => code !== DEFAULT_COUNTRY)
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return [{ code: DEFAULT_COUNTRY, name: "USA" }, ...others];
}

export function countryName(code) {
  return getCountryOptions().find((option) => option.code === code)?.name ?? code;
}

// "Cluj-Napoca, Cluj County, Romania". Consecutive repeats are dropped, so
// Bucharest (whose region is also "Bucharest") reads "Bucharest, Romania".
export function formatSearchResultLabel(result) {
  const parts = [result.name, result.admin1, result.country].filter(Boolean);
  return parts.filter((part, index) => part !== parts[index - 1]).join(", ");
}

// The geocoder also returns airports, heliports, parks and the like ("San
// Juan Steam Plant Heliport"); a visitor searching a city wants a populated
// place (GeoNames feature codes PPL, PPLA, PPLC...). If that would leave
// nothing, everything is kept rather than reporting no match.
function preferPopulatedPlaces(results) {
  const populated = results.filter((result) => /^PPL/.test(result.feature_code ?? ""));
  return populated.length > 0 ? populated : results;
}

// Returns `[{ label, lat, lon }]`, best match first; an empty array when
// nothing matched. A failed request throws a plain-language Error.
export async function searchPlaces(query, countryCode, { signal } = {}) {
  const params = new URLSearchParams({
    name: query.trim(),
    count: String(PLACE_SEARCH_COUNT),
    language: "en",
    format: "json",
    countryCode,
  });

  let data;
  try {
    data = await fetchJson(`${GEOCODING_BASE}?${params}`, { signal });
  } catch (err) {
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }

  const usable = (data?.results ?? []).filter(
    (result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
  );
  return preferPopulatedPlaces(usable)
    .slice(0, MAX_PLACE_RESULTS)
    .map((result) => ({
      label: formatSearchResultLabel(result),
      lat: Number(result.latitude.toFixed(4)),
      lon: Number(result.longitude.toFixed(4)),
    }));
}
