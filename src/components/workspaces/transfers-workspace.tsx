"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChunkProgress } from "@/components/meshsync/chunk-progress";
import { EmptyState } from "@/components/meshsync/empty-state";
import { SpeedSparkline } from "@/components/meshsync/speed-sparkline";
import { TransferStatusBadge } from "@/components/meshsync/sync-state-badge";
import {
  InlineError,
  LoadingRows,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import { useTransfer, useTransferAction, useTransfers } from "@/hooks/use-agent-data";
import { useI18n, type DictKey } from "@/lib/i18n";
import type { Transfer, TransferActionKind, TransferStatus } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

const ACTIVE = new Set<TransferStatus>([
  "QUEUED",
  "PREPARING",
  "TRANSFERRING",
  "VERIFYING",
]);

type FilterValue =
  | "all"
  | "active"
  | "queued"
  | "completed"
  | "failed"
  | "cancelled";

const FILTERS: ReadonlyArray<{ id: FilterValue; labelKey: DictKey }> = [
  { id: "all", labelKey: "transfers.filter.all" },
  { id: "active", labelKey: "transfers.filter.active" },
  { id: "queued", labelKey: "transfers.filter.queued" },
  { id: "completed", labelKey: "transfers.filter.completed" },
  { id: "failed", labelKey: "transfers.filter.failed" },
  { id: "cancelled", labelKey: "transfers.filter.cancelled" },
];

function matchesFilter(transfer: Transfer, filter: FilterValue): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return ACTIVE.has(transfer.status);
    case "queued":
      return transfer.status === "QUEUED";
    case "completed":
      return transfer.status === "COMPLETED";
    case "failed":
      return transfer.status === "FAILED";
    case "cancelled":
      return transfer.status === "CANCELLED";
  }
}

function TransferRow({ port, transfer }: { port: number; transfer: Transfer }) {
  const { t, fmt } = useI18n();
  const action = useTransferAction(port);
  const speedSamples = useConsoleStore((s) => s.speedSamples[transfer.id]);

  const isActive = ACTIVE.has(transfer.status);
  const detail = useTransfer(port, isActive ? transfer.id : null);
  const chunks = detail.data?.chunks ?? null;

  const [errorOpen, setErrorOpen] = useState(false);

  const runAction = (kind: TransferActionKind) => {
    const optimistic: TransferStatus =
      kind === "pause"
        ? "PAUSED"
        : kind === "resume"
          ? "TRANSFERRING"
          : kind === "cancel"
            ? "CANCELLED"
            : "QUEUED";
    action.mutate(
      { id: transfer.id, action: kind, optimistic },
      {
        onSuccess: () => {
          if (kind === "pause") toast.success(t("toast.transferPaused"));
          if (kind === "resume") toast.success(t("toast.transferResumed"));
          if (kind === "cancel") toast.success(t("toast.transferCancelled"));
          if (kind === "retry") toast.success(t("toast.transferRetried"));
        },
        onError: (err) => toastAgentError(err, t),
      }
    );
  };

  const directionIcon =
    transfer.direction === "PUSH" ? (
      <ArrowUp className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
    ) : transfer.direction === "PULL" ? (
      <ArrowDown className="size-3.5 text-amber-600 dark:text-amber-500" aria-hidden="true" />
    ) : null;

  return (
    <article className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TransferStatusBadge status={transfer.status} />
        {directionIcon}
        <span
          className="min-w-0 truncate font-mono text-xs font-medium"
          dir="ltr"
          title={transfer.relPath}
        >
          {transfer.relPath}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono" dir="ltr" title={transfer.peerName}>
            {transfer.peerName}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span dir="auto">{transfer.folderName}</span>
        </span>
      </div>

      <ChunkProgress
        chunksTotal={transfer.chunksTotal}
        chunksDone={transfer.chunksDone}
        chunks={chunks}
        transferred={transfer.transferred}
        size={transfer.size}
        speedBps={transfer.speedBps}
        etaSeconds={transfer.etaSeconds}
        progressPct={transfer.progressPct}
        compact={transfer.status === "QUEUED" || transfer.status === "PAUSED"}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        <span dir="auto">
          {t("transfers.started")}:{" "}
          <span title={fmt.dateTime(transfer.startedAt)}>
            {fmt.relative(transfer.startedAt)}
          </span>
        </span>
        {transfer.completedAt ? (
          <span dir="auto">
            {t("transfers.completed")}:{" "}
            <span title={fmt.dateTime(transfer.completedAt)}>
              {fmt.relative(transfer.completedAt)}
            </span>
          </span>
        ) : null}
        {transfer.status === "TRANSFERRING" ? (
          <span title={t("transfers.sparkline")}>
            <SpeedSparkline samples={speedSamples} />
          </span>
        ) : null}
        <span className="ms-auto flex items-center gap-1.5">
          {transfer.status === "TRANSFERRING" || transfer.status === "QUEUED" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => runAction("pause")}
              disabled={action.isPending}
            >
              <Pause className="size-3.5" aria-hidden="true" />
              {t("common.pause")}
            </Button>
          ) : null}
          {transfer.status === "PAUSED" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => runAction("resume")}
              disabled={action.isPending}
            >
              <Play className="size-3.5" aria-hidden="true" />
              {t("common.resume")}
            </Button>
          ) : null}
          {ACTIVE.has(transfer.status) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-amber-700 hover:text-amber-800 dark:text-amber-400"
              onClick={() => runAction("cancel")}
              disabled={action.isPending}
            >
              <Ban className="size-3.5" aria-hidden="true" />
              {t("common.cancel")}
            </Button>
          ) : null}
          {transfer.status === "FAILED" || transfer.status === "CANCELLED" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => runAction("retry")}
              disabled={action.isPending}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t("common.retryAction")}
            </Button>
          ) : null}
        </span>
      </div>

      {transfer.error ? (
        <Collapsible open={errorOpen} onOpenChange={setErrorOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md border border-red-600/30 bg-red-600/5 px-3 py-1.5 text-xs text-red-700 dark:text-red-400">
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform rtl-flip",
                errorOpen && "rotate-90"
              )}
              aria-hidden="true"
            />
            <span className="truncate">{transfer.error}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              className="mt-1 max-h-40 overflow-auto rounded-md border bg-secondary/40 p-3 font-mono text-[11px] whitespace-pre-wrap break-all"
              dir="ltr"
            >
              {transfer.error}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </article>
  );
}

