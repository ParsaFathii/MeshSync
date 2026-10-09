"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Monospace truncated hash chip (first 8 … last 6 chars) with a real
 * copy-to-clipboard action and a toast on copy.
 */
export function HashChip({
  hash,
  className,
  copyLabel,
}: {
  hash: string | null | undefined;
  className?: string;
  copyLabel?: string;
}) {
  const { t } = useI18n();

  if (!hash) {
    return (
      <span className={cn("font-mono text-xs text-muted-foreground", className)}>
        —
      </span>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      toast.success(t("common.copiedHash"));
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = hash;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        toast.success(t("common.copiedHash"));
      } catch {
        toast.error(t("err.requestFailed"));
      }
    }
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border bg-secondary/60 py-0.5 ps-1.5 pe-0.5 font-mono text-xs text-foreground/90",
        className
      )}
      dir="ltr"
      title={hash}
    >
      <span className="truncate">{shortHash(hash)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 hover:bg-accent"
        onClick={copy}
        aria-label={copyLabel ?? t("common.copy")}
      >
        <Copy className="size-3" aria-hidden="true" />
      </Button>
    </span>
  );
}
