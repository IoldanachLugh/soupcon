import { useEffect, useState } from "react";
import { getStationReadings } from "../lib/weatherApi";
import { periodPrecipType, observationPrecipType } from "../lib/soupcon";
import { PROVIDER_OPEN_METEO } from "../lib/weatherProvider";
import { cloudBlocks, currentPrecipType, upcomingRows, CLOUDY_BLOCK_MIN_COVER } from "../lib/soupconOpenMeteo";

// "Sources" panel under the alerts: the raw data the classifier works from,
// so a surprising condition can be traced to the reading behind it. Same
// ended-period filtering as the classifier. NWS lookups show station
// observations plus the hourly/extended forecast periods; Open-Meteo
// (non-US) lookups have no stations, so they show the current model values,
// the hourly rows, the 12-hour cloud blocks the level 4 vs. 5 split uses,
// and the daily outlook.
const HOURLY_ROWS = 12;
const EXTENDED_ROWS = 4;

function timeLabel(value) {
  const t = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(t) ? "?" : new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ageLabel(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "?";
  return `${Math.round((Date.now() - t) / 60000)} min ago`;
}

function upcoming(periods, count) {
  const now = Date.now();
  return (periods || [])
    .filter((period) => {
      const end = Date.parse(period?.endTime);
      return Number.isNaN(end) || end > now;
    })
    .slice(0, count);
}

// Days are labeled in the looked-up place's own time zone (Open-Meteo's
// daily rows start at that place's local midnight), not the viewer's.
function dayLabel(ms, timeZone) {
  try {
    return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: timeZone || undefined });
  } catch {
    return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }
}

function percent(value) {
  return typeof value === "number" ? `${Math.round(value)}%` : "n/a";
}

