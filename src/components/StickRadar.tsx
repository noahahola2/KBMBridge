import React, { useEffect, useRef, useState } from "react";

interface Props {
  x: number;
  y: number;
  antiDeadzone: number;
  maxOutput: number;
}

export const StickRadar: React.FC<Props> = ({
  x,
  y,
  antiDeadzone,
  maxOutput,
}) => {
  const [trail, setTrail] = useState<[number, number][]>([]);
  const lastRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    const [lx, ly] = lastRef.current;
    if (Math.hypot(x - lx, y - ly) > 0.005 || Math.hypot(x, y) > 0.01) {
      lastRef.current = [x, y];
      setTrail((prev) => [...prev.slice(-24), [x, y]]);
    } else if (trail.length > 0 && Math.hypot(x, y) <= 0.01) {
      setTrail((prev) => prev.slice(2));
    }
  }, [x, y]);

  const size = 196;
  const c = size / 2;
  const R = 76;
  const px = c + x * R;
  const py = c - y * R;

  const trailPath =
    trail.length > 1
      ? trail
          .map(([tx, ty], i) => `${i === 0 ? "M" : "L"} ${(c + tx * R).toFixed(1)} ${(c - ty * R).toFixed(1)}`)
          .join(" ")
      : "";

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{
        width: "100%",
        maxWidth: 196,
        height: "auto",
        background: "#12101a",
        borderRadius: 9,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Crosshair */}
      <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="#242034" strokeWidth="1" />
      <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="#242034" strokeWidth="1" />

      {/* Outer boundary */}
      <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" />

      {/* Outer cap */}
      {maxOutput < 0.995 && (
        <circle
          cx={c}
          cy={c}
          r={R * maxOutput}
          fill="none"
          stroke="#f87171"
          strokeDasharray="3 3"
          strokeWidth="1"
          opacity="0.65"
        />
      )}

      {/* Anti-deadzone ring */}
      {antiDeadzone > 0.005 && (
        <circle
          cx={c}
          cy={c}
          r={R * antiDeadzone}
          fill="rgba(251, 191, 36, 0.07)"
          stroke="#fbbf24"
          strokeDasharray="3 3"
          strokeWidth="1"
          opacity="0.7"
        />
      )}

      {/* Recent motion trail */}
      {trailPath && (
        <path
          d={trailPath}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.45"
        />
      )}

      {/* Active position */}
      <line x1={c} y1={c} x2={px} y2={py} stroke="#8b5cf6" strokeWidth="1.6" opacity="0.7" />
      <circle cx={px} cy={py} r="5.5" fill="#8b5cf6" stroke="#ffffff" strokeWidth="1.5" />
    </svg>
  );
};
