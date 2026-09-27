export function SoupconMessage({ level, locationLabel, headline, title, lines }) {
  return (
    <div className="soupcon-condition-status">
      <div className="soupcon-condition-headline">
        {headline} - {locationLabel} is currently at Soup Condition #{level}.
      </div>
      <div className="soupcon-condition-title">{title}</div>
      {lines.map((line, index) => (
        <p key={index} className="soupcon-condition-line">
          {line}
        </p>
      ))}
      <p className="soupcon-footnote">
        * #SOUPCON only estimates whether rain is likely to disrupt your day where you live. It
        does not measure total rainfall, storm severity, or anything outside this 5-level
        rain-likelihood scale.
      </p>
    </div>
  );
}
