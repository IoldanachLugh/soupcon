import { describe, it, expect } from "vitest";
import { normalizeOpenMeteo, classifyOpenMeteo, currentPrecipType, cloudBlocks, CLOUDY_BLOCK_MIN_COVER } from "./soupconOpenMeteo";
import { classifySoupcon } from "./soupcon";

const HOUR_S = 3600;
const NOW_S = 1790785800; // an arbitrary "now", in unix seconds
const NOW = NOW_S * 1000;
const START_S = NOW_S - (NOW_S % HOUR_S); // start of the current hour

// Builds a raw Open-Meteo response with 48 hourly rows starting at the
// current hour. `hourCodes`/`hourCover` override individual hours by index.
function raw({ current = {}, hourCodes = {}, hourCover = {}, baseCode = 0, baseCover = 10 } = {}) {
  const hours = 48;
  return {
    current: {
      time: NOW_S,
      interval: 900,
      weather_code: 0,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      cloud_cover: 10,
      ...current,
    },
    hourly: {
      time: Array.from({ length: hours }, (_, i) => START_S + i * HOUR_S),
      weather_code: Array.from({ length: hours }, (_, i) => hourCodes[i] ?? baseCode),
      precipitation_probability: Array.from({ length: hours }, () => 5),
      precipitation: Array.from({ length: hours }, () => 0),
      cloud_cover: Array.from({ length: hours }, (_, i) => hourCover[i] ?? baseCover),
    },
    daily: {
      time: [START_S - (START_S % 86400)],
      weather_code: [61],
      precipitation_probability_max: [60],
      precipitation_sum: [1.2],
    },
  };
}

const classify = (rawResponse, now = NOW) => classifyOpenMeteo({ forecast: normalizeOpenMeteo(rawResponse), now });

describe("normalizeOpenMeteo", () => {
  it("flattens parallel arrays into rows with ms times, end times and readable labels", () => {
    const { current, hourly, daily } = normalizeOpenMeteo(raw({ hourCodes: { 1: 63 }, hourCover: { 1: 90 } }));
    expect(hourly).toHaveLength(48);
    expect(hourly[0].start).toBe(START_S * 1000);
    expect(hourly[0].end).toBe(START_S * 1000 + 3600000);
    expect(hourly[1]).toMatchObject({ code: 63, label: "Moderate rain", precipType: "rain", cloudCover: 90, precipProbability: 5 });
    expect(daily[0]).toMatchObject({ label: "Slight rain", precipProbabilityMax: 60, precipitation: 1.2 });
    expect(daily[0].end - daily[0].start).toBe(86400000);
    expect(current).toMatchObject({ time: NOW, label: "Clear sky", precipType: null });
  });
});

describe("currentPrecipType", () => {
  it("reads measured snowfall as snow, ahead of rain amounts", () => {
    expect(currentPrecipType({ snowfall: 0.2, rain: 0.1 })).toBe("snow");
  });
  it("reads rain or showers amounts as rain", () => {
    expect(currentPrecipType({ rain: 0.3 })).toBe("rain");
    expect(currentPrecipType({ showers: 0.3 })).toBe("rain");
  });
  it("falls back to the code, then to a bare precipitation amount", () => {
    expect(currentPrecipType({ precipType: "snow" })).toBe("snow");
    expect(currentPrecipType({ precipitation: 0.4 })).toBe("rain");
    expect(currentPrecipType({ precipitation: 0 })).toBe(null);
  });
});

