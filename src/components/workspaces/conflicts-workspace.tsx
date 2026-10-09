"use client";

import { useState } from "react";
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  FileDown,
  FileUp,
  History,
  TriangleAlert,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { EmptyState } from "@/components/meshsync/empty-state";
import { HashChip } from "@/components/meshsync/hash-chip";
import { ConflictStatusBadge } from "@/components/meshsync/sync-state-badge";
import { StatusDot } from "@/components/meshsync/status-dot";
import {
  InlineError,
  LoadingRows,
  SectionCard,
  WorkspaceHeader,
  agentErrorMessage,
  toastAgentError,
} from "@/components/workspaces/shared";
import { useIsMobile } from "@/hooks/use-mobile";
import { useConflicts } from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { formatDateIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query-keys";
import type { Conflict, ConflictResolution } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

/** `report.pdf` + peer `mesh-beta` + date → `report (conflict from mesh-beta 2026-10-08).pdf` */
function keepBothFilename(relPath: string, peerName: string, isoDate: string): string {
  const slash = relPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relPath.slice(0, slash + 1);
  const base = slash === -1 ? relPath : relPath.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  return `${dir}${stem} (conflict from ${peerName} ${formatDateIso(isoDate)})${ext}`;
}

function ConflictListRow({
  conflict,
  selected,
  onSelect,
}: {
  conflict: Conflict;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, fmt } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border p-3 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "border-red-600/40 bg-red-600/5"
          : "bg-card hover:border-foreground/20"
      )}
    >
      <span className="flex items-center gap-2">
        <StatusDot
          tone={conflict.status === "OPEN" ? "red" : "emerald"}
          label={conflict.status}
        />
        <span className="min-w-0 truncate font-mono text-xs" dir="ltr" title={conflict.relPath}>
          {conflict.relPath}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
        <span dir="auto">{conflict.folderName}</span>
        <span className="font-mono" dir="ltr">{conflict.remotePeerName}</span>
        {conflict.status === "OPEN" ? (
          <span dir="auto">{fmt.relative(conflict.createdAt)}</span>
        ) : (
          <span dir="auto">
            {t("conflicts.resolvedAt")}: {fmt.relative(conflict.resolvedAt)}
          </span>
        )}
        <ConflictStatusBadge
          status={conflict.status}
          resolution={conflict.resolution}
        />
      </span>
    </button>
  );
}

