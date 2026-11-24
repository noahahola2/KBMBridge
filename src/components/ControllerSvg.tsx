import React from "react";
import { Binding, ControllerType, formatKey, PadState, Target } from "../types";

interface Props {
  pad: PadState;
  controller: ControllerType;
  active: boolean;
  bindings?: Binding[];
  keyLabels?: Record<string, string>;
  listeningTarget?: Target | null;
  selectedTarget?: Target | null;
  compact?: boolean;
  onClickTarget?: (target: Target) => void;
}

const bit = (b: number, i: number) => (b & (1 << i)) !== 0;

export const ControllerSvg: React.FC<Props> = ({
  pad,
  controller,
  active,
  bindings = [],
  keyLabels = {},
  listeningTarget = null,
  selectedTarget = null,
  compact = false,
  onClickTarget,
}) => {
  const isXbox = controller === "Xbox360";
  const b = pad.buttons;

  const cross = bit(b, 0);
  const circle = bit(b, 1);
  const square = bit(b, 2);
  const triangle = bit(b, 3);
  const l1 = bit(b, 4);
  const r1 = bit(b, 5);
  const l3 = bit(b, 6);
  const r3 = bit(b, 7);
  const share = bit(b, 8);
  const options = bit(b, 9);
  const ps = bit(b, 10);
  const touchpad = bit(b, 11);
  const up = bit(b, 12);
  const down = bit(b, 13);
  const left = bit(b, 14);
  const right = bit(b, 15);

  const on = "#8b5cf6";
  const selCol = "#a78bfa";
  const onSoft = "rgba(139, 92, 246, 0.28)";
  const btnBase = "#232130";
  const btnStroke = "rgba(255, 255, 255, 0.16)";

  const keyFor = (t: Target): string => {
    if (listeningTarget === t) return "…";
    const found = bindings.find((x) => x.target === t);
    return found ? formatKey(found.source, keyLabels) : "";
  };

  const hit = (t: Target) =>
    onClickTarget
      ? {
          className: "ctrl-hit",
          onClick: () => onClickTarget(t),
        }
      : {};

  const isHi = (t: Target, pressed: boolean) =>
    listeningTarget === t || selectedTarget === t || pressed;

  const fillFor = (t: Target, pressed: boolean) =>
    listeningTarget === t ? selCol : pressed ? on : selectedTarget === t ? "#4c1d95" : btnBase;

  const strokeFor = (t: Target, pressed: boolean) =>
    listeningTarget === t || selectedTarget === t ? selCol : pressed ? on : btnStroke;

  const lsCenter = isXbox ? { x: 148, y: 150 } : { x: 192, y: 204 };
  const dpadCenter = isXbox ? { x: 196, y: 210 } : { x: 142, y: 146 };
  const rsCenter = { x: 328, y: 204 };
  const stickMax = 15;

  const lsX = lsCenter.x + pad.lx * stickMax;
  const lsY = lsCenter.y - pad.ly * stickMax;
  const rsX = rsCenter.x + pad.rx * stickMax;
  const rsY = rsCenter.y - pad.ry * stickMax;

  return (
    <div className="controller-stage">
      <svg
        viewBox="0 0 520 320"
        style={{ width: "100%", maxWidth: 440, height: "auto", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="shellMain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isXbox ? "#2d2c38" : "#6c6f7e"} />
            <stop offset="55%" stopColor={isXbox ? "#1f1e28" : "#444755"} />
            <stop offset="100%" stopColor={isXbox ? "#16151d" : "#282a35"} />
          </linearGradient>
          <linearGradient id="gripLower" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b1a23" />
            <stop offset="100%" stopColor="#121118" />
          </linearGradient>
          <linearGradient id="touchPadGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#777b8a" />
            <stop offset="100%" stopColor="#4f5362" />
          </linearGradient>
          <filter id="vGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Analog Triggers (L2 / R2) */}
        <g {...hit("L2")}>
          <title>{isXbox ? "LT" : "L2"} — Click to select</title>
          <rect
            x="108"
            y="14"
            width="68"
            height="20"
            rx="6"
            fill={btnBase}
            stroke={strokeFor("L2", pad.l2 > 0.02)}
            strokeWidth="1.5"
          />
          <rect
            x="108"
            y="14"
            width={68 * Math.min(1, Math.max(0, pad.l2))}
            height="20"
            rx="6"
            fill={on}
            opacity="0.9"
          />
          <text
            x="142"
            y="28"
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#ffffff"
          >
            {isXbox ? "LT" : "L2"}
            {!compact && keyFor("L2") ? ` · ${keyFor("L2")}` : ""}
          </text>
        </g>

        <g {...hit("R2")}>
          <title>{isXbox ? "RT" : "R2"} — Click to select</title>
          <rect
            x="344"
            y="14"
            width="68"
            height="20"
            rx="6"
            fill={btnBase}
            stroke={strokeFor("R2", pad.r2 > 0.02)}
            strokeWidth="1.5"
          />
          <rect
            x={344 + 68 * (1 - Math.min(1, Math.max(0, pad.r2)))}
            y="14"
            width={68 * Math.min(1, Math.max(0, pad.r2))}
            height="20"
            rx="6"
            fill={on}
            opacity="0.9"
          />
          <text
            x="378"
            y="28"
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#ffffff"
          >
            {isXbox ? "RT" : "R2"}
            {!compact && keyFor("R2") ? ` · ${keyFor("R2")}` : ""}
          </text>
        </g>

        {/* Bumpers (L1 / R1) */}
        <g {...hit("L1")}>
          <title>{isXbox ? "LB" : "L1"} — Click to select</title>
          <path
            d="M98 56 C108 43, 152 42, 182 49 L180 65 L98 67 Z"
            fill={fillFor("L1", l1)}
            stroke={strokeFor("L1", l1)}
            strokeWidth="1.4"
            filter={isHi("L1", l1) ? "url(#vGlow)" : undefined}
          />
          <text x="140" y="59" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#e2e8f0">
            {isXbox ? "LB" : "L1"}
          </text>
        </g>

        <g {...hit("R1")}>
          <title>{isXbox ? "RB" : "R1"} — Click to select</title>
          <path
            d="M422 56 C412 43, 368 42, 338 49 L340 65 L422 67 Z"
            fill={fillFor("R1", r1)}
            stroke={strokeFor("R1", r1)}
            strokeWidth="1.4"
            filter={isHi("R1", r1) ? "url(#vGlow)" : undefined}
          />
          <text x="380" y="59" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#e2e8f0">
            {isXbox ? "RB" : "R1"}
          </text>
        </g>

        {/* Outer Controller Shell */}
        <path
          d="M110 68 C134 62, 174 63, 210 68 L310 68 C346 63, 386 62, 410 68 C438 76, 456 108, 466 164 C474 212, 474 274, 444 294 C418 310, 392 292, 372 254 C358 232, 344 226, 316 226 L204 226 C176 226, 162 232, 148 254 C128 292, 102 310, 76 294 C46 274, 46 212, 54 164 C64 108, 82 76, 110 68 Z"
          fill="url(#shellMain)"
          stroke={active ? "rgba(139, 92, 246, 0.45)" : "rgba(255, 255, 255, 0.14)"}
          strokeWidth="1.6"
        />

        {/* Lower matte trim */}
        {!isXbox && (
          <path
            d="M168 182 C192 172, 328 172, 352 182 L368 242 C354 226, 338 225, 314 225 L206 225 C182 225, 166 226, 152 242 Z"
            fill="url(#gripLower)"
            opacity="0.92"
          />
        )}

        {/* Touchpad (PlayStation) or Center Emblem (Xbox) */}
        {!isXbox ? (
          <g {...hit("Touchpad")}>
            <title>Touchpad — Click to select</title>
            <path
              d="M204 72 L316 72 L308 136 C307 142, 302 145, 296 145 L224 145 C218 145, 213 142, 212 136 Z"
              fill={
                listeningTarget === "Touchpad"
                  ? onSoft
                  : touchpad
                  ? onSoft
                  : selectedTarget === "Touchpad"
                  ? "rgba(124, 58, 237, 0.25)"
                  : "url(#touchPadGrad)"
              }
              stroke={strokeFor("Touchpad", touchpad)}
              strokeWidth="1.4"
              filter={isHi("Touchpad", touchpad) ? "url(#vGlow)" : undefined}
            />
            {/* Signature DualSense edge lightbar strips */}
            <line
              x1="205"
              y1="74"
              x2="213"
              y2="138"
              stroke={active ? "#a855f7" : "rgba(167, 139, 250, 0.45)"}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <line
              x1="315"
              y1="74"
              x2="307"
              y2="138"
              stroke={active ? "#a855f7" : "rgba(167, 139, 250, 0.45)"}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        ) : (
          <g {...hit("PS")}>
            <title>Xbox Guide — Click to select</title>
            <circle
              cx="260"
              cy="108"
              r="18"
              fill={fillFor("PS", ps)}
              stroke={strokeFor("PS", ps)}
              strokeWidth="1.6"
              filter={isHi("PS", ps) ? "url(#vGlow)" : undefined}
            />
            <text x="260" y="113" textAnchor="middle" fontSize="13" fontWeight="800" fill="#ffffff">
              X
            </text>
          </g>
        )}

        {/* Share / Options */}
        <g {...hit("Share")}>
          <title>Share / View — Click to select</title>
          <rect
            x={isXbox ? 216 : 184}
            y={isXbox ? 142 : 88}
            width={isXbox ? 22 : 11}
            height={isXbox ? 12 : 22}
            rx="5.5"
            fill={fillFor("Share", share)}
            stroke={strokeFor("Share", share)}
            strokeWidth="1.3"
            filter={isHi("Share", share) ? "url(#vGlow)" : undefined}
          />
        </g>
        <g {...hit("Options")}>
          <title>Options / Menu — Click to select</title>
          <rect
            x={isXbox ? 282 : 325}
            y={isXbox ? 142 : 88}
            width={isXbox ? 22 : 11}
            height={isXbox ? 12 : 22}
            rx="5.5"
            fill={fillFor("Options", options)}
            stroke={strokeFor("Options", options)}
            strokeWidth="1.3"
            filter={isHi("Options", options) ? "url(#vGlow)" : undefined}
          />
        </g>

        {/* PS Home Button */}
        {!isXbox && (
          <g {...hit("PS")}>
            <title>PS Button — Click to select</title>
            <circle
              cx="260"
              cy="192"
              r="11"
              fill={fillFor("PS", ps)}
              stroke={strokeFor("PS", ps)}
              strokeWidth="1.4"
              filter={isHi("PS", ps) ? "url(#vGlow)" : undefined}
            />
          </g>
        )}

        {/* D-Pad */}
        <g transform={`translate(${dpadCenter.x}, ${dpadCenter.y})`}>
          <g {...hit("DpadUp")}>
            <title>D-Pad Up</title>
            <rect x="-10" y="-31" width="20" height="22" rx="4" fill={fillFor("DpadUp", up)} stroke={strokeFor("DpadUp", up)} strokeWidth="1.3" filter={isHi("DpadUp", up) ? "url(#vGlow)" : undefined} />
          </g>
          <g {...hit("DpadDown")}>
            <title>D-Pad Down</title>
            <rect x="-10" y="9" width="20" height="22" rx="4" fill={fillFor("DpadDown", down)} stroke={strokeFor("DpadDown", down)} strokeWidth="1.3" filter={isHi("DpadDown", down) ? "url(#vGlow)" : undefined} />
          </g>
          <g {...hit("DpadLeft")}>
            <title>D-Pad Left</title>
            <rect x="-31" y="-10" width="22" height="20" rx="4" fill={fillFor("DpadLeft", left)} stroke={strokeFor("DpadLeft", left)} strokeWidth="1.3" filter={isHi("DpadLeft", left) ? "url(#vGlow)" : undefined} />
          </g>
          <g {...hit("DpadRight")}>
            <title>D-Pad Right</title>
            <rect x="9" y="-10" width="22" height="20" rx="4" fill={fillFor("DpadRight", right)} stroke={strokeFor("DpadRight", right)} strokeWidth="1.3" filter={isHi("DpadRight", right) ? "url(#vGlow)" : undefined} />
          </g>
          <circle cx="0" cy="0" r="8" fill="#181722" />
        </g>

        {/* Face Buttons */}
        <g transform="translate(378, 146)">
          <g {...hit("Triangle")}>
            <title>{isXbox ? "Y" : "Triangle"}</title>
            <circle cx="0" cy="-27" r="14.5" fill={fillFor("Triangle", triangle)} stroke={strokeFor("Triangle", triangle)} strokeWidth="1.4" filter={isHi("Triangle", triangle) ? "url(#vGlow)" : undefined} />
            <text x="0" y="-22.5" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#f1f5f9">
              {isXbox ? "Y" : "△"}
            </text>
          </g>

          <g {...hit("Cross")}>
            <title>{isXbox ? "A" : "Cross"}</title>
            <circle cx="0" cy="27" r="14.5" fill={fillFor("Cross", cross)} stroke={strokeFor("Cross", cross)} strokeWidth="1.4" filter={isHi("Cross", cross) ? "url(#vGlow)" : undefined} />
            <text x="0" y="31.5" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#f1f5f9">
              {isXbox ? "A" : "✕"}
            </text>
          </g>

          <g {...hit("Square")}>
            <title>{isXbox ? "X" : "Square"}</title>
            <circle cx="-27" cy="0" r="14.5" fill={fillFor("Square", square)} stroke={strokeFor("Square", square)} strokeWidth="1.4" filter={isHi("Square", square) ? "url(#vGlow)" : undefined} />
            <text x="-27" y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#f1f5f9">
              {isXbox ? "X" : "□"}
            </text>
          </g>

          <g {...hit("Circle")}>
            <title>{isXbox ? "B" : "Circle"}</title>
            <circle cx="27" cy="0" r="14.5" fill={fillFor("Circle", circle)} stroke={strokeFor("Circle", circle)} strokeWidth="1.4" filter={isHi("Circle", circle) ? "url(#vGlow)" : undefined} />
            <text x="27" y="4" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#f1f5f9">
              {isXbox ? "B" : "○"}
            </text>
          </g>
        </g>

        {/* Left Stick (L3) */}
        <g {...hit("L3")}>
          <title>Left Stick / L3</title>
          <circle cx={lsCenter.x} cy={lsCenter.y} r="27" fill="#121118" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <line x1={lsCenter.x} y1={lsCenter.y} x2={lsX} y2={lsY} stroke={on} strokeWidth="2" opacity="0.6" />
          <circle
            cx={lsX}
            cy={lsY}
            r="16"
            fill={fillFor("L3", l3)}
            stroke={strokeFor("L3", l3 || Math.hypot(pad.lx, pad.ly) > 0.04)}
            strokeWidth="2"
            filter={isHi("L3", l3) ? "url(#vGlow)" : undefined}
          />
          <text x={lsX} y={lsY + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#e2e8f0">
            L
          </text>
        </g>

        {/* Right Stick (R3) */}
        <g {...hit("R3")}>
          <title>Right Stick / R3</title>
          <circle cx={rsCenter.x} cy={rsCenter.y} r="27" fill="#121118" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <line x1={rsCenter.x} y1={rsCenter.y} x2={rsX} y2={rsY} stroke={on} strokeWidth="2" opacity="0.7" />
          <circle
            cx={rsX}
            cy={rsY}
            r="16"
            fill={fillFor("R3", r3)}
            stroke={strokeFor("R3", r3 || Math.hypot(pad.rx, pad.ry) > 0.04)}
            strokeWidth="2"
            filter={isHi("R3", r3) ? "url(#vGlow)" : undefined}
          />
          <text x={rsX} y={rsY + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#e2e8f0">
            R
          </text>
        </g>
      </svg>

      {!compact && (
        <div className="stick-readouts">
          <span>
            LS ({pad.lx.toFixed(2)}, {pad.ly.toFixed(2)})
          </span>
          <span>
            RS ({pad.rx.toFixed(2)}, {pad.ry.toFixed(2)})
          </span>
          <span>
            {isXbox ? "LT" : "L2"} {Math.round(pad.l2 * 100)}% · {isXbox ? "RT" : "R2"}{" "}
            {Math.round(pad.r2 * 100)}%
          </span>
        </div>
      )}
    </div>
  );
};
