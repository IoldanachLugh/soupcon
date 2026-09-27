export function SoupconBadge({ level }) {
  const validLevel = [1, 2, 3, 4, 5].includes(level) ? level : 5;

  return <span className={`soupcon-badge soupcon-badge--level-${validLevel}`}>SOUPCON {validLevel}</span>;
}