export function OpenMeteoSources({ forecast }) {
  const { current } = forecast;
  const hourly = upcomingRows(forecast.hourly);
  const blocks = cloudBlocks(hourly);
  const currentType = currentPrecipType(current);

  return (
    <div className="nws-alert-card">
      <h3 className="station-debug-header">Current conditions (model estimate)</h3>
      <p className="nws-alert-area-desc">
        There are no weather stations outside the US; Open-Meteo's own estimate wins level 1. Used for level 1:{" "}
        <strong>
          {current?.label ?? "(none)"} ({currentType || "no precip"})
        </strong>
        {current
          ? ` - rain ${current.rain ?? "n/a"} mm, showers ${current.showers ?? "n/a"} mm, snowfall ${current.snowfall ?? "n/a"} cm, cloud cover ${percent(current.cloudCover)}, as of ${timeLabel(current.time)}`
          : ""}
      </p>

      <h3 className="station-debug-header">Hourly forecast (next {HOURLY_ROWS})</h3>
      <ul className="station-debug-list">
        {hourly.slice(0, HOURLY_ROWS).map((row) => (
          <li key={row.start}>
            {timeLabel(row.start)} - {row.label}, cloud cover {percent(row.cloudCover)}, precip chance {percent(row.precipProbability)}
            {row.precipType ? ` [${row.precipType}]` : ""}
          </li>
        ))}
      </ul>

      <h3 className="station-debug-header">Cloud cover by 12-hour block (next 48 hours)</h3>
      <p className="nws-alert-area-desc">
        Decides level 4 vs. 5: a block is cloudy if it has an overcast or fog hour, or its average cover is at least {CLOUDY_BLOCK_MIN_COVER}%.
      </p>
      <ul className="station-debug-list">
        {blocks.map((block) => (
          <li key={block.start}>
            {timeLabel(block.start)} to {timeLabel(block.end)} - average cover {percent(block.averageCover)} -{" "}
            {block.cloudy
              ? block.hasCloudyCode
                ? "cloudy (overcast or fog hour)"
                : "cloudy (high average cover)"
              : "not cloudy"}
          </li>
        ))}
      </ul>

      <h3 className="station-debug-header">Daily outlook (display only, not used for the score)</h3>
      <ul className="station-debug-list">
        {forecast.daily.map((day) => (
          <li key={day.start}>
            {dayLabel(day.start, forecast.timezone)} - {day.label}, max precip chance {percent(day.precipProbabilityMax)}, precipitation{" "}
            {day.precipitation ?? "n/a"} mm
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StationDebugPanel({ result }) {
  const isOpenMeteo = result.provider === PROVIDER_OPEN_METEO;
  const [open, setOpen] = useState(false);
  const [readings, setReadings] = useState(null);
  const [readingsError, setReadingsError] = useState("");

  // Station readings cost one request per candidate station, so they're
  // only fetched while the panel is open (and refetched when the main data
  // refreshes, so they match what's on screen).
  useEffect(() => {
    if (!open || isOpenMeteo) return undefined;
    const controller = new AbortController();
    getStationReadings(result.lat, result.lon, { signal: controller.signal })
      .then((next) => {
        setReadings(next);
        setReadingsError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setReadingsError(`Could not load stations: ${err.message}`);
      });
    return () => controller.abort();
  }, [open, isOpenMeteo, result.lat, result.lon, result.fetchedAt]);

  const hourly = upcoming(result.hourlyPeriods, HOURLY_ROWS);
  const extended = upcoming(result.extendedPeriods, EXTENDED_ROWS);
  const chosen = readings?.find((reading) => reading.chosen);

  return (
    <div className="station-debug">
      <button
        type="button"
        className="station-debug-toggle active-alerts-heading"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        Sources <span aria-hidden="true">{open ? "\u2212" : "+"}</span>
      </button>

      {open && isOpenMeteo ? <OpenMeteoSources forecast={result.openMeteo} /> : null}

      {open && !isOpenMeteo ? (
        <div className="nws-alert-card">
          <h3 className="station-debug-header">Station observations</h3>
          <p className="nws-alert-area-desc">
            Nearest usable reading wins level 1. Used for level 1:{" "}
            {result.observation ? (
              <strong>
                {result.observation.textDescription || "(no description)"} ({observationPrecipType(result.observation) || "no precip"})
              </strong>
            ) : (
              <strong>none, using the hourly forecast</strong>
            )}
          </p>
          {readingsError ? <p className="nws-alert-description">{readingsError}</p> : null}
          {!readings && !readingsError ? <p className="nws-alert-description">Loading stations...</p> : null}
          {readings ? (
            <ul className="station-debug-list">
              {readings.map((reading) => (
                <li key={reading.stationId} className={reading.chosen ? "station-debug-chosen" : undefined}>
                  <strong>{reading.stationId}</strong>{" "}
                  {Number.isFinite(reading.miles) ? `${reading.miles.toFixed(1)} mi` : "distance unknown"}
                  {" - "}
                  {reading.error
                    ? reading.error
                    : `${reading.textDescription || "(blank)"}, precip last hr ${reading.precipitationLastHour ?? "n/a"}, ${
                        reading.timestamp ? `${timeLabel(reading.timestamp)} (${ageLabel(reading.timestamp)})` : "no timestamp"
                      }`}
                  {" - "}
                  {reading.chosen ? "USED" : reading.usable ? "usable, not nearest" : "skipped (stale or blank)"}
                </li>
              ))}
            </ul>
          ) : null}
          {chosen ? null : readings ? <p className="nws-alert-description">No usable station reading.</p> : null}

          <h3 className="station-debug-header">Hourly forecast (next {HOURLY_ROWS})</h3>
          <ul className="station-debug-list">
            {hourly.map((period) => (
              <li key={period.startTime}>
                {timeLabel(period.startTime)} - {period.shortForecast}, {period.probabilityOfPrecipitation?.value ?? "n/a"}%
                {periodPrecipType(period) ? ` [${periodPrecipType(period)}]` : ""}
              </li>
            ))}
          </ul>

          <h3 className="station-debug-header">Extended forecast (next {EXTENDED_ROWS} periods)</h3>
          <ul className="station-debug-list">
            {extended.map((period) => (
              <li key={period.startTime}>
                {period.name} - {period.shortForecast}
                {periodPrecipType(period) ? ` [${periodPrecipType(period)}]` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
