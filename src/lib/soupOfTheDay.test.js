import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pickSoupOfTheDay } from "./soupOfTheDay";

// Real localStorage isn't available under vitest's default (node)
// environment -- see the note in weatherApi.test.js. pickSoupOfTheDay's
// day-boundary caching is the whole point of this module, so (unlike
// weatherApi.test.js, which just accepts every cache read as a miss) this
// stubs in a working in-memory localStorage to actually exercise it.
function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

const RECIPE_A = { title: "Potsticker Soup" };
const RECIPE_B = { title: "Senegalese Chicken Soup" };

describe("pickSoupOfTheDay", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for an empty or missing recipe list", () => {
    expect(pickSoupOfTheDay([])).toBeNull();
    expect(pickSoupOfTheDay(null)).toBeNull();
  });

  it("picks the recipe selected by the injected random function", () => {
    const chosen = pickSoupOfTheDay([RECIPE_A, RECIPE_B], { random: () => 0 });
    expect(chosen).toBe(RECIPE_A);
  });

  it("caches the pick for the rest of the same local day", () => {
    const now = new Date(2026, 8, 28, 9, 0, 0);
    const first = pickSoupOfTheDay([RECIPE_A, RECIPE_B], { now, random: () => 0 });
    expect(first).toBe(RECIPE_A);

    // Later the same day, a different random draw should still return the
    // cached pick rather than re-rolling.
    const laterSameDay = new Date(2026, 8, 28, 23, 59, 0);
    const random2 = vi.fn(() => 0.5); // would pick RECIPE_B if it re-rolled
    const second = pickSoupOfTheDay([RECIPE_A, RECIPE_B], { now: laterSameDay, random: random2 });
    expect(second).toBe(RECIPE_A);
    expect(random2).not.toHaveBeenCalled();
  });

  it("picks again once local midnight has passed", () => {
    const day1 = new Date(2026, 8, 28, 23, 59, 0);
    pickSoupOfTheDay([RECIPE_A, RECIPE_B], { now: day1, random: () => 0 });

    const day2 = new Date(2026, 8, 29, 0, 0, 1);
    const secondDayPick = pickSoupOfTheDay([RECIPE_A, RECIPE_B], { now: day2, random: () => 0.5 });
    expect(secondDayPick).toBe(RECIPE_B);
  });

  it("falls back to a fresh pick if the cached title no longer exists in the recipe list", () => {
    const now = new Date(2026, 8, 28, 9, 0, 0);
    localStorage.setItem(
      "soupcon_soup_of_the_day",
      JSON.stringify({ date: "2026-09-28", title: "Some Deleted Recipe" })
    );
    const result = pickSoupOfTheDay([RECIPE_A, RECIPE_B], { now, random: () => 0.5 });
    expect(result).toBe(RECIPE_B);
  });

  it("still returns a pick if localStorage access throws", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    const result = pickSoupOfTheDay([RECIPE_A, RECIPE_B], { random: () => 0 });
    expect(result).toBe(RECIPE_A);
  });
});
