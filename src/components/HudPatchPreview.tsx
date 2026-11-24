import React, { useEffect, useRef } from "react";

interface Props {
  rgb: number[];
}

export const HudPatchPreview: React.FC<Props> = ({ rgb }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || rgb.length < 480) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(16, 10);
    for (let i = 0; i < 160; i++) {
      const s = i * 3;
      const d = i * 4;
      img.data[d] = rgb[s] ?? 0;
      img.data[d + 1] = rgb[s + 1] ?? 0;
      img.data[d + 2] = rgb[s + 2] ?? 0;
      img.data[d + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [rgb]);

  return (
    <canvas
      ref={ref}
      width={16}
      height={10}
      style={{
        width: 64,
        height: 40,
        imageRendering: "pixelated",
        borderRadius: 5,
        border: "1px solid var(--border-strong)",
        display: "block",
      }}
    />
  );
};
