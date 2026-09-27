import { describe, it, expect } from "vitest";
import { classifySoupcon, periodIndicatesRain, observationIndicatesRain, pickRandomItems } from "./soupcon";

function hourlyPeriod(shortForecast, probability = null) {
  return {
    shortForecast,
    probabilityOfPrecipitation: { value: probability },
  };
}

function clearHours(count) {
  return Array.from({ length: count }, () => hourlyPeriod("Sunny", 0));
}

describe("periodIndicatesRain", () => {
  it("matches rain-family keywords in shortForecast", () => {
    expect(periodIndicatesRain(hourlyPeriod("Rain"))).toBe(true);
    expect(periodIndicatesRain(hourlyPeriod("Chance Showers"))).toBe(true);
    expect(periodIndicatesRain(hourlyPeriod("Slight Chance Thunderstorms"))).toBe(true);
  });

  it("matches on a high probability of precipitation even without rain wording", () => {
    expect(periodIndicatesRain(hourlyPeriod("Cloudy", 60))).toBe(true);
  });

  it("does not match a low probability with no rain wording", () => {
    expect(periodIndicatesRain(hourlyPeriod("Partly Cloudy", 10))).toBe(false);
  });

  it("does not match clear/sunny wording", () => {
    expect(periodIndicatesRain(hourlyPeriod("Sunny", 0))).toBe(false);
  });

  it("handles a missing period", () => {
    expect(periodIndicatesRain(null)).toBe(false);
    expect(periodIndicatesRain(undefined)).toBe(false);
  });
});

describe("observationIndicatesRain", () => {
  it("matches rain wording in textDescription", () => {
    expect(observationIndicatesRain({ textDescription: "Light Rain" })).toBe(true);
  });

  it("matches a positive precipitationLastHour reading with neutral wording", () => {
    expect(
      observationIndicatesRain({ textDescription: "Cloudy", precipitationLastHour: { value: 1.2 } })
    ).toBe(true);
  });

  it("does not match dry conditions", () => {
    expect(observationIndicatesRain({ textDescription: "Clear", precipitationLastHour: { value: 0 } })).toBe(
      false
    );
  });

  it("handles a missing observation", () => {
    expect(observationIndicatesRain(null)).toBe(false);
  });
});

describe("classifySoupcon", () => {
  it("returns level 1 when the observation shows rain", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Rain" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(1);
  });

  it("falls back to the current hourly period for level 1 when there is no observation", () => {
    const result = classifySoupcon({
      observation: null,
      hourlyPeriods: [hourlyPeriod("Rain"), ...clearHours(47)],
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(1);
  });

  it("returns level 2 when rain is expected within 12 hours but not right now", () => {
    const hourlyPeriods = clearHours(3).concat([hourlyPeriod("Rain")], clearHours(44));
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods,
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(2);
  });

  it("returns level 3 when rain is expected in hours 12-47 but not the first 12", () => {
    const hourlyPeriods = clearHours(20).concat([hourlyPeriod("Showers")], clearHours(27));
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods,
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(3);
  });

  it("returns level 4 when no rain is expected in 48h but the near-term outlook is cloudy", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Mostly Cloudy" }, { shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(4);
  });

  it("returns level 5 when the outlook is clear with no rain expected", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Clear" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Sunny" }, { shortForecast: "Mostly Clear" }],
    });
    expect(result.level).toBe(5);
  });

  it("defaults to level 5 when there is no data at all", () => {
    const result = classifySoupcon({});
    expect(result.level).toBe(5);
  });

  it("only looks at the next 4 extended periods for the 4-vs-5 distinction", () => {
    // A cloudy period 5th in line (outside the ~2-day near-term window)
    // shouldn't pull a genuinely clear near-term outlook down to level 4.
    const result = classifySoupcon({
      observation: { textDescription: "Clear" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [
        { shortForecast: "Sunny" },
        { shortForecast: "Sunny" },
        { shortForecast: "Clear" },
        { shortForecast: "Mostly Sunny" },
        { shortForecast: "Cloudy" },
      ],
    });
    expect(result.level).toBe(5);
  });
});

describe("day/night forecast wording", () => {
  // NWS phrases the same sky condition differently by time of day (e.g.
  // "Sunny" during the day vs. "Clear"/"Mostly Clear" at night for a
  // similarly cloudless period) -- these confirm classifySoupcon treats
  // both as equivalent rather than only recognizing the daytime phrasing.
  it("treats daytime 'sunny' and nighttime 'clear' phrasing as equivalent for level 5", () => {
    const daytime = classifySoupcon({
      observation: null,
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Sunny" }, { shortForecast: "Mostly Sunny" }],
    });
    const nighttime = classifySoupcon({
      observation: null,
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Mostly Clear" }, { shortForecast: "Clear" }],
    });
    expect(daytime.level).toBe(5);
    expect(nighttime.level).toBe(5);
  });

  it("treats 'partly cloudy' and 'mostly cloudy' phrasing as equivalent for level 4", () => {
    const partly = classifySoupcon({
      observation: null,
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Partly Cloudy" }],
    });
    const mostly = classifySoupcon({
      observation: null,
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Mostly Cloudy" }],
    });
    expect(partly.level).toBe(4);
    expect(mostly.level).toBe(4);
  });

  // Locks in real shortForecast strings pulled from live api.weather.gov
  // data during SOUP_PLAN.md item 2's verification (Miami/New
  // Orleans/Houston/Orlando/Tampa), including NWS's "X then Y" combined
  // multi-condition phrasing, as a permanent regression test rather than
  // a one-off manual check.
  it("matches real NWS rain phrasing, including combined 'X then Y' forecasts", () => {
    expect(periodIndicatesRain(hourlyPeriod("Slight Chance Rain Showers"))).toBe(true);
    expect(periodIndicatesRain(hourlyPeriod("Chance Showers And Thunderstorms"))).toBe(true);
    expect(
      periodIndicatesRain(
        hourlyPeriod("Showers And Thunderstorms Likely then Chance Showers And Thunderstorms")
      )
    ).toBe(true);
  });
});

describe("pickRandomItems", () => {
  it("returns min(count, length) unique items", () => {
    const items = ["a", "b", "c", "d"];
    const picked = pickRandomItems(items, 2);
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
    picked.forEach((item) => expect(items).toContain(item));
  });

  it("caps at the pool length when count exceeds it", () => {
    const items = ["a", "b"];
    expect(pickRandomItems(items, 5)).toHaveLength(2);
  });
});
