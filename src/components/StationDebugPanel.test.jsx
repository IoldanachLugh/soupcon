import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenMeteoSources } from "./StationDebugPanel";
import { normalizeOpenMeteo } from "../lib/soupconOpenMeteo";

// Renders the Open-Meteo "Sources" content to static HTML (the project has no
// DOM test setup) to catch runtime errors and check the readable text.
const H = 3600;
const START_S = Math.floor(Date.now() / 1000 / H) * H;
const raw = {
  timezone: "Europe/London",
  current: { time: START_S, weather_code: 61, precipitation: 0.4, rain: 0.4, showers: 0, snowfall: 0, cloud_cover: 100 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => START_S + i * H),
    weather_code: Array.from({ length: 48 }, (_, i) => (i === 2 ? 63 : 3)),
    precipitation_probability: Array.from({ length: 48 }, () => 35),
    precipitation: Array.from({ length: 48 }, () => 0),
    cloud_cover: Array.from({ length: 48 }, () => 95),
  },
  daily: {
    time: [START_S, START_S + 86400],
    weather_code: [61, 3],
    precipitation_probability_max: [80, 20],
    precipitation_sum: [1.2, 0],
  },
};

describe("OpenMeteoSources", () => {
  it("shows the current reading, hourly rows, cloud blocks and daily outlook in plain language", () => {
    const html = renderToStaticMarkup(<OpenMeteoSources forecast={normalizeOpenMeteo(raw)} />);
    expect(html).toContain("Slight rain (rain)");
    expect(html).toContain("Moderate rain, cloud cover 95%, precip chance 35%");
    expect(html).toContain("[rain]");
    expect(html).toContain("cloudy (overcast or fog hour)");
    expect(html).toContain("max precip chance 80%");
    expect(html).toContain("Overcast");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("copes with a missing current block", () => {
    const html = renderToStaticMarkup(<OpenMeteoSources forecast={normalizeOpenMeteo({ ...raw, current: undefined })} />);
    expect(html).toContain("(none)");
  });
});
