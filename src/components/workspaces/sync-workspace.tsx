"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Minus,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChunkProgress } from "@/components/meshsync/chunk-progress";
import { EmptyState } from "@/components/meshsync/empty-state";
import { HashChip } from "@/components/meshsync/hash-chip";
import { PlanStateBadge } from "@/components/meshsync/sync-state-badge";
import { StatTile } from "@/components/meshsync/stat-tile";
import { TransferStatusBadge } from "@/components/meshsync/sync-state-badge";
import {
  InlineError,
  LoadingRows,
  SectionCard,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import {
  useFolders,
  usePeers,
  useSessions,
  useTransfer,
  useTransfers,
} from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { useI18n } from "@/lib/i18n";
import type { SyncPlan } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["QUEUED", "PREPARING", "TRANSFERRING", "VERIFYING"]);

function DirectionMark({ direction }: { direction: string }) {
  if (direction === "PUSH") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
        title="PUSH"
      >
        <ArrowUp className="size-3.5" aria-hidden="true" />
        <span className="sr-only">PUSH</span>
      </span>
    );
  }
  if (direction === "PULL") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500"
        title="PULL"
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
        <span className="sr-only">PULL</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-xs text-muted-foreground">
      <Minus className="size-3.5" aria-hidden="true" />
      <span className="sr-only">NONE</span>
    </span>
  );
}

