"use client";

import { useI18n } from "@/lib/i18n";
import type { TransferChunk } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * THE signature transfer progress component: renders the real chunk map from
 * the agent API as dense segments — emerald DONE, amber ACTIVE, stone PENDING,
 * red FAILED. Large chunk maps are grouped into ≤120 visual segments
 * proportionally. Partially done groups show an honest split fill.
 *
 * When only aggregate counts are available (no chunk array), the done prefix
 * is rendered — the agent's `resume` continues "from the first pending chunk",
 * so a done-prefix is the faithful representation.
 *
 * The map itself is direction-agnostic (LTR), like all data visualizations.
 */

const MAX_SEGMENTS = 120;

interface Segment {
  doneFrac: number;
  active: boolean;
  failed: boolean;
}

function buildSegments(
  chunksTotal: number,
  chunksDone: number,
  chunks: TransferChunk[] | null | undefined
): Segment[] {
  const total = Math.max(0, Math.floor(chunksTotal));
  if (total === 0) return [];
  const done = Math.min(Math.max(0, Math.floor(chunksDone)), total);
  const segCount = Math.min(total, MAX_SEGMENTS);
  const segments: Segment[] = [];
  for (let i = 0; i < segCount; i++) {
    const start = Math.floor((i * total) / segCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * total) / segCount));
    const count = end - start;
    if (chunks && chunks.length > 0) {
      let doneCount = 0;
      let activeCount = 0;
      let failedCount = 0;
      for (let j = start; j < end && j < chunks.length; j++) {
        const state = chunks[j]?.state;
        if (state === "DONE") doneCount += 1;
        else if (state === "ACTIVE") activeCount += 1;
        else if (state === "FAILED") failedCount += 1;
      }
      segments.push({
        doneFrac: doneCount / count,
        active: activeCount > 0,
        failed: failedCount > 0,
      });
    } else {
      const overlapStart = Math.min(start, done);
      const overlapEnd = Math.min(end, done);
      segments.push({
        doneFrac: (overlapEnd - overlapStart) / count,
        active: false,
        failed: false,
      });
    }
  }
  return segments;
}

function segmentStyle(seg: Segment): React.CSSProperties {
  if (seg.failed) return { background: "var(--chunk-failed)" };
  if (seg.active) return { background: "var(--chunk-active)" };
  if (seg.doneFrac >= 1) return { background: "var(--chunk-done)" };
  if (seg.doneFrac <= 0) return { background: "var(--chunk-pending)" };
  const pct = Math.round(seg.doneFrac * 100);
  return {
    background: `linear-gradient(90deg, var(--chunk-done) ${pct}%, var(--chunk-pending) ${pct}%)`,
  };
}

export function ChunkProgress({
  chunksTotal,
  chunksDone,
  chunks = null,
  transferred = null,
  size = null,
  speedBps = null,
  etaSeconds = null,
  progressPct = null,
  compact = false,
  className,
}: {
  chunksTotal: number;
  chunksDone: number;
  chunks?: TransferChunk[] | null;
  transferred?: number | null;
  size?: number | null;
  speedBps?: number | null;
  etaSeconds?: number | null;
  progressPct?: number | null;
  compact?: boolean;
  className?: string;
}) {
  const { fmt, t } = useI18n();

  const total = Math.max(0, Math.floor(chunksTotal));
  const done = Math.min(Math.max(0, Math.floor(chunksDone)), total);
  const pct =
    progressPct !== null && progressPct !== undefined
      ? Math.round(progressPct)
      : total > 0
        ? Math.round((done / total) * 100)
        : 0;
  const segments = buildSegments(total, done, chunks);

  return (
    <div className={cn("min-w-0", className)}>
      <div
        dir="ltr"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={cn(
          "flex w-full items-stretch gap-px overflow-hidden rounded-full",
          compact ? "h-1" : "h-1.5"
        )}
      >
        {segments.length === 0 ? (
          <div
            className="h-full w-full rounded-full"
            style={{ background: "var(--chunk-pending)" }}
          />
        ) : (
          segments.map((seg, i) => (
            <div
              key={i}
              className="h-full min-w-[2px] flex-1"
              style={segmentStyle(seg)}
            />
          ))
        )}
      </div>

      {!compact && (
        <div
          dir="auto"
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] leading-4 text-muted-foreground"
        >
          <span className="font-semibold text-foreground" dir="ltr">
            {t("misc.pct", { value: pct })}
          </span>
          {size !== null && size !== undefined && size > 0 ? (
            <span dir="ltr">
              {transferred !== null && transferred !== undefined
                ? fmt.bytes(transferred)
                : "—"}
              {" / "}
              {fmt.bytes(size)}
            </span>
          ) : null}
          {speedBps !== null && speedBps !== undefined ? (
            <span dir="ltr">{fmt.speed(speedBps)}</span>
          ) : null}
          {etaSeconds !== null && etaSeconds !== undefined ? (
            <span dir="ltr">ETA {fmt.duration(etaSeconds)}</span>
          ) : null}
          <span dir="ltr">
            {done}/{total}
          </span>
        </div>
      )}
    </div>
  );
}
