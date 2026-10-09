import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Compact metric tile: uppercase label (UI voice), mono value (data voice).
 * Used sparingly — dense honest tables carry most of the console.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "emerald" | "amber" | "red";
  className?: string;
}) {
  const valueTone =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "red"
          ? "text-red-700 dark:text-red-400"
          : "text-foreground";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 min-w-0",
        className
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon ? (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className={cn("mt-1.5 truncate font-mono text-lg leading-6", valueTone)} dir="auto">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
