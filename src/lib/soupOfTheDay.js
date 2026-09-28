// Picks one recipe at random to feature as "today's soup," cached until
// local midnight (not a rolling TTL like cache.js's other entries -- this
// needs to flip over at the calendar day boundary specifically, however
// long that is from the last pick).
const STORAGE_KEY = "soupcon_soup_of_the_day";

function localDateString(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function pickSoupOfTheDay(recipes, { now = new Date(), random = Math.random } = {}) {
  if (!recipes || recipes.length === 0) return null;

  const today = localDateString(now);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.date === today) {
        const match = recipes.find((recipe) => recipe.title === cached.title);
        if (match) return match;
      }
    }
  } catch {
    // Fall through and pick fresh -- same best-effort treatment cache.js
    // gives a corrupt/inaccessible localStorage entry.
  }

  const chosen = recipes[Math.floor(random() * recipes.length)];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, title: chosen.title }));
  } catch {
    // Ignore storage failures (private browsing, blocked site data, etc.)
    // -- worst case, today's pick isn't remembered and a later call in the
    // same session re-rolls it.
  }

  return chosen;
}
