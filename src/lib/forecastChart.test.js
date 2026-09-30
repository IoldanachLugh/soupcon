import { describe, it, expect } from "vitest";
import { nwsChartData, openMeteoChartData, decidedHour, CHART_HOURS } from "./forecastChart";

const HOUR = 3600000;
const START = Date.parse("2026-09-30T20:00:00Z");

function period(i, rain) {
  return {
    startTime: new Date(START + i * HOUR).toISOString(),
    endTime: new Date(START + (i + 1) * HOUR).toISOString(),
    shortForecast: "Mostly Cloudy",
    probabilityOfPrecipitation: { value: rain },
  };
}

describe("nwsChartData", () => {
  it("pairs each hour's rain chance with sky cover for the same hour, in seconds", () => {
    const periods = [period(0, 0), period(1, 38)];
    const skyCover = [{ start: START + HOUR, value: 80 }, { start: START, value: 57 }];
    expect(nwsChartData(periods, skyCover, START)).toEqual({
      times: [START / 1000, (START + HOUR) / 1000],
      rain: [0, 38],
      cloud: [57, 80],
    });
  });

  it("drops ended hours and stops at 48", () => {
    const periods = Array.from({ length: 60 }, (_, i) => period(i, 10));
    const data = nwsChartData(periods, null, START + 2 * HOUR);
    expect(data.times).toHaveLength(CHART_HOURS);
    expect(data.times[0]).toBe((START + 2 * HOUR) / 1000);
  });

  it("leaves gaps (null) where sky cover or rain chance is missing", () => {
    const periods = [{ ...period(0, null) }];
    expect(nwsChartData(periods, null, START)).toEqual({ times: [START / 1000], rain: [null], cloud: [null] });
  });
});

describe("openMeteoChartData", () => {
  it("reads rain chance and cloud cover off the normalized rows", () => {
    const rows = [{ start: START, precipProbability: 35, cloudCover: 95 }];
    expect(openMeteoChartData(rows)).toEqual({ times: [START / 1000], rain: [35], cloud: [95] });
  });
});

describe("decidedHour", () => {
  it("marks the deciding hour only for an hourly basis", () => {
    expect(decidedHour({ basis: { source: "hourly", time: "2026-10-02T14:00:00-04:00" } })).toBe(Date.parse("2026-10-02T18:00:00Z") / 1000);
    expect(decidedHour({ basis: { source: "hourly", time: START } })).toBe(START / 1000);
    expect(decidedHour({ basis: { source: "extended", name: "Thursday" } })).toBeNull();
    expect(decidedHour({ basis: null })).toBeNull();
    expect(decidedHour(null)).toBeNull();
  });
});
