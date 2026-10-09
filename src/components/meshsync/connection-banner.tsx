"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Amber banner shown at the top of the workspace when the selected agent is
 * unreachable. The Retry button performs a real refetch of every cached agent
 * query for that port.
 */
export function ConnectionBanner({
  port,
  onRetry,
  isRetrying = false,
}: {
  port: number;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {t("conn.unreachable", { port })}
          </p>
          <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
            {t("conn.unreachableHint")}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRetry}
        disabled={isRetrying}
        className="shrink-0 border-amber-500/50 text-amber-800 hover:bg-amber-500/15 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
      >
        {isRetrying ? t("conn.retrying") : t("conn.retryNow")}
      </Button>
    </div>
  );
}
