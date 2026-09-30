import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupWeather, refreshWeather, classifyLookup, PROVIDER_NWS, PROVIDER_OPEN_METEO } from "./weatherProvider";

// fetch is stubbed with a URL -> response handler. localStorage isn't
// available under vitest's node environment, so every cache read is a miss.

const FUTURE = "2999-01-01T00:00:00Z";
const POINTS = {
  properties: {
    forecastHourly: "https://nws.test/hourly",
    forecast: "https://nws.test/forecast",
    observationStations: "https://nws.test/stations",
    relativeLocation: { properties: { city: "Testville", state: "TS" } },
  },
};
const NWS_HOURLY = { properties: { periods: [{ shortForecast: "Sunny", endTime: FUTURE }] } };
const NWS_EXTENDED = { properties: { periods: [{ shortForecast: "Sunny", endTime: FUTURE }] } };

const H = 3600;
const START_S = Math.floor(Date.now() / 1000 / H) * H;
const OPEN_METEO = {
  current: { time: START_S, weather_code: 0, precipitation: 0, rain: 0, showers: 0, snowfall: 0, cloud_cover: 5 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => START_S + i * H),
    weather_code: Array.from({ length: 48 }, () => 0),
    precipitation_probability: Array.from({ length: 48 }, () => 0),
    precipitation: Array.from({ length: 48 }, () => 0),
    cloud_cover: Array.from({ length: 48 }, () => 5),
  },
  daily: { time: [START_S], weather_code: [0], precipitation_probability_max: [0], precipitation_sum: [0] },
};
const LONDON = { city: "London", locality: "City of Westminster", countryName: "United Kingdom of Great Britain and Northern Ireland", countryCode: "GB" };

const ok = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const fail = (status) => Promise.resolve({ ok: false, status, json: async () => ({}) });

// `nws` decides /points: "covered" (real US point), 404 (outside coverage) or
// 500 (an outage). Every call is recorded in `calls`.
function stub({ points = "covered", geocoder = () => ok(LONDON) } = {}) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      calls.push(url);
      if (url.includes("api.weather.gov/points/")) return points === "covered" ? ok(POINTS) : fail(points);
      if (url.includes("/alerts/active")) return points === "covered" ? ok({ features: [{ id: "a1" }] }) : fail(400);
      if (url === "https://nws.test/hourly") return ok(NWS_HOURLY);
      if (url === "https://nws.test/forecast") return ok(NWS_EXTENDED);
      if (url === "https://nws.test/stations") return ok({ features: [] });
      if (url.includes("api.open-meteo.com")) return ok(OPEN_METEO);
      if (url.includes("bigdatacloud")) return geocoder();
      throw new Error(`unexpected ${url}`);
    })
  );
  return calls;
}

const called = (calls, part) => calls.some((url) => url.includes(part));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lookupWeather routing", () => {
  it("uses NWS, with its city/state label and alerts, for a US point, and never touches Open-Meteo", async () => {
    const calls = stub();
    const result = await lookupWeather(47.6, -122.3, { source: "url" });
    expect(result).toMatchObject({ provider: PROVIDER_NWS, locationLabel: "Testville, TS", alerts: [{ id: "a1" }] });
    expect(result.hourlyPeriods).toHaveLength(1);
    expect(called(calls, "open-meteo")).toBe(false);
    expect(called(calls, "bigdatacloud")).toBe(false);
  });

  it("falls back to Open-Meteo when NWS answers 404 (outside coverage), with no NWS alerts", async () => {
    const calls = stub({ points: 404 });
    const result = await lookupWeather(51.5074, -0.1278, { source: "url" });
    expect(result.provider).toBe(PROVIDER_OPEN_METEO);
    expect(result.alerts).toEqual([]);
    expect(result.openMeteo.hourly).toHaveLength(48);
    expect(called(calls, "open-meteo")).toBe(true);
  });

  it("does not fall back on an NWS outage: a 500 fails the lookup and Open-Meteo is never asked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = stub({ points: 500 });
    await expect(lookupWeather(47.6, -122.3, { source: "url" })).rejects.toThrow(/isn't responding/);
    expect(called(calls, "open-meteo")).toBe(false);
  });
});

describe("Open-Meteo place name", () => {
  it("uses the reverse geocoder for a browser-geolocation lookup", async () => {
    stub({ points: 404 });
    const result = await lookupWeather(51.5074, -0.1278, { source: "browser" });
    expect(result.locationLabel).toBe("London, United Kingdom");
  });

  it("shows the coordinates, and never calls the geocoder, for URL coordinates", async () => {
    const calls = stub({ points: 404 });
    const result = await lookupWeather(51.5074, -0.1278, { source: "url" });
    expect(result.locationLabel).toBe("Lat 51.51, Lon -0.13");
    expect(called(calls, "bigdatacloud")).toBe(false);
  });

  it("shows coordinates when the geocoder fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stub({ points: 404, geocoder: () => fail(402) });
    const result = await lookupWeather(51.5074, -0.1278, { source: "browser" });
    expect(result.locationLabel).toBe("Lat 51.51, Lon -0.13");
  });

  it("does not let a hanging geocoder hold up the forecast", async () => {
    stub({ points: 404, geocoder: () => new Promise(() => {}) });
    const result = await lookupWeather(51.5074, -0.1278, { source: "browser", geocodeWaitMs: 20 });
    expect(result.provider).toBe(PROVIDER_OPEN_METEO);
    expect(result.locationLabel).toBe("Lat 51.51, Lon -0.13");
  });
});

describe("refreshWeather", () => {
  it("refreshes an Open-Meteo result from Open-Meteo only, without re-probing NWS", async () => {
    const calls = stub({ points: 404 });
    const fresh = await refreshWeather(51.5, -0.12, PROVIDER_OPEN_METEO);
    expect(Object.keys(fresh)).toEqual(["openMeteo"]);
    expect(called(calls, "api.weather.gov")).toBe(false);
  });

  it("refreshes an NWS result's forecast, observation and alerts", async () => {
    stub();
    const fresh = await refreshWeather(47.6, -122.3, PROVIDER_NWS);
    expect(Object.keys(fresh).sort()).toEqual(["alerts", "extendedPeriods", "hourlyPeriods", "observation"]);
  });
});

describe("classifyLookup", () => {
  it("classifies an NWS result with the NWS classifier and an Open-Meteo result with its own", async () => {
    stub();
    const nws = await lookupWeather(47.6, -122.3, { source: "url" });
    expect(classifyLookup(nws)).toMatchObject({ level: 5 });

    stub({ points: 404 });
    const abroad = await lookupWeather(51.5074, -0.1278, { source: "url" });
    expect(classifyLookup(abroad)).toMatchObject({ level: 5, label: "SOUPCON5" });
    expect(classifyLookup(null)).toBe(null);
  });
});
