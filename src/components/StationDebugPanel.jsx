import { useEffect, useState } from "react";
import { getStationReadings } from "../lib/weatherApi";
import { periodPrecipType, observationPrecipType } from "../lib/soupcon";

// "Sources" panel under the alerts: the raw NWS data
// classifySoupcon works from, so a surprising condition can be traced to
// the reading behind it. Same ended-period filtering as the classifier.
const HOURLY_ROWS = 12;
const EXTENDED_ROWS = 4;

function timeLabel(iso) {
  const t = Date.parse(iso);
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

export function StationDebugPanel({ result }) {
  const [open, setOpen] = useState(false);
  const [readings, setReadings] = useState(null);
  const [readingsError, setReadingsError] = useState("");

  // Station readings cost one request per candidate station, so they're
  // only fetched while the panel is open (and refetched when the main data
  // refreshes, so they match what's on screen).
  useEffect(() => {
    if (!open) return undefined;
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
  }, [open, result.lat, result.lon, result.fetchedAt]);

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

      {open ? (
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
