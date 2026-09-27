import React, { useMemo } from "react";

export const RainOverlay = React.memo(function RainOverlay({ count }) {
  // Drop positions/timings only depend on `count`, so recompute them just
  // when the count actually changes rather than on every App re-render.
  const drops = useMemo(() => {
    return Array.from({ length: count }, (_, index) => ({
      id: index,
      left: `${(index * 9973) % 100}%`,
      length: 14 + ((index * 7) % 16),
      duration: 0.6 + ((index * 13) % 10) / 10,
      delay: -(((index * 17) % 15) / 10),
      opacity: 0.25 + (((index * 19) % 60) / 100),
    }));
  }, [count]);

  return (
    <div className="precip-overlay" aria-hidden="true">
      {drops.map((drop) => (
        <span
          key={drop.id}
          style={{
            position: "absolute",
            top: "-20px",
            left: drop.left,
            width: "2px",
            height: `${drop.length}px`,
            opacity: drop.opacity,
            background: "linear-gradient(to bottom, rgba(180,210,255,0), rgba(180,210,255,0.9))",
            animation: `rainFall ${drop.duration}s linear ${drop.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
});
