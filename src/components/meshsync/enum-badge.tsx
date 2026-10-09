import { cn } from "@/lib/utils";

/**
 * Internal shared renderer for the small uppercase mono badges
 * (DISCOVERED/PAIRING/TRUSTED/REVOKED, SYNCED/PENDING/…, QUEUED/…, …).
 * Enum text always renders latin uppercase — it is data, not prose.
 */

export type BadgeTone = "emerald" | "amber" | "red" | "stone";

const TONE_CLASSES: Record<BadgeTone, string> = {
  emerald:
    "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  amber:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
  red: "border-red-600/30 bg-red-600/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400",
  stone:
    "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400",
};

export function EnumBadge({
  value,
  tone,
  className,
}: {
  value: string;
  tone: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-sm border px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wider leading-4",
        TONE_CLASSES[tone],
        className
      )}
      dir="ltr"
    >
      {value}
    </span>
  );
}
