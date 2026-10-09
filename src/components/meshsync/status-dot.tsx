import { cn } from "@/lib/utils";

/**
 * Colored status dot with optional pulse for live states.
 * Semantics: emerald=online/synced/trusted, amber=transferring/pending/pairing,
 * red=error/conflict/revoked, stone=offline/queued/discovered.
 */

export type DotTone = "emerald" | "amber" | "red" | "stone";

const TONE_CLASSES: Record<DotTone, string> = {
  emerald: "bg-emerald-600 dark:bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-600 dark:bg-red-500",
  stone: "bg-stone-400 dark:bg-stone-600",
};

export function StatusDot({
  tone,
  pulse = false,
  size = "sm",
  label,
  className,
}: {
  tone: DotTone;
  pulse?: boolean;
  size?: "xs" | "sm" | "md";
  label?: string;
  className?: string;
}) {
  const sizeClass =
    size === "xs" ? "size-1.5" : size === "md" ? "size-2.5" : "size-2";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <span
        className={cn(
          "inline-block rounded-full",
          TONE_CLASSES[tone],
          sizeClass,
          pulse && "mesh-live-dot"
        )}
        role="presentation"
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Trust level → dot tone. */
export function trustTone(trust: string): DotTone {
  switch (trust) {
    case "TRUSTED":
      return "emerald";
    case "PAIRING":
      return "amber";
    case "REVOKED":
      return "red";
    default:
      return "stone";
  }
}

/** Transfer status → dot tone. */
export function transferTone(status: string): DotTone {
  switch (status) {
    case "TRANSFERRING":
    case "PREPARING":
    case "VERIFYING":
      return "amber";
    case "COMPLETED":
      return "emerald";
    case "FAILED":
      return "red";
    default:
      return "stone";
  }
}

/** Event severity → dot tone. */
export function severityTone(severity: string): DotTone {
  switch (severity) {
    case "ERROR":
      return "red";
    case "WARN":
      return "amber";
    default:
      return "emerald";
  }
}
