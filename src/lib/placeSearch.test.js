import { describe, it, expect, vi, afterEach } from "vitest";
import { COUNTRY_CODES } from "../data/countryCodes";
import { getCountryOptions, countryName, formatSearchResultLabel, searchPlaces } from "./placeSearch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubFetch = (handler) => {
  const fetchMock = vi.fn((url) => handler(url));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const ok = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

describe("getCountryOptions", () => {
  const options = getCountryOptions();

  it("puts USA first, then everything else alphabetically by name", () => {
    expect(options[0]).toEqual({ code: "US", name: "USA" });
    const rest = options.slice(1).map((option) => option.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("lists each country once, with a real name rather than just its code", () => {
    expect(options).toHaveLength(COUNTRY_CODES.length);
    expect(new Set(options.map((option) => option.code)).size).toBe(options.length);
    expect(options.filter((option) => option.name === option.code)).toEqual([]);
    expect(options.find((option) => option.code === "RO").name).toBe("Romania");
  });

  it("has no duplicate or obsolete codes (e.g. UK, which is GB)", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES).not.toContain("UK");
    expect(COUNTRY_CODES).toContain("GB");
  });

  it("countryName falls back to the code for an unknown one", () => {
    expect(countryName("RO")).toBe("Romania");
    expect(countryName("ZZ")).toBe("ZZ");
  });
});

describe("formatSearchResultLabel", () => {
  it("joins city, region and country, dropping a region that repeats the city", () => {
    expect(formatSearchResultLabel({ name: "Cluj-Napoca", admin1: "Cluj County", country: "Romania" })).toBe("Cluj-Napoca, Cluj County, Romania");
    expect(formatSearchResultLabel({ name: "Bucharest", admin1: "Bucharest", country: "Romania" })).toBe("Bucharest, Romania");
    expect(formatSearchResultLabel({ name: "Hagåtña", country: "Guam" })).toBe("Hagåtña, Guam");
  });
});

describe("searchPlaces", () => {
  const RESULTS = {
    results: [
      { name: "Cluj-Napoca", admin1: "Cluj County", country: "Romania", latitude: 46.76667, longitude: 23.6, feature_code: "PPLA" },
      { name: "Cluj-Napoca International Airport", admin1: "Cluj County", country: "Romania", latitude: 46.78517, longitude: 23.68617, feature_code: "AIRP" },
      { name: "Cluj Sector", admin1: "Cluj County", country: "Romania", latitude: 46.7, longitude: 23.5, feature_code: "PPLX" },
    ],
  };

  it("asks for the name within the chosen country and returns labeled, rounded coordinates", async () => {
    const fetchMock = stubFetch(() => ok(RESULTS));
    const places = await searchPlaces("  Cluj ", "RO");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("name=Cluj&");
    expect(url).toContain("countryCode=RO");
    expect(url).toContain("count=20");
    expect(places[0]).toEqual({ label: "Cluj-Napoca, Cluj County, Romania", lat: 46.7667, lon: 23.6 });
  });

  it("drops airports and other non-places when populated places matched", async () => {
    stubFetch(() => ok(RESULTS));
    const places = await searchPlaces("Cluj", "RO");
    expect(places.map((place) => place.label)).toEqual(["Cluj-Napoca, Cluj County, Romania", "Cluj Sector, Cluj County, Romania"]);
  });

  it("keeps everything when no result is a populated place, rather than reporting no match", async () => {
    stubFetch(() => ok({ results: [RESULTS.results[1]] }));
    await expect(searchPlaces("Cluj airport", "RO")).resolves.toHaveLength(1);
  });

  it("shows at most 8 places", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `Town ${i}`, country: "Romania", latitude: 45 + i / 100, longitude: 25, feature_code: "PPL" }));
    stubFetch(() => ok({ results: many }));
    await expect(searchPlaces("Town", "RO")).resolves.toHaveLength(8);
  });

  it("returns an empty list when nothing matches (the API omits `results`)", async () => {
    stubFetch(() => ok({ generationtime_ms: 1 }));
    await expect(searchPlaces("zzzzqq", "RO")).resolves.toEqual([]);
  });

  it("skips results without usable coordinates", async () => {
    stubFetch(() => ok({ results: [{ name: "Nowhere", country: "Romania", feature_code: "PPL" }, RESULTS.results[0]] }));
    await expect(searchPlaces("Cluj", "RO")).resolves.toHaveLength(1);
  });

  it("turns an HTTP failure into a plain-language message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
    await expect(searchPlaces("Cluj", "RO")).rejects.toThrow(/isn't responding/);
  });
});
