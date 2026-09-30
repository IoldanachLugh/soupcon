import { describe, it, expect, vi, afterEach } from "vitest";
import { getOpenMeteoForecast, makeOpenMeteoUrl } from "./openMeteoApi";

// fetch is stubbed per test. localStorage isn't available under vitest's
// node environment, so every cache read is a miss (see weatherApi.test.js).

const RESPONSE = {
  current: { time: 1790785800, interval: 900, weather_code: 3, precipitation: 0, rain: 0, showers: 0, snowfall: 0, cloud_cover: 100 },
  hourly: {
    time: [1790784000, 1790787600],
    weather_code: [3, 61],
    precipitation_probability: [10, 80],
    precipitation: [0, 0.4],
    cloud_cover: [100, 100],
  },
  daily: {
    time: [1790726400],
    weather_code: [61],
    precipitation_probability_max: [80],
    precipitation_sum: [0.4],
  },
};

function stubFetch(handler) {
  const fetchMock = vi.fn((url) => handler(url));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeOpenMeteoUrl", () => {
  it("asks for current, hourly and daily data as unix times starting at the current hour", () => {
    const url = makeOpenMeteoUrl(51.5074, -0.1278);
    expect(url).toContain("latitude=51.5074&longitude=-0.1278");
    expect(url).toContain("current=weather_code,");
    expect(url).toContain("hourly=weather_code,precipitation_probability,");
    expect(url).toContain("daily=weather_code,precipitation_probability_max,");
    expect(url).toContain("forecast_hours=48&past_hours=0");
    expect(url).toContain("timeformat=unixtime&timezone=auto");
  });
});

describe("getOpenMeteoForecast", () => {
  it("returns current, hourly and daily from a single request", async () => {
    const fetchMock = stubFetch(() => ok({ ...RESPONSE, latitude: 51.5, timezone: "Europe/London" }));
    const result = await getOpenMeteoForecast(51.5074, -0.1278);
    expect(result).toEqual({ ...RESPONSE, timezone: "Europe/London" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails, rather than returning an empty forecast, when no hourly rows come back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => ok({ ...RESPONSE, hourly: { ...RESPONSE.hourly, time: [] } }));
    await expect(getOpenMeteoForecast(51.5, -0.12)).rejects.toThrow(/didn't return a forecast/);
  });

  it("turns an HTTP error into a plain-language message without the URL or status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: true }) }));
    const error = await getOpenMeteoForecast(51.5, -0.12).catch((e) => e);
    expect(error.message).toMatch(/isn't responding/);
    expect(error.message).not.toMatch(/400|open-meteo/i);
  });
});
