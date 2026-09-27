import { describe, it, expect } from "vitest";
import { classifySoupcon, periodPrecipType, observationPrecipType, pickRandomItems } from "./soupcon";

function hourlyPeriod(shortForecast, probability = null) {
  return {
    shortForecast,
    probabilityOfPrecipitation: { value: probability },
  };
}

function clearHours(count) {
  return Array.from({ length: count }, () => hourlyPeriod("Sunny", 0));
}

describe("periodPrecipType", () => {
  it("matches rain-family keywords in shortForecast", () => {
    expect(periodPrecipType(hourlyPeriod("Rain"))).toBe("rain");
    expect(periodPrecipType(hourlyPeriod("Chance Showers"))).toBe("rain");
    expect(periodPrecipType(hourlyPeriod("Slight Chance Thunderstorms"))).toBe("rain");
  });

  it("matches snow-family keywords in shortForecast", () => {
    expect(periodPrecipType(hourlyPeriod("Snow"))).toBe("snow");
    expect(periodPrecipType(hourlyPeriod("Chance Flurries"))).toBe("snow");
    expect(periodPrecipType(hourlyPeriod("Sleet"))).toBe("snow");
    expect(periodPrecipType(hourlyPeriod("Blizzard"))).toBe("snow");
    expect(periodPrecipType(hourlyPeriod("Wintry Mix"))).toBe("snow");
  });

  it("prefers snow over rain when a phrase matches both (e.g. 'Snow Showers')", () => {
    expect(periodPrecipType(hourlyPeriod("Snow Showers"))).toBe("snow");
    expect(periodPrecipType(hourlyPeriod("Rain and Snow"))).toBe("snow");
  });

  it("treats 'Freezing Rain' as rain, not snow", () => {
    expect(periodPrecipType(hourlyPeriod("Freezing Rain"))).toBe("rain");
  });

  it("matches on a high probability of precipitation even without type wording, defaulting to rain", () => {
    expect(periodPrecipType(hourlyPeriod("Cloudy", 60))).toBe("rain");
  });

  it("does not match a low probability with no precipitation wording", () => {
    expect(periodPrecipType(hourlyPeriod("Partly Cloudy", 10))).toBe(null);
  });

  it("does not match clear/sunny wording", () => {
    expect(periodPrecipType(hourlyPeriod("Sunny", 0))).toBe(null);
  });

  it("handles a missing period", () => {
    expect(periodPrecipType(null)).toBe(null);
    expect(periodPrecipType(undefined)).toBe(null);
  });
});

describe("observationPrecipType", () => {
  it("matches rain wording in textDescription", () => {
    expect(observationPrecipType({ textDescription: "Light Rain" })).toBe("rain");
  });

  it("matches snow wording in textDescription", () => {
    expect(observationPrecipType({ textDescription: "Snow" })).toBe("snow");
    expect(observationPrecipType({ textDescription: "Blowing Snow" })).toBe("snow");
  });

  it("matches a positive precipitationLastHour reading with neutral wording, defaulting to rain", () => {
    expect(
      observationPrecipType({ textDescription: "Cloudy", precipitationLastHour: { value: 1.2 } })
    ).toBe("rain");
  });

  it("does not match dry conditions", () => {
    expect(observationPrecipType({ textDescription: "Clear", precipitationLastHour: { value: 0 } })).toBe(
      null
    );
  });

  it("handles a missing observation", () => {
    expect(observationPrecipType(null)).toBe(null);
  });
});

describe("classifySoupcon", () => {
  it("returns level 1 with precipType rain when the observation shows rain", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Rain" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(1);
    expect(result.precipType).toBe("rain");
    expect(result.title).toBe("It's raining right now");
  });

  it("returns level 1 with precipType snow when the observation shows snow", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Snow" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(1);
    expect(result.precipType).toBe("snow");
    expect(result.title).toBe("It's snowing right now");
    expect(result.reason).toBe("Snow is currently falling at this location.");
  });

  it("falls back to the current hourly period for level 1 when there is no observation", () => {
    const result = classifySoupcon({
      observation: null,
      hourlyPeriods: [hourlyPeriod("Rain"), ...clearHours(47)],
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(1);
    expect(result.precipType).toBe("rain");
  });

  it("does not silently fall through to level 5 for a plain 'Snow' forecast with no reported probability", () => {
    // Regression case: before precip-type detection covered snow keywords,
    // a bare "Snow" period (no "shower"/"rain" substring, no reported
    // probabilityOfPrecipitation) matched nothing and fell all the way
    // through to "clear and sunny" -- the worst possible wrong answer
    // while it was actually snowing.
    const result = classifySoupcon({
      observation: { textDescription: "Snow", precipitationLastHour: { value: null } },
      hourlyPeriods: Array.from({ length: 48 }, () => hourlyPeriod("Snow", null)),
      extendedPeriods: [{ shortForecast: "Snow" }],
    });
    expect(result.level).toBe(1);
    expect(result.precipType).toBe("snow");
  });

  it("returns level 2 when rain is expected within 12 hours but not right now", () => {
    const hourlyPeriods = clearHours(3).concat([hourlyPeriod("Rain")], clearHours(44));
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods,
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(2);
    expect(result.precipType).toBe("rain");
    expect(result.title).toBe("Rain is on its way");
  });

  it("returns level 2 with precipType snow when snow is expected within 12 hours", () => {
    const hourlyPeriods = clearHours(3).concat([hourlyPeriod("Snow")], clearHours(44));
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods,
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(2);
    expect(result.precipType).toBe("snow");
    expect(result.title).toBe("Snow is on its way");
  });

  it("returns level 3 when rain is expected in hours 12-47 but not the first 12", () => {
    const hourlyPeriods = clearHours(20).concat([hourlyPeriod("Showers")], clearHours(27));
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods,
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(3);
    expect(result.precipType).toBe("rain");
  });

  it("returns level 3 with precipType snow when snow is expected in hours 12-47", () => {
    const hourlyPeriods = clearHours(20).concat([hourlyPeriod("Sleet")], clearHours(27));
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods,
      extendedPeriods: [{ shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(3);
    expect(result.precipType).toBe("snow");
    expect(result.title).toBe("Snow later in the outlook");
  });

  it("returns level 4 when no rain is expected in 48h but the near-term outlook is cloudy", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Cloudy" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Mostly Cloudy" }, { shortForecast: "Sunny" }],
    });
    expect(result.level).toBe(4);
    expect(result.precipType).toBe(null);
  });

  it("returns level 5 when the outlook is clear with no rain expected", () => {
    const result = classifySoupcon({
      observation: { textDescription: "Clear" },
      hourlyPeriods: clearHours(48),
      extendedPeriods: [{ shortForecast: "Sunny" }, { shortForecast: "Mostly Clear" }],
    });
    expect(result.level).toBe(5);
    expect(result.precipType).toBe(null);
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
    expect(periodPrecipType(hourlyPeriod("Slight Chance Rain Showers"))).toBe("rain");
    expect(periodPrecipType(hourlyPeriod("Chance Showers And Thunderstorms"))).toBe("rain");
    expect(
      periodPrecipType(hourlyPeriod("Showers And Thunderstorms Likely then Chance Showers And Thunderstorms"))
    ).toBe("rain");
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
