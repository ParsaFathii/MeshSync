"use client";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Tiny inline SVG sparkline over REAL measured speed samples only.
 * Fewer than two samples → honest em-dash placeholder.
 */
export function SpeedSparkline({
  samples,
  width = 96,
  height = 22,
  className,
  title,
}: {
  samples: number[] | undefined;
  width?: number;
  height?: number;
  className?: string;
  title?: string;
}) {
  const { fmt } = useI18n();

  if (!samples || samples.length < 2) {
    return (
      <span
        className={cn("font-mono text-xs text-muted-foreground", className)}
        dir="ltr"
      >
        —
      </span>
    );
  }

  const max = Math.max(...samples, 1);
  const min = Math.min(...samples, 0);
  const range = Math.max(max - min, 1);
  const stepX = width / (samples.length - 1);
  const points = samples.map((v, i) => {
    const x = i * stepX;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;
  const last = samples[samples.length - 1];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      dir="ltr"
      title={title ?? fmt.speed(last)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
        className="overflow-visible"
      >
        <polygon points={areaPoints} fill="var(--primary)" opacity="0.12" />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-mono text-[11px] text-muted-foreground">
        {fmt.speed(last)}
      </span>
    </span>
  );
}