function ResolutionPane({
  port,
  conflict,
}: {
  port: number;
  conflict: Conflict;
}) {
  const { t, fmt } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: (action: ConflictResolution) =>
      api.resolveConflict(port, conflict.id, action),
    onSuccess: (resp, action) => {
      void queryClient.invalidateQueries({ queryKey: qk.conflicts(port) });
      setError(null);
      if (action !== "LATER") {
        toast.success(t("toast.conflictResolved", { resolution: action }));
        // Move the selection away from the now-resolved conflict.
        useConsoleStore.getState().setConflictId(port, null);
      }
      void resp;
    },
    onError: (err) => {
      setError(agentErrorMessage(err, t));
      toastAgentError(err, t);
    },
  });

  const sizeDiff =
    conflict.localSize !== null && conflict.remoteSize !== null
      ? Math.abs(conflict.localSize - conflict.remoteSize)
      : null;

  const preview = keepBothFilename(
    conflict.relPath,
    conflict.remotePeerName,
    conflict.createdAt
  );

  const actions: ReadonlyArray<{
    action: ConflictResolution;
    label: string;
    hint: string;
    icon: typeof Check;
    variant: "default" | "outline";
    className?: string;
  }> = [
    {
      action: "KEEP_LOCAL",
      label: t("conflicts.keepLocal"),
      hint: t("conflicts.keepLocalHint"),
      icon: FileUp,
      variant: "outline",
    },
    {
      action: "KEEP_REMOTE",
      label: t("conflicts.keepRemote"),
      hint: t("conflicts.keepRemoteHint"),
      icon: FileDown,
      variant: "outline",
    },
    {
      action: "KEEP_BOTH",
      label: t("conflicts.keepBoth"),
      hint: t("conflicts.keepBothHint", { filename: preview }),
      icon: Copy,
      variant: "outline",
    },
    {
      action: "LATER",
      label: t("conflicts.later"),
      hint: t("conflicts.laterHint"),
      icon: Clock,
      variant: "ghost",
      className: "text-muted-foreground",
    },
  ];

  return (
    <SectionCard title={t("conflicts.selected")} className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="break-all font-mono text-sm font-semibold" dir="ltr">
              {conflict.relPath}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
              {conflict.folderName} · <span className="font-mono" dir="ltr">{conflict.remotePeerName}</span> ·{" "}
              {t("conflicts.created")}: {fmt.relative(conflict.createdAt)}
            </p>
          </div>
        </div>

        {/* two-column comparison */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("conflicts.localVersion")}
            </p>
            <div className="flex flex-col gap-1.5">
              <HashChip hash={conflict.localHash} copyLabel={t("common.copy")} />
              <p className="font-mono text-xs" dir="ltr">
                {fmt.bytes(conflict.localSize)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmt.dateTime(conflict.localMtime)}
              </p>
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("conflicts.remoteVersion", { peer: conflict.remotePeerName })}
            </p>
            <div className="flex flex-col gap-1.5">
              <HashChip hash={conflict.remoteHash} copyLabel={t("common.copy")} />
              <p className="font-mono text-xs" dir="ltr">
                {fmt.bytes(conflict.remoteSize)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmt.dateTime(conflict.remoteMtime)}
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-amber-700 dark:text-amber-400">
          {sizeDiff !== null && sizeDiff > 0
            ? t("conflicts.sizeDiff", { delta: fmt.bytes(sizeDiff) })
            : t("conflicts.sameSize")}
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-600/30 bg-red-600/5 px-3 py-2 text-xs text-red-700 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-col divide-y rounded-lg border">
          {actions.map(({ action: act, label, hint, icon: Icon, variant, className }) => (
            <div
              key={act}
              className="flex flex-col gap-1.5 p-3 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {hint}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={variant}
                className={cn("shrink-0", className)}
                disabled={resolve.isPending}
                onClick={() => resolve.mutate(act)}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {resolve.isPending && resolve.variables === act
                  ? t("conflicts.resolving")
                  : label}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

export function ConflictsWorkspace({ port }: { port: number }) {
  const { t } = useI18n();
  const conflicts = useConflicts(port);
  const isMobile = useIsMobile();

  const selectedId = useConsoleStore((s) => s.conflictId[port]) ?? null;
  const setConflictId = useConsoleStore((s) => s.setConflictId);

  const [historyOpen, setHistoryOpen] = useState(false);

  const all = conflicts.data?.conflicts ?? [];
  const open = all.filter((c) => c.status === "OPEN");
  const resolved = all.filter((c) => c.status === "RESOLVED");
  const selected = all.find((c) => c.id === selectedId) ?? null;

  const listPane = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {conflicts.isLoading ? <LoadingRows rows={3} /> : null}
      {conflicts.isError ? <InlineError error={conflicts.error} /> : null}

      {conflicts.data && open.length === 0 ? (
        <EmptyState
          kind="conflict"
          title={t("conflicts.noConflicts")}
          hint={t("conflicts.noConflictsHint")}
        />
      ) : null}

      {open.length > 0 ? (
        <div className="flex flex-col gap-2">
          {open.map((c) => (
            <ConflictListRow
              key={c.id}
              conflict={c}
              selected={c.id === selectedId}
              onSelect={() => setConflictId(port, c.id)}
            />
          ))}
        </div>
      ) : null}

      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent">
          <History className="size-4" aria-hidden="true" />
          {t("conflicts.resolvedHistory")}
          <span className="ms-auto font-mono text-xs" dir="ltr">
            {resolved.length}
          </span>
          <ChevronRight
            className={cn(
              "size-4 transition-transform rtl-flip",
              historyOpen && "rotate-90"
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {resolved.length === 0 ? (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              {t("conflicts.noResolved")}
            </p>
          ) : (
            <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto pe-1">
              {resolved.map((c) => (
                <ConflictListRow
                  key={c.id}
                  conflict={c}
                  selected={c.id === selectedId}
                  onSelect={() => setConflictId(port, c.id)}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );

  const detailPane = selected ? (
    <ResolutionPane port={port} conflict={selected} />
  ) : (
    <SectionCard title={t("conflicts.selected")} className="hidden md:block">
      <EmptyState
        kind="conflict"
        title={t("conflicts.noSelection")}
        hint={t("conflicts.noSelectionHint")}
      />
    </SectionCard>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        <WorkspaceHeader
          title={t("conflicts.title")}
          desc={t("conflicts.noConflictsHint")}
        />

        {isMobile ? (
          <div className="flex flex-col gap-3">
            {listPane}
            {selected ? detailPane : null}
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="min-h-[24rem]">
            <ResizablePanel defaultSize={52} minSize={32} className="min-w-0">
              <div className="h-full pe-1">{listPane}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={48} minSize={30} className="min-w-0">
              <div className="h-full ps-1">{detailPane}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}
