import { describe, it, expect, vi, afterEach } from "vitest";
import { formatPlaceLabel, coordinatesLabel, getReverseGeocodedLabel } from "./reverseGeocode";

// Responses below are trimmed copies of real BigDataCloud output.
const LONDON = { city: "London", locality: "City of Westminster", countryName: "United Kingdom of Great Britain and Northern Ireland", countryCode: "GB" };
const VANCOUVER = { city: "Metro Vancouver Regional District", locality: "Downtown Vancouver", countryName: "Canada", countryCode: "CA" };
const OCEAN = { city: "", locality: "Atlantic Ocean", countryName: "", countryCode: "" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("formatPlaceLabel", () => {
  it("uses the city and the short country name", () => {
    expect(formatPlaceLabel(LONDON)).toBe("London, United Kingdom");
    expect(formatPlaceLabel({ city: "Reykjavik", locality: "Reykjavik", countryName: "Iceland", countryCode: "IS" })).toBe("Reykjavik, Iceland");
  });

  it("prefers the locality when the 'city' is really an administrative area", () => {
    expect(formatPlaceLabel(VANCOUVER)).toBe("Downtown Vancouver, Canada");
  });

  it("falls back to the locality, and to the raw country name without a code", () => {
    expect(formatPlaceLabel({ city: "", locality: "Carran", countryName: "Ireland", countryCode: "" })).toBe("Carran, Ireland");
  });

  it("uses open water's locality as-is, with no country", () => {
    expect(formatPlaceLabel(OCEAN)).toBe("Atlantic Ocean");
  });

  it("does not repeat the name when it equals the country", () => {
    expect(formatPlaceLabel({ city: "Singapore", locality: "", countryName: "Singapore", countryCode: "SG" })).toBe("Singapore");
  });

  it("returns null when nothing names the place", () => {
    expect(formatPlaceLabel({ city: "", locality: "" })).toBe(null);
    expect(formatPlaceLabel(null)).toBe(null);
  });
});

describe("coordinatesLabel", () => {
  it("shows both coordinates to two decimals", () => {
    expect(coordinatesLabel(51.5074, -0.1278)).toBe("51.51, -0.13");
  });
});

describe("getReverseGeocodedLabel", () => {
  it("asks for the point in English and returns the formatted label", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => LONDON }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getReverseGeocodedLabel(51.5074, -0.1278)).resolves.toBe("London, United Kingdom");
    expect(fetchMock.mock.calls[0][0]).toContain("latitude=51.5074&longitude=-0.1278&localityLanguage=en");
  });

  it("returns null, not an error, when the geocoder fails (e.g. blocked with a 402)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 402, json: async () => ({}) })));
    await expect(getReverseGeocodedLabel(51.5, -0.12)).resolves.toBe(null);
  });

  it("still throws when the lookup was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))));
    await expect(getReverseGeocodedLabel(51.5, -0.12, { signal: controller.signal })).rejects.toThrow();
  });
});
