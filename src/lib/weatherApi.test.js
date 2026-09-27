import { describe, it, expect, vi, afterEach } from "vitest";
import { getLocationLabel, getHourlyForecast, getCurrentConditions } from "./weatherApi";

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
  const fresh = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

  it("requests all candidate stations at once, and prefers the nearest usable one", async () => {
    const stationA = deferred();
    const fetchMock = stubFetch((url) => {
      if (url.includes("/points/")) return Promise.resolve(jsonResponse(POINTS));
      if (url === "https://nws.test/stations") {
        return Promise.resolve(jsonResponse({ features: stations.map((id) => ({ id })) }));
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
        return Promise.resolve(jsonResponse({ features: stations.map((id) => ({ id })) }));
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