describe("classifyOpenMeteo", () => {
  it("level 1: raining now, from the amounts or from the code alone", () => {
    expect(classify(raw({ current: { rain: 0.4 } }))).toMatchObject({ level: 1, precipType: "rain" });
    expect(classify(raw({ current: { weather_code: 63 } }))).toMatchObject({ level: 1, precipType: "rain" });
  });

  it("level 1 snow: snowing now", () => {
    expect(classify(raw({ current: { snowfall: 0.5, weather_code: 73 } }))).toMatchObject({ level: 1, precipType: "snow" });
  });

  it("level 2: precipitation in the next 12 hours", () => {
    expect(classify(raw({ hourCodes: { 11: 61 } }))).toMatchObject({ level: 2, precipType: "rain", label: "SOUPCON2" });
  });

  it("level 3: precipitation in hours 12-47, not before", () => {
    expect(classify(raw({ hourCodes: { 12: 80 } }))).toMatchObject({ level: 3, precipType: "rain" });
    expect(classify(raw({ hourCodes: { 47: 85 } }))).toMatchObject({ level: 3, precipType: "snow" });
  });

  it("treats freezing rain as rain, not snow", () => {
    expect(classify(raw({ hourCodes: { 3: 66 } }))).toMatchObject({ level: 2, precipType: "rain" });
  });

  it("level 4: any hour of overcast or fog in the 48 hours", () => {
    expect(classify(raw({ hourCodes: { 30: 3 } })).level).toBe(4);
    expect(classify(raw({ hourCodes: { 5: 45 } })).level).toBe(4);
  });

  it("level 4: a block whose average cloud cover reaches the threshold, but not one just under it", () => {
    const cover = (value) => ({ baseCover: value });
    expect(classify(raw(cover(CLOUDY_BLOCK_MIN_COVER))).level).toBe(4);
    expect(classify(raw(cover(CLOUDY_BLOCK_MIN_COVER - 1))).level).toBe(5);
  });

  it("averages cloud cover per 12-hour block, so one cloudy hour does not make a cloudy block", () => {
    expect(classify(raw({ hourCover: { 4: 100 } })).level).toBe(5);
  });

  it("level 5: clear, mainly clear and partly cloudy skies", () => {
    expect(classify(raw({ baseCode: 0, baseCover: 5 })).level).toBe(5);
    expect(classify(raw({ baseCode: 2, baseCover: 40 })).level).toBe(5);
  });

  it("ignores hours that already ended", () => {
    // Hour 0 has rain, but the lookup is really 2 hours into the series.
    const response = raw({ hourCodes: { 0: 61, 1: 61 } });
    expect(classify(response, (START_S + 2 * HOUR_S) * 1000 + 1).level).toBe(5);
  });

  it("does not use the precipitation probability, which is display-only", () => {
    const response = raw();
    response.hourly.precipitation_probability = response.hourly.precipitation_probability.map(() => 90);
    expect(classify(response).level).toBe(5);
  });

  // Everything but `basis`, which names each provider's own reading.
  it("returns exactly what classifySoupcon does for the same level", () => {
    const withoutBasis = ({ basis, ...rest }) => rest; // eslint-disable-line no-unused-vars
    const rainy = classify(raw({ hourCodes: { 2: 61 } }));
    const nws = classifySoupcon({
      hourlyPeriods: [{ shortForecast: "Rain", endTime: "2999-01-01T00:00:00Z" }],
      observation: { textDescription: "Clear" },
      now: 0,
    });
    expect(withoutBasis(rainy)).toEqual({ ...withoutBasis(nws), level: 2, label: "SOUPCON2", title: "Rain is on its way", reason: "Rain is expected within the next 12 hours." });
    expect(withoutBasis(classify(raw({ baseCode: 3 })))).toEqual(
      withoutBasis(classifySoupcon({ extendedPeriods: [{ shortForecast: "Cloudy", endTime: "2999-01-01T00:00:00Z" }], now: 0 }))
    );
  });

  it("records the reading that decided the level as its basis", () => {
    expect(classify(raw({ current: { rain: 0.4, weather_code: 61 } })).basis).toMatchObject({ source: "current", time: NOW, text: "Slight rain" });
    expect(classify(raw({ hourCodes: { 30: 61 } })).basis).toMatchObject({ source: "hourly", time: (START_S + 30 * HOUR_S) * 1000, text: "Slight rain", probability: 5 });
    expect(classify(raw({ hourCodes: { 13: 3 } })).basis).toMatchObject({ source: "block", time: (START_S + 12 * HOUR_S) * 1000, text: "overcast or fog hour" });
    expect(classify(raw({ baseCover: 90 })).basis).toMatchObject({ source: "block", text: "average cloud cover 90%" });
    expect(classify(raw()).basis).toBeNull();
  });
});

describe("cloudBlocks", () => {
  const blocks = (response) => cloudBlocks(normalizeOpenMeteo(response).hourly);

  it("splits 48 hours into four blocks and says why each is cloudy", () => {
    const result = blocks(raw({ hourCodes: { 13: 3 }, hourCover: { 24: 100, 25: 100, 26: 100, 27: 100, 28: 100, 29: 100, 30: 100, 31: 100, 32: 100, 33: 100, 34: 100, 35: 100 } }));
    expect(result).toHaveLength(4);
    expect(result.map((block) => block.cloudy)).toEqual([false, true, true, false]);
    expect(result[1].hasCloudyCode).toBe(true);
    expect(result[2]).toMatchObject({ averageCover: 100, hasCloudyCode: false });
  });

  it("agrees with the classifier: any cloudy block means level 4", () => {
    const response = raw({ hourCodes: { 40: 45 } });
    expect(blocks(response).some((block) => block.cloudy)).toBe(true);
    expect(classify(response).level).toBe(4);
  });

  it("returns fewer blocks for a short series and none for an empty one", () => {
    expect(cloudBlocks(normalizeOpenMeteo(raw()).hourly.slice(0, 14))).toHaveLength(2);
    expect(cloudBlocks([])).toEqual([]);
  });
});

describe("normalizeOpenMeteo timezone", () => {
  it("carries the location's time zone for labeling days", () => {
    expect(normalizeOpenMeteo({ ...raw(), timezone: "Asia/Tokyo" }).timezone).toBe("Asia/Tokyo");
    expect(normalizeOpenMeteo(raw()).timezone).toBe(null);
  });
});