function LiveTransferRow({
  port,
  transferId,
}: {
  port: number;
  transferId: string;
}) {
  const { t, fmt } = useI18n();
  const detail = useTransfer(port, transferId);
  const tr = detail.data?.transfer;

  if (!tr) {
    return (
      <div className="rounded-lg border p-3 font-mono text-xs text-muted-foreground" dir="ltr">
        {transferId}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TransferStatusBadge status={tr.status} />
        <DirectionMark direction={tr.direction} />
        <span className="min-w-0 truncate font-mono text-xs" dir="ltr" title={tr.relPath}>
          {tr.relPath}
        </span>
        <span className="ms-auto shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
          {fmt.bytes(tr.transferred)} / {fmt.bytes(tr.size)}
        </span>
      </div>
      <ChunkProgress
        chunksTotal={tr.chunksTotal}
        chunksDone={tr.chunksDone}
        chunks={detail.data?.chunks}
        transferred={tr.transferred}
        size={tr.size}
        speedBps={tr.speedBps}
        etaSeconds={tr.etaSeconds}
        progressPct={tr.progressPct}
      />
    </div>
  );
}

export function SyncWorkspace({ port }: { port: number }) {
  const { t, fmt } = useI18n();
  const peers = usePeers(port);
  const folders = useFolders(port);
  const sessions = useSessions(port);
  const transfers = useTransfers(port);

  const syncPeerId = useConsoleStore((s) => s.syncPeerId[port]) ?? null;
  const setSyncPeerId = useConsoleStore((s) => s.setSyncPeerId);
  const syncFolderId = useConsoleStore((s) => s.syncFolderId[port]) ?? null;
  const setSyncFolderId = useConsoleStore((s) => s.setSyncFolderId);
  const plan = useConsoleStore((s) => s.syncPlan[port]) ?? null;
  const setPlan = useConsoleStore((s) => s.setSyncPlan);

  const [confirmExecute, setConfirmExecute] = useState(false);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  const trustedPeers = (peers.data?.peers ?? []).filter(
    (p) => p.trust === "TRUSTED"
  );
  const folderList = folders.data?.folders ?? [];

  const compute = useMutation({
    mutationFn: () =>
      api.syncPlan(port, syncPeerId as string, syncFolderId as number),
    onSuccess: (result) => {
      setPlan(port, result);
      toast.success(t("toast.planComputed", { total: result.summary.total }));
    },
    onError: (err) => toastAgentError(err, t),
  });

  const run = useMutation({
    mutationFn: () =>
      api.syncRun(port, syncPeerId as string, syncFolderId as number),
    onSuccess: (resp) => {
      setLastSessionId(resp.sessionId);
      setPlan(port, resp.plan);
      toast.success(t("toast.syncStarted", { id: resp.sessionId.slice(0, 8) }));
      setConfirmExecute(false);
      void sessions.refetch();
      void transfers.refetch();
    },
    onError: (err) => toastAgentError(err, t),
  });

  const canCompute =
    syncPeerId !== null && syncFolderId !== null && !compute.isPending && !run.isPending;

  const executePlan = () => {
    if (!plan) return;
    const deletions = plan.summary.deleteLocal + plan.summary.deleteRemote;
    const conflicts = plan.summary.conflicts;
    if (deletions > 0 || conflicts > 0) {
      setConfirmExecute(true);
    } else {
      run.mutate();
    }
  };

  const activeSessionTransfers = (transfers.data?.transfers ?? []).filter(
    (tr) =>
      lastSessionId !== null &&
      ACTIVE.has(tr.status) &&
      tr.folderId === syncFolderId &&
      tr.peerId === syncPeerId
  );
  const sessionForLastRun = lastSessionId
    ? (sessions.data?.sessions ?? []).find((s) => s.id === lastSessionId) ?? null
    : null;

  const planTable = (current: SyncPlan) => (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="max-h-96 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="text-start">{t("common.path")}</TableHead>
              <TableHead className="text-start">{t("common.status")}</TableHead>
              <TableHead className="text-center">{t("transfers.direction")}</TableHead>
              <TableHead className="text-end">{t("common.size")}</TableHead>
              <TableHead className="text-end">{t("sync.localHash")}</TableHead>
              <TableHead className="text-end">{t("sync.remoteHash")}</TableHead>
              <TableHead className="hidden text-end lg:table-cell">
                {t("sync.lastSynced")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.actions.map((action) => (
              <TableRow
                key={action.relPath}
                className={cn(
                  action.state === "CONFLICT" &&
                    "bg-red-600/5 dark:bg-red-500/5",
                  (action.state === "DELETE_LOCAL" || action.state === "DELETE_REMOTE") &&
                    "bg-amber-500/5"
                )}
              >
                <TableCell className="max-w-[14rem]">
                  <span
                    className="block truncate font-mono text-xs"
                    dir="ltr"
                    title={action.relPath}
                  >
                    {action.relPath}
                  </span>
                </TableCell>
                <TableCell>
                  <PlanStateBadge state={action.state} />
                </TableCell>
                <TableCell className="text-center">
                  <DirectionMark direction={action.direction} />
                </TableCell>
                <TableCell className="text-end font-mono text-xs" dir="ltr">
                  {action.size !== null && action.size !== undefined
                    ? fmt.bytes(action.size)
                    : "—"}
                </TableCell>
                <TableCell className="text-end">
                  <HashChip hash={action.localHash} copyLabel={t("common.copy")} />
                </TableCell>
                <TableCell className="text-end">
                  <HashChip hash={action.remoteHash} copyLabel={t("common.copy")} />
                </TableCell>
                <TableCell className="hidden text-end lg:table-cell">
                  <HashChip hash={action.lastSyncedHash} copyLabel={t("common.copy")} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        <WorkspaceHeader
          title={t("sync.title")}
          desc={t("sync.noPlanHint")}
        />

        {/* form row */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <div className="flex min-w-44 flex-col gap-1.5">
            <label
              htmlFor="sync-peer"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("sync.peer")}
            </label>
            <Select
              value={syncPeerId ?? undefined}
              onValueChange={(v) => setSyncPeerId(port, v)}
            >
              <SelectTrigger id="sync-peer" className="w-44">
                <SelectValue placeholder={t("sync.selectPeer")} />
              </SelectTrigger>
              <SelectContent>
                {trustedPeers.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("sync.trustedOnly")}
                  </div>
                ) : (
                  trustedPeers.map((p) => (
                    <SelectItem key={p.peerId} value={p.peerId}>
                      <span className="font-mono" dir="ltr">{p.name}</span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-44 flex-col gap-1.5">
            <label
              htmlFor="sync-folder"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("sync.folder")}
            </label>
            <Select
              value={syncFolderId !== null ? String(syncFolderId) : undefined}
              onValueChange={(v) => setSyncFolderId(port, Number(v))}
            >
              <SelectTrigger id="sync-folder" className="w-44">
                <SelectValue placeholder={t("sync.selectFolder")} />
              </SelectTrigger>
              <SelectContent>
                {folderList.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            onClick={() => compute.mutate()}
            disabled={!canCompute}
          >
            <RefreshCw
              className={cn("size-3.5", compute.isPending && "animate-spin")}
              aria-hidden="true"
            />
            {compute.isPending ? t("sync.computing") : t("sync.computePlan")}
          </Button>

          {peers.isError ? <InlineError error={peers.error} /> : null}
          {folders.isError ? <InlineError error={folders.error} /> : null}
        </div>

        {/* plan result */}
        {plan ? (
          <>
            <section aria-label={t("sync.planSummary")} className="flex flex-wrap gap-3">
              <StatTile label={t("sync.total")} value={fmt.num(plan.summary.total)} className="min-w-[7rem] flex-1" />
              <StatTile
                label={t("sync.pull")}
                value={fmt.num(plan.summary.pull)}
                tone={plan.summary.pull > 0 ? "amber" : "default"}
                className="min-w-[7rem] flex-1"
              />
              <StatTile
                label={t("sync.push")}
                value={fmt.num(plan.summary.push)}
                tone={plan.summary.push > 0 ? "emerald" : "default"}
                className="min-w-[7rem] flex-1"
              />
              <StatTile
                label={t("sync.deleteLocal")}
                value={fmt.num(plan.summary.deleteLocal)}
                tone={plan.summary.deleteLocal > 0 ? "red" : "default"}
                className="min-w-[7rem] flex-1"
              />
              <StatTile
                label={t("sync.deleteRemote")}
                value={fmt.num(plan.summary.deleteRemote)}
                tone={plan.summary.deleteRemote > 0 ? "red" : "default"}
                className="min-w-[7rem] flex-1"
              />
              <StatTile
                label={t("sync.conflicts")}
                value={fmt.num(plan.summary.conflicts)}
                tone={plan.summary.conflicts > 0 ? "red" : "default"}
                icon={TriangleAlert}
                className="min-w-[7rem] flex-1"
              />
              <StatTile
                label={t("sync.unchanged")}
                value={fmt.num(plan.summary.unchanged)}
                className="min-w-[7rem] flex-1"
              />
            </section>

            <SectionCard
              title={t("sync.planActions")}
              bodyClassName="p-0 sm:p-0"
              actions={
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground" dir="auto">
                    {t("sync.generatedAt")}: {fmt.dateTime(plan.generatedAt)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {plan.peer.name} · {plan.folder.name}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={executePlan}
                    disabled={run.isPending}
                  >
                    <Play className="size-3.5" aria-hidden="true" />
                    {run.isPending ? t("sync.executing") : t("sync.execute")}
                  </Button>
                </div>
              }
            >
              {planTable(plan)}
            </SectionCard>
          </>
        ) : (
          <EmptyState
            kind="transfer"
            title={t("sync.noPlan")}
            hint={t("sync.noPlanHint")}
          />
        )}

        {/* live progress + session status */}
        {lastSessionId ? (
          <SectionCard title={t("sync.liveProgress")}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono" dir="ltr">
                  session {lastSessionId.slice(0, 8)}
                </span>
                {sessionForLastRun ? (
                  <>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        sessionForLastRun.status === "COMPLETED"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : sessionForLastRun.status === "FAILED"
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-600 dark:text-amber-500"
                      )}
                      dir="ltr"
                    >
                      {sessionForLastRun.status}
                    </span>
                    <span dir="auto">
                      {t("sync.filesCol")}:{" "}
                      <span className="font-mono" dir="ltr">
                        {fmt.num(sessionForLastRun.filesTransferred)}
                      </span>
                    </span>
                    <span dir="auto">
                      {t("sync.bytesCol")}:{" "}
                      <span className="font-mono" dir="ltr">
                        {fmt.bytes(sessionForLastRun.transferred)}
                      </span>
                    </span>
                  </>
                ) : null}
              </div>
              {activeSessionTransfers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("sync.noActive")}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {activeSessionTransfers.map((tr) => (
                    <LiveTransferRow key={tr.id} port={port} transferId={tr.id} />
                  ))}
                </div>
              )}
              {sessionForLastRun?.error ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {sessionForLastRun.error}
                </p>
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {/* sessions history */}
        <SectionCard title={t("sync.sessionsHistory")} bodyClassName="p-0 sm:p-0">
          {sessions.isLoading ? (
            <div className="p-4">
              <LoadingRows rows={3} />
            </div>
          ) : sessions.isError ? (
            <div className="p-4">
              <InlineError error={sessions.error} />
            </div>
          ) : (sessions.data?.sessions ?? []).length === 0 ? (
            <div className="p-4">
              <EmptyState
                kind="transfer"
                title={t("sync.noSessions")}
                hint={t("sync.noSessionsHint")}
              />
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="text-start">{t("sync.peerCol")}</TableHead>
                    <TableHead className="text-start">{t("sync.folderCol")}</TableHead>
                    <TableHead className="text-end">{t("sync.started")}</TableHead>
                    <TableHead className="text-end">{t("sync.duration")}</TableHead>
                    <TableHead className="text-end">{t("sync.filesCol")}</TableHead>
                    <TableHead className="text-end">{t("sync.bytesCol")}</TableHead>
                    <TableHead className="text-end">{t("common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sessions.data?.sessions ?? []).map((s) => {
                    const duration =
                      s.finishedAt !== null
                        ? (Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000
                        : null;
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {s.peerName}
                        </TableCell>
                        <TableCell className="text-xs">{s.folderName}</TableCell>
                        <TableCell className="text-end text-xs">
                          <span title={fmt.dateTime(s.startedAt)}>
                            {fmt.relative(s.startedAt)}
                          </span>
                        </TableCell>
                        <TableCell className="text-end font-mono text-xs" dir="ltr">
                          {fmt.duration(duration)}
                        </TableCell>
                        <TableCell className="text-end font-mono text-xs" dir="ltr">
                          {fmt.num(s.filesTransferred)}
                        </TableCell>
                        <TableCell className="text-end font-mono text-xs" dir="ltr">
                          {fmt.bytes(s.transferred)}
                        </TableCell>
                        <TableCell className="text-end">
                          <span
                            className={cn(
                              "font-mono text-[11px] font-semibold",
                              s.status === "COMPLETED"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : s.status === "FAILED"
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-amber-600 dark:text-amber-500"
                            )}
                            dir="ltr"
                            title={s.error ?? undefined}
                          >
                            {s.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        {/* execute confirmation */}
        <AlertDialog open={confirmExecute} onOpenChange={setConfirmExecute}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sync.executeTitle")}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <p>{t("sync.executeIntro")}</p>
                  {plan && plan.summary.deleteLocal + plan.summary.deleteRemote > 0 ? (
                    <p className="text-amber-700 dark:text-amber-400">
                      {t("sync.executeDeletes", {
                        deletes: plan.summary.deleteLocal + plan.summary.deleteRemote,
                      })}
                    </p>
                  ) : null}
                  {plan && plan.summary.conflicts > 0 ? (
                    <p className="text-red-700 dark:text-red-400">
                      {t("sync.executeConflicts", {
                        conflicts: plan.summary.conflicts,
                      })}
                    </p>
                  ) : null}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => run.mutate()}>
                {t("misc.confirmProceed")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
