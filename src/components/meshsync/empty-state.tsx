import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Honest empty states: small original line-art glyph + title + one guidance
 * sentence + optional real action button.
 */

export type EmptyStateKind =
  | "peers"
  | "folders"
  | "files"
  | "transfer"
  | "conflict"
  | "activity"
  | "device"
  | "settings"
  | "generic";

const glyphStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ kind }: { kind: EmptyStateKind }) {
  const common = {
    width: 40,
    height: 40,
    viewBox: "0 0 32 32",
    "aria-hidden": true,
    focusable: false as const,
    className: "text-stone-400 dark:text-stone-600",
  };
  switch (kind) {
    case "peers":
      return (
        <svg {...common}>
          <circle cx="16" cy="8" r="4" {...glyphStroke} />
          <circle cx="7" cy="24" r="4" {...glyphStroke} />
          <circle cx="25" cy="24" r="4" {...glyphStroke} />
          <path d="M13.5 11.5 L9.5 20.5 M18.5 11.5 L22.5 20.5 M11 24 L21 24" {...glyphStroke} />
        </svg>
      );
    case "folders":
      return (
        <svg {...common}>
          <path d="M4 12 h7 l2 3 h13 v11 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 z" {...glyphStroke} />
          <path d="M4 8 h9 l2 3" {...glyphStroke} />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M8 4 h10 l6 6 v18 H8 z" {...glyphStroke} />
          <path d="M18 4 v6 h6" {...glyphStroke} />
          <path d="M12 16 h8 M12 20 h8" {...glyphStroke} />
        </svg>
      );
    case "transfer":
      return (
        <svg {...common}>
          <path d="M6 12 h16 M19 9 l3 3 -3 3" {...glyphStroke} />
          <path d="M26 20 h-16 M13 17 l-3 3 3 3" {...glyphStroke} />
        </svg>
      );
    case "conflict":
      return (
        <svg {...common}>
          <path d="M5 6 h8 v20 H5 z" {...glyphStroke} />
          <path d="M19 6 h8 v20 h-8 z" {...glyphStroke} />
          <path d="M13 16 l2 -2 2 2 2 -2 2 2" {...glyphStroke} />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M4 18 h6 l3 -9 5 16 3 -7 h7" {...glyphStroke} />
        </svg>
      );
    case "device":
      return (
        <svg {...common}>
          <rect x="7" y="9" width="18" height="13" rx="2" {...glyphStroke} />
          <path d="M12 26 h8 M16 22 v4" {...glyphStroke} />
          <circle cx="16" cy="15.5" r="1.6" {...glyphStroke} />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M6 11 h20 M6 16 h20 M6 21 h20" {...glyphStroke} />
          <circle cx="12" cy="11" r="2.4" {...glyphStroke} />
          <circle cx="21" cy="16" r="2.4" {...glyphStroke} />
          <circle cx="10" cy="21" r="2.4" {...glyphStroke} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="10" strokeDasharray="3 4" {...glyphStroke} />
          <path d="M16 11 v6" {...glyphStroke} />
          <circle cx="16" cy="20.5" r="0.8" fill="currentColor" />
        </svg>
      );
  }
}

export function EmptyState({
  kind,
  title,
  hint,
  action,
  className,
}: {
  kind: EmptyStateKind;
  title: string;
  hint: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 px-6 text-center",
        className
      )}
    >
      <Glyph kind={kind} />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{hint}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
