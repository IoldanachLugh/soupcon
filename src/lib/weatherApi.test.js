import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getLocationLabel,
  getHourlyForecast,
  getCurrentConditions,
  getStationReadings,
  getSkyCover,
  expandGridValues,
  haversineMiles,
  selectObservationStations,
} from "./weatherApi";

// fetch is stubbed per test with a URL -> handler map. localStorage isn't
// available under vitest's node environment, so cache.js's try/catch makes
// every cache read a miss -- each test hits the (fake) network.

const POINTS = {
  properties: {
    forecastHourly: "https://nws.test/hourly",
    forecast: "https://nws.test/forecast",
    observationStations: "https://nws.test/stations",
    relativeLocation: { properties: { city: "Testville", state: "TS" } },
  },
};

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function stubFetch(handler) {
  const fetchMock = vi.fn((url, { signal } = {}) => handler(url, signal));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getGridpointInfo in-flight de-dup", () => {
  it("does not hand a new lookup an in-flight request whose signal was already aborted", async () => {
    let pointsCalls = 0;
    stubFetch((url, signal) => {
      if (url.includes("/points/")) {
        pointsCalls += 1;
        if (pointsCalls === 1) {
          // First request hangs until its lookup is cancelled.
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
        }
        return Promise.resolve(jsonResponse(POINTS));
      }
      throw new Error(`unexpected ${url}`);
    });

    const first = new AbortController();
    const firstLookup = getLocationLabel(10.001, 20.001, { signal: first.signal });
    first.abort();
    const second = new AbortController();
    const label = await getLocationLabel(10.001, 20.001, { signal: second.signal });

    expect(label).toBe("Testville, TS");
    expect(pointsCalls).toBe(2);
    await expect(firstLookup).rejects.toThrow();
  });

  it("still collapses concurrent lookups sharing a live signal into one request", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(POINTS)));
    const { signal } = new AbortController();
    await Promise.all([
      getLocationLabel(10.002, 20.002, { signal }),
      getLocationLabel(10.002, 20.002, { signal }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getHourlyForecast", () => {
  it("throws instead of returning an empty period list", async () => {
    stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse(POINTS));
      if (url === "https://nws.test/hourly") return Promise.resolve(jsonResponse({ properties: { periods: [] } }));
      throw new Error(`unexpected ${url}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getHourlyForecast(10.003, 20.003)).rejects.toThrow(/didn't return a forecast/);
  });
});

describe("getCurrentConditions", () => {
  const stations = ["https://nws.test/st/A", "https://nws.test/st/B", "https://nws.test/st/C"];
  // A, B, C at increasing distance, all well within the 60-mile radius of
  // each test's lookup point (lat ~10, lon ~20). GeoJSON is [lon, lat].
  const stationFeatures = (lat, lon) =>
    stations.map((id, index) => ({ id, geometry: { coordinates: [lon, lat + 0.05 * (index + 1)] } }));
  const fresh = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

  it("requests all candidate stations at once, and prefers the nearest usable one", async () => {
    const stationA = deferred();
    const fetchMock = stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse(POINTS));
      if (url === "https://nws.test/stations") {
        return Promise.resolve(jsonResponse({ features: stationFeatures(10.004, 20.004) }));
      }
      if (url === "https://nws.test/st/A/observations/latest") return stationA.promise;
      if (url === "https://nws.test/st/B/observations/latest") {
        return Promise.resolve(jsonResponse({ properties: { timestamp: fresh(), textDescription: "Light Rain" } }));
      }
      if (url === "https://nws.test/st/C/observations/latest") {
        return Promise.resolve(jsonResponse({ properties: { timestamp: fresh(), textDescription: "Clear" } }));
      }
      throw new Error(`unexpected ${url}`);
    });

    const pending = getCurrentConditions(10.004, 20.004);
    // Let the /points and /stations steps settle; station A is still hanging.
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => url);
      expect(urls).toContain("https://nws.test/st/C/observations/latest");
    });

    // Station A (nearest) answers last, but with a blank reading -- so B,
    // the next nearest usable one, wins over C.
    stationA.resolve(jsonResponse({ properties: { timestamp: fresh(), textDescription: "" } }));
    const observation = await pending;
    expect(observation.textDescription).toBe("Light Rain");
  });

  it("prefers the nearest usable station even when a farther one answers first", async () => {
    stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse(POINTS));
      if (url === "https://nws.test/stations") {
        return Promise.resolve(jsonResponse({ features: stationFeatures(10.005, 20.005) }));
      }
      if (url === "https://nws.test/st/A/observations/latest") {
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(jsonResponse({ properties: { timestamp: fresh(), textDescription: "Snow" } })),
            20
          )
        );
      }
      return Promise.resolve(jsonResponse({ properties: { timestamp: fresh(), textDescription: "Clear" } }));
    });

    const observation = await getCurrentConditions(10.005, 20.005);
    expect(observation.textDescription).toBe("Snow");
  });
});

describe("getStationReadings", () => {
  const fresh = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const stale = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const feature = (id, latOffset) => ({ id: `https://nws.test/st/${id}`, geometry: { coordinates: [20.006, 10.006 + latOffset] } });

  it("reports every candidate nearest-first and marks the one classification would use", async () => {
    stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse(POINTS));
      if (url === "https://nws.test/stations") {
        return Promise.resolve(jsonResponse({ features: [feature("B", 0.1), feature("A", 0.05), feature("C", 0.15)] }));
      }
      if (url === "https://nws.test/st/A/observations/latest") {
        return Promise.resolve(jsonResponse({ properties: { timestamp: stale(), textDescription: "" } }));
      }
      if (url === "https://nws.test/st/B/observations/latest") {
        return Promise.resolve(jsonResponse({ properties: { timestamp: fresh(), textDescription: "Light Rain" } }));
      }
      return Promise.reject(new Error("down"));
    });

    const readings = await getStationReadings(10.006, 20.006);
    expect(readings.map((r) => r.stationId)).toEqual(["A", "B", "C"]);
    expect(readings.map((r) => r.usable)).toEqual([false, true, false]);
    expect(readings.map((r) => r.chosen)).toEqual([false, true, false]);
    expect(readings[2].error).toBeTruthy();
  });
});

