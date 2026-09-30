import { describe, it, expect } from "vitest";
import { describeWmoCode } from "./wmoCodes";

describe("describeWmoCode", () => {
  it("labels codes in plain language", () => {
    expect(describeWmoCode(61).label).toBe("Slight rain");
    expect(describeWmoCode(3).label).toBe("Overcast");
    expect(describeWmoCode(95).label).toBe("Thunderstorm");
  });

  it.each([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99])("code %i is rain", (code) => {
    expect(describeWmoCode(code).precipType).toBe("rain");
  });

  it.each([71, 73, 75, 77, 85, 86])("code %i is snow", (code) => {
    expect(describeWmoCode(code).precipType).toBe("snow");
  });

  it("treats freezing rain and freezing drizzle as rain, like the NWS text path", () => {
    for (const code of [56, 57, 66, 67]) expect(describeWmoCode(code).precipType).toBe("rain");
  });

  it("counts overcast and fog as cloudy but not partly cloudy or clear skies", () => {
    for (const code of [3, 45, 48]) expect(describeWmoCode(code).cloudy).toBe(true);
    for (const code of [0, 1, 2]) expect(describeWmoCode(code).cloudy).toBe(false);
  });

  it("shows an unknown code plainly instead of guessing", () => {
    expect(describeWmoCode(123)).toEqual({ label: "Weather code 123", precipType: null, cloudy: false });
  });
});
