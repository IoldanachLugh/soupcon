# SOUPCON — Soup Conditions

SOUPCON checks the National Weather Service (NWS) forecast and current
conditions for your location (or, outside the US, the Open-Meteo forecast) and
translates them into a **Soup Condition**
level: a tongue-in-cheek 1-5 scale for "should I make soup and stay home
today?"

The live app is at <https://soupcon.org/>. It is a client-side web app: the
forecast lookup runs in the visitor's browser (by browser geolocation, US ZIP
code, or a city search in another country), so there is no server-side API to call.

## The scale

| Level | Meaning |
|---|---|
| 1 | Currently raining |
| 2 | Rain expected in the next 12 hours |
| 3 | Rain expected in the next 48 hours |
| 4 | Cloudy and damp, no rain expected soon |
| 5 | Clear and sunny for the next several days |

The most urgent condition that applies sets the level — currently raining
always wins over rain later, which wins over no rain expected at all.

## Data sources

- [api.weather.gov](https://www.weather.gov/documentation/services-web-api) — hourly forecast, extended forecast, current observations, and (for the Sources chart) hourly sky cover
- [api.open-meteo.com](https://open-meteo.com/) — forecast for locations outside NWS coverage
- [geocoding-api.open-meteo.com](https://open-meteo.com/en/docs/geocoding-api) — city search outside the US
- [api.bigdatacloud.net](https://www.bigdatacloud.com/) — place name for a non-US browser-location lookup
- [api.zippopotam.us](https://www.zippopotam.us/) — ZIP code to coordinates