describe("haversineMiles", () => {
  it("matches a known distance", () => {
    // Seattle -> Portland, OR is ~145 miles great-circle.
    expect(haversineMiles(47.6062, -122.3321, 45.5152, -122.6784)).toBeCloseTo(145, -1);
    expect(haversineMiles(40, -100, 40, -100)).toBe(0);
  });
});

describe("selectObservationStations", () => {
  // One degree of latitude is ~69 miles, so offsets below are easy to
  // reason about: 0.5 deg ~ 35 mi, 1 deg ~ 69 mi, 2 deg ~ 138 mi.
  const station = (id, latOffset) => ({ id, geometry: { coordinates: [-100, 40 + latOffset] } });

  it("sorts by computed distance rather than trusting list order", () => {
    const picked = selectObservationStations([station("far", 0.6), station("near", 0.1), station("mid", 0.3)], 40, -100);
    expect(picked).toEqual(["near", "mid", "far"]);
  });

  it("drops stations beyond 60 miles when enough are within range", () => {
    const picked = selectObservationStations(
      [station("a", 0.1), station("b", 0.2), station("c", 0.5), station("far", 1)],
      40,
      -100
    );
    expect(picked).toEqual(["a", "b", "c"]);
  });

  it("always includes at least the nearest 2, however far", () => {
    // Only one station within 60 miles (the rural case, e.g. Ely, NV).
    const picked = selectObservationStations([station("near", 0.1), station("far", 1), station("farther", 2)], 40, -100);
    expect(picked).toEqual(["near", "far"]);
  });

  it("caps at 5 even when more are within range", () => {
    const features = Array.from({ length: 9 }, (_, index) => station(`s${index}`, 0.05 * (index + 1)));
    expect(selectObservationStations(features, 40, -100)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("sorts stations without coordinates last, usable only toward the minimum", () => {
    const picked = selectObservationStations([{ id: "unknown" }, station("near", 0.1)], 40, -100);
    expect(picked).toEqual(["near", "unknown"]);
  });
});

describe("expandGridValues", () => {
  it("expands each ISO 8601 interval into one entry per hour", () => {
    const hours = expandGridValues([
      { validTime: "2026-09-30T12:00:00+00:00/PT1H", value: 42 },
      { validTime: "2026-09-30T13:00:00+00:00/PT2H", value: 26 },
      { validTime: "2026-09-30T15:00:00+00:00/P1DT1H", value: 60 },
    ]);
    const start = Date.parse("2026-09-30T12:00:00Z");
    expect(hours).toHaveLength(1 + 2 + 25);
    expect(hours.slice(0, 4)).toEqual([
      { start, value: 42 },
      { start: start + 3600000, value: 26 },
      { start: start + 2 * 3600000, value: 26 },
      { start: start + 3 * 3600000, value: 60 },
    ]);
    expect(hours.at(-1).start).toBe(start + 27 * 3600000);
  });

  it("skips unparseable entries and copes with missing input", () => {
    expect(expandGridValues([{ validTime: "garbage", value: 1 }, { validTime: "2026-09-30T12:00:00Z/soon", value: 2 }])).toEqual([]);
    expect(expandGridValues(undefined)).toEqual([]);
  });
});

describe("getSkyCover", () => {
  it("reads skyCover from the raw gridpoint URL NWS gives, as hourly values", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse({ properties: { ...POINTS.properties, forecastGridData: "https://nws.test/grid" } }));
      if (url === "https://nws.test/grid") {
        return Promise.resolve(jsonResponse({ properties: { skyCover: { values: [{ validTime: "2026-09-30T12:00:00+00:00/PT2H", value: 57 }] } } }));
      }
      throw new Error(`unexpected ${url}`);
    });
    const hours = await getSkyCover(11.111, 22.222);
    expect(hours.map((hour) => hour.value)).toEqual([57, 57]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("https://nws.test/grid");
  });

  it("falls back to the forecast URL minus /forecast when the gridpoint has no grid data URL", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse({ properties: { ...POINTS.properties, forecast: "https://nws.test/gridpoints/OKX/1,2/forecast" } }));
      if (url === "https://nws.test/gridpoints/OKX/1,2") return Promise.resolve(jsonResponse({ properties: {} }));
      throw new Error(`unexpected ${url}`);
    });
    expect(await getSkyCover(11.112, 22.223)).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("https://nws.test/gridpoints/OKX/1,2");
  });
});
