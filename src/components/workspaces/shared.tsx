"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { isAgentError, isUnreachableError } from "@/lib/agent-api";
import { useI18n, type TranslateFn } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Renders an agent error envelope (or unreachable state) as honest text. */
export function agentErrorMessage(err: unknown, t: TranslateFn): string {
  if (isAgentError(err)) {
    return t("err.agentError", { message: err.message, code: err.code });
  }
  if (isUnreachableError(err)) {
    return t("state.unreachableShort");
  }
  return t("err.unknown", {
    message: err instanceof Error ? err.message : String(err),
  });
}

/** Toast helper for mutations. */
export function toastAgentError(err: unknown, t: TranslateFn): void {
  toast.error(agentErrorMessage(err, t));
}

export function InlineError({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <p
      role="alert"
      className="rounded-md border border-red-600/30 bg-red-600/5 px-3 py-2 text-xs text-red-700 dark:text-red-400"
    >
      {agentErrorMessage(error, t)}
    </p>
  );
}

export function LoadingRows({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      aria-busy="true"
      aria-label={t("common.loading")}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function WorkspaceHeader({
  title,
  desc,
  actions,
  className,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {desc ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function SectionCard({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border bg-card shadow-xs", className)}
    >
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          {title ? (
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Compact key/value row used across detail panes. */
export function DetailRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-xs text-foreground",
          mono && "font-mono"
        )}
        dir={mono ? "ltr" : "auto"}
      >
        {children}
      </span>
    </div>
  );
}
