"use client";

import { useState } from "react";
import {
  ArrowDownUp,
  Check,
  Cpu,
  Files,
  FolderTree,
  HardDrive,
  KeyRound,
  Network,
  Pencil,
  RefreshCw,
  Timer,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HashChip } from "@/components/meshsync/hash-chip";
import { StatTile } from "@/components/meshsync/stat-tile";
import {
  DetailRow,
  InlineError,
  LoadingRows,
  SectionCard,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import {
  useDevice,
  useHealth,
  useInvalidateAgent,
  useLiveUptime,
} from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query-keys";
import type { DeviceInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

function DeviceNameEditor({
  port,
  currentName,
}: {
  port: number;
  currentName: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);

  const startEditing = () => {
    setName(currentName);
    setEditing(true);
  };

  const rename = useMutation({
    mutationFn: (next: string) => api.putSettings(port, { deviceName: next }),
    onSuccess: (settings) => {
      queryClient.setQueryData(qk.device(port), (old: DeviceInfo) =>
        old ? { ...old, name: settings.deviceName } : old
      );
      void queryClient.invalidateQueries({ queryKey: qk.settings(port) });
      toast.success(t("toast.savedName", { name: settings.deviceName }));
      setEditing(false);
    },
    onError: (err) => toastAgentError(err, t),
  });

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground" dir="auto">
          {currentName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t("device.rename")}
          title={t("device.rename")}
          onClick={startEditing}
        >
          <Pencil className="size-3" aria-hidden="true" />
        </Button>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-7 w-40 text-sm"
        maxLength={64}
        aria-label={t("device.deviceName")}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) rename.mutate(name.trim());
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button
        type="button"
        size="icon"
        className="size-7"
        aria-label={t("common.save")}
        disabled={!name.trim() || rename.isPending}
        onClick={() => rename.mutate(name.trim())}
      >
        <Check className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={t("common.cancel")}
        onClick={() => setEditing(false)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </span>
  );
}

export function DeviceWorkspace({ port }: { port: number }) {
  const { t, fmt } = useI18n();
  const device = useDevice(port);
  const health = useHealth(port);
  const uptime = useLiveUptime(port);
  const invalidate = useInvalidateAgent(port);

  const stats = device.data?.stats;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        <WorkspaceHeader
          title={t("device.title")}
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={invalidate}
              disabled={device.isFetching}
            >
              <RefreshCw
                className={cn("size-3.5", device.isFetching && "animate-spin")}
                aria-hidden="true"
              />
              {t("common.refresh")}
            </Button>
          }
        />

        {device.isLoading ? <LoadingRows rows={4} /> : null}
        {device.isError ? <InlineError error={device.error} /> : null}

        {device.data ? (
          <>
            <SectionCard title={t("device.identity")}>
              <div className="flex flex-col gap-x-8 gap-y-0 md:flex-row">
                <div className="min-w-0 flex-1">
                  <DetailRow label={t("device.deviceName")}>
                    <span className="contents">
                      <DeviceNameEditor
                        port={port}
                        currentName={device.data.name}
                      />
                    </span>
                  </DetailRow>
                  <DetailRow label={t("device.peerId")}>
                    <HashChip hash={device.data.peerId} copyLabel={t("common.copy")} />
                  </DetailRow>
                  <DetailRow label={t("device.keyFingerprint")} mono>
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={device.data.keyFingerprint}
                    >
                      <KeyRound className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{device.data.keyFingerprint}</span>
                    </span>
                  </DetailRow>
                  <DetailRow label={t("device.platform")} mono>
                    {device.data.platform}
                  </DetailRow>
                  <DetailRow label={t("device.startedAt")}>
                    {fmt.dateTime(device.data.startedAt)}
                  </DetailRow>
                </div>
                <div className="min-w-0 flex-1">
                  <DetailRow label={t("device.version")} mono>
                    v{device.data.version}
                  </DetailRow>
                  <DetailRow label={t("device.ports")} mono>
                    API {device.data.apiPort} · PEER {device.data.peerPort}
                  </DetailRow>
                  <DetailRow label={t("device.uptime")} mono>
                    {fmt.uptime(uptime)}
                  </DetailRow>
                  <DetailRow label={t("device.nativeEngine")}>
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={t("device.nativeEngineHint")}
                    >
                      <Cpu className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="font-mono text-xs" dir="ltr">
                        {device.data.nativeEngine || "—"}
                      </span>
                    </span>
                  </DetailRow>
                  <DetailRow label={t("common.status")} mono>
                    {health.data
                      ? `${health.data.status} · db ${health.data.dbOk ? "ok" : "error"}`
                      : "—"}
                  </DetailRow>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("device.renameHint")}
              </p>
            </SectionCard>

            <section aria-label={t("device.stats")} className="flex flex-wrap gap-3">
              <StatTile
                label={t("device.folders")}
                value={fmt.num(stats?.folders)}
                icon={FolderTree}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.filesIndexed")}
                value={fmt.num(stats?.filesIndexed)}
                icon={Files}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.bytesIndexed")}
                value={fmt.bytes(stats?.bytesIndexed)}
                icon={HardDrive}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.peersTrusted")}
                value={fmt.num(stats?.peersTrusted)}
                icon={Network}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.peersOnline")}
                value={fmt.num(stats?.peersOnline)}
                icon={Network}
                tone={stats && stats.peersOnline > 0 ? "emerald" : "default"}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.transfersActive")}
                value={fmt.num(stats?.transfersActive)}
                icon={ArrowDownUp}
                tone={stats && stats.transfersActive > 0 ? "amber" : "default"}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.transfersCompleted")}
                value={fmt.num(stats?.transfersCompleted)}
                icon={ArrowDownUp}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.conflictsOpen")}
                value={fmt.num(stats?.conflictsOpen)}
                icon={TriangleAlert}
                tone={stats && stats.conflictsOpen > 0 ? "red" : "default"}
                className="min-w-[8rem] flex-1"
              />
              <StatTile
                label={t("device.lastSync")}
                value={
                  stats?.lastSyncAt ? fmt.dateIso(stats.lastSyncAt) : t("common.never")
                }
                hint={stats?.lastSyncAt ? fmt.relative(stats.lastSyncAt) : undefined}
                icon={Timer}
                className="min-w-[8rem] flex-1"
              />
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
