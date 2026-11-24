import React, { useRef, useState } from "react";
import { AimSettings } from "../types";

interface Props {
  aim: AimSettings;
  onChangePoints: (pts: [number, number][]) => void;
}

function evalCustom(pts: [number, number][], x: number): number {
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 2) return x;
  if (x <= sorted[0][0]) return sorted[0][1];
  if (x >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / Math.max(1e-5, x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return x;
}

export const CurveEditor: React.FC<Props> = ({ aim, onChangePoints }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const W = 220;
  const H = 196;
  const pad = 20;
  const iw = W - pad * 2;
  const ih = H - pad * 2;

  const toX = (u: number) => pad + u * iw;
  const toY = (v: number) => H - pad - v * ih;

  const sampleStick = (u: number): number => {
    if (u <= 0.001) return 0;
    const base =
      aim.curve_mode === "Exponent"
        ? Math.pow(u, Math.max(0.2, Math.min(4.0, aim.exponent)))
        : evalCustom(aim.curve_points, u);
    const boost = Math.max(0, Math.min(0.45, aim.boost));
    const shaped = Math.min(1, boost + (1 - boost) * base);
    const adz = Math.max(0, Math.min(0.65, aim.anti_deadzone));
    const maxOut = Math.max(0.05, Math.min(1, aim.max_output));
    const usable = Math.max(0.05, maxOut - adz);
    return Math.min(maxOut, adz + usable * shaped);
  };

  const pathD = (() => {
    const steps = 64;
    let d = `M ${toX(0).toFixed(1)} ${toY(sampleStick(0.002)).toFixed(1)}`;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const v = sampleStick(u);
      d += ` L ${toX(u).toFixed(1)} ${toY(v).toFixed(1)}`;
    }
    return d;
  })();

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIdx === null || aim.curve_mode !== "Custom" || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    const u = Math.max(0.02, Math.min(0.98, (px - pad) / iw));
    const v = Math.max(0, Math.min(1, (H - pad - py) / ih));
    const next = aim.curve_points.map((p, i) =>
      i === dragIdx ? ([Number(u.toFixed(2)), Number(v.toFixed(2))] as [number, number]) : p
    );
    next.sort((a, b) => a[0] - b[0]);
    onChangePoints(next);
  };

  const adzY = toY(aim.anti_deadzone);
  const maxY = toY(aim.max_output);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%",
        height: "auto",
        background: "#12101a",
        borderRadius: 9,
        border: "1px solid rgba(255,255,255,0.08)",
        touchAction: "none",
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragIdx(null)}
      onPointerLeave={() => setDragIdx(null)}
    >
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={toX(g)} y1={pad} x2={toX(g)} y2={H - pad} stroke="#1f1c2e" strokeWidth="1" />
          <line x1={pad} y1={toY(g)} x2={W - pad} y2={toY(g)} stroke="#1f1c2e" strokeWidth="1" />
        </g>
      ))}

      {/* Anti-deadzone floor */}
      <rect x={pad} y={adzY} width={iw} height={H - pad - adzY} fill="rgba(251, 191, 36, 0.06)" />
      <line x1={pad} y1={adzY} x2={W - pad} y2={adzY} stroke="#fbbf24" strokeDasharray="3 3" strokeWidth="1" opacity="0.65" />

      {/* Outer cap */}
      {aim.max_output < 0.995 && (
        <line x1={pad} y1={maxY} x2={W - pad} y2={maxY} stroke="#f87171" strokeDasharray="3 3" strokeWidth="1" opacity="0.6" />
      )}

      {/* Linear reference */}
      <line x1={toX(0)} y1={toY(0)} x2={toX(1)} y2={toY(1)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" strokeWidth="1" />

      {/* Frame */}
      <rect x={pad} y={pad} width={iw} height={ih} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

      {/* Violet curve */}
      <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="2.3" strokeLinecap="round" />

      {aim.curve_mode === "Custom" &&
        aim.curve_points.map((p, i) => {
          const isEnd = i === 0 || i === aim.curve_points.length - 1;
          return (
            <circle
              key={i}
              cx={toX(p[0])}
              cy={toY(p[1])}
              r={isEnd ? 3.5 : 5.5}
              fill={isEnd ? "#6c6782" : "#a78bfa"}
              stroke="#12101a"
              strokeWidth="2"
              style={{ cursor: isEnd ? "default" : "grab" }}
              onPointerDown={(e) => {
                if (isEnd) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragIdx(i);
              }}
            />
          );
        })}

      <text x={W - pad - 4} y={adzY - 4} textAnchor="end" fontSize="9" fill="#fbbf24">
        DZ {Math.round(aim.anti_deadzone * 100)}%
      </text>
    </svg>
  );
};
