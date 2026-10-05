// Collapsed-by-default privacy note at the bottom of the page. Native
// <details>/<summary>, so no state. The text is only accurate while the app
// has no cookies or analytics and stores data only in localStorage /
// sessionStorage -- see SOUP_PLAN.md #29 before changing either.
export function PrivacyNote() {
  return (
    <details className="card privacy-note">
      <summary className="privacy-note-summary">Privacy</summary>
      <div className="privacy-note-body">
        <p>SOUPCON doesn&apos;t use cookies, analytics, or ads.</p>
        <p>
          What&apos;s stored in your browser: your last lookup (ZIP code, city, or location method), today&apos;s
          soup of the day, plus short-lived cached results so repeat lookups are faster. This stays on your
          device and is never sent to us. You can clear it any time in your browser&apos;s site settings.
        </p>
        <p>
          What&apos;s sent to others: when you enter a US ZIP, it&apos;s sent to Zippopotam.us to find
          coordinates. When you search for a city outside the US, your search is sent to Open-Meteo.
          Coordinates are then sent to the National Weather Service (api.weather.gov), which provides the
          forecast and alerts for US locations. For places it doesn&apos;t cover, the coordinates are sent to
          Open-Meteo instead. If you use your browser location outside the US, your coordinates are also sent
          to BigDataCloud to look up a place name. All of these services can see your IP address, and some are
          outside your country (the National Weather Service and Cloudflare are in the US). The site is
          delivered through Cloudflare, which also handles your connection.
        </p>
        <p>
          Location: if you tap &quot;Use Browser Location&quot;, the app asks your browser for your position. If
          that&apos;s how you looked up last time, it may ask again when you return. Your browser lets you allow
          or block this at any time.
        </p>
        <p>
          Questions about privacy:{" "}
          <a href="mailto:contact@soupcon.org" className="contact-link">
            contact@soupcon.org
          </a>
          .
        </p>
      </div>
    </details>
  );
}