export function TransfersWorkspace({ port }: { port: number }) {
  const { t, fmt } = useI18n();
  const transfers = useTransfers(port);
  const [filter, setFilter] = useState<FilterValue>("all");

  const list = transfers.data?.transfers ?? [];
  const counts = FILTERS.reduce<Record<FilterValue, number>>(
    (acc, f) => {
      acc[f.id] = list.filter((tr) => matchesFilter(tr, f.id)).length;
      return acc;
    },
    { all: 0, active: 0, queued: 0, completed: 0, failed: 0, cancelled: 0 }
  );
  const filtered = list.filter((tr) => matchesFilter(tr, filter));
  const activeMoving = list.filter((tr) => tr.status === "TRANSFERRING");
  const aggregateSpeed = activeMoving.reduce((sum, tr) => sum + tr.speedBps, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        <WorkspaceHeader
          title={t("transfers.title")}
          desc={
            <span dir="auto" className="flex flex-wrap items-center gap-x-3">
              <span>
                {t("statusbar.activeTransfers", { count: counts.active })}
              </span>
              <span className="font-mono text-xs" dir="ltr">
                {t("transfers.aggregate")}: {fmt.speed(aggregateSpeed)}
              </span>
            </span>
          }
        />

        {/* filter tabs */}
        <div
          role="group"
          aria-label={t("common.status")}
          className="flex flex-wrap items-center gap-1.5"
        >
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-transparent bg-secondary text-secondary-foreground hover:bg-accent"
                )}
              >
                {t(f.labelKey)}
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                  {counts[f.id]}
                </span>
              </button>
            );
          })}
        </div>

        {transfers.isLoading ? <LoadingRows rows={4} /> : null}
        {transfers.isError ? <InlineError error={transfers.error} /> : null}

        {transfers.data && list.length === 0 ? (
          <EmptyState
            kind="transfer"
            title={t("transfers.noTransfers")}
            hint={t("transfers.noTransfersHint")}
          />
        ) : null}

        {transfers.data && list.length > 0 && filtered.length === 0 ? (
          <EmptyState
            kind="transfer"
            title={t("transfers.noMatchFilter")}
            hint={t("common.noResults")}
          />
        ) : null}

        {filtered.length > 0 ? (
          <div className="flex flex-col gap-3">
            {filtered.map((tr) => (
              <TransferRow key={tr.id} port={port} transfer={tr} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
