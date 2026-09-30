import { getCacheItem, setCacheItem, makeGeocodeCacheKey, GEOCODE_CACHE_TTL_MS } from "./cache";
import { fetchJson } from "./weatherApi";

// Place names for the non-US (Open-Meteo) path, where NWS's `/points`
// `relativeLocation` isn't available (SOUP_PLAN.md item 22). Open-Meteo's own
// geocoding API only searches by name, not by coordinates.
//
// BigDataCloud's free client-side endpoint: no API key, CORS open (checked
// live). **Its Fair Use Policy only allows calls that use the device's own
// current location** (the browser's geolocation), not pre-stored or
// third-party coordinates -- and breaching it can get the visitor's IP
// banned (HTTP 402). So callers must only use this for a browser-geolocation
// lookup, never for `?lat=&lon=` URL coordinates. Everything else gets
// coordinatesLabel() instead.
export const REVERSE_GEOCODE_BASE = "https://api.bigdatacloud.net/data/reverse-geocode-client";

// BigDataCloud sometimes returns an administrative area as the "city" (e.g.
// "Metro Vancouver Regional District" for downtown Vancouver); the more
// specific `locality` reads better in those cases.
const ADMIN_AREA_PATTERN = /\b(regional district|county|municipality)\b/i;

function countryName(place) {
  // "GB" -> "United Kingdom"; BigDataCloud's own countryName is the long
  // formal name ("United Kingdom of Great Britain and Northern Ireland").
  try {
    const short = place.countryCode ? new Intl.DisplayNames(["en"], { type: "region" }).of(place.countryCode) : null;
    if (short) return short;
  } catch {
    // Intl.DisplayNames missing or an unknown code -- use the raw name.
  }
  return place.countryName || "";
}

// "London, United Kingdom", "Tokyo, Japan". Returns null when the response
// names no place at all. Open water has only a locality ("Atlantic Ocean")
// and no country, which is used as-is.
export function formatPlaceLabel(place) {
  if (!place) return null;
  const city = place.city?.trim();
  const locality = place.locality?.trim();
  const name = city && !(ADMIN_AREA_PATTERN.test(city) && locality) ? city : locality || city || "";
  if (!name) return null;

  const country = countryName(place);
  return country && country !== name ? `${name}, ${country}` : name;
}

// What to show when there's no place name (or the geocoder isn't allowed):
// the coordinates themselves, to the ~1 km precision a forecast has anyway.
export function coordinatesLabel(lat, lon) {
  return `Lat ${Number(lat).toFixed(2)}, Lon ${Number(lon).toFixed(2)}`;
}

// Never throws for a failed lookup -- the label is cosmetic, so a geocoder
// outage (or a ban) must not fail the forecast lookup. Returns null instead
// (and doesn't cache it) so the caller can fall back to coordinatesLabel().
// An aborted lookup still throws, like every other fetch in this app.
export async function getReverseGeocodedLabel(lat, lon, { signal } = {}) {
  const cacheKey = makeGeocodeCacheKey(lat, lon);
  const cached = getCacheItem(cacheKey, GEOCODE_CACHE_TTL_MS);
  if (cached) return cached;

  let place;
  try {
    place = await fetchJson(`${REVERSE_GEOCODE_BASE}?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error(err.message);
    return null;
  }

  const label = formatPlaceLabel(place);
  if (label) setCacheItem(cacheKey, label);
  return label;
}
