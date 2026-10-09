"use client";

/**
 * TanStack Query hooks for every MeshSync agent resource.
 * Query keys are namespaced by agent port (see lib/query-keys.ts) so several
 * agent endpoints can be cached at once and the WS bridge can write into the
 * exact same caches.
 */

import { useCallback, useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import * as api from "@/lib/agent-api";
import {
  EVENTS_INITIAL_LIMIT,
  mergeEventsDesc,
  qk,
  TRANSFERS_LIMIT,
  upsertTransfer,
  type EventsCache,
  type TransfersCache,
} from "@/lib/query-keys";
import { useConsoleStore } from "@/state/console";
import type {
  AgentEvent,
  Conflict,
  DeviceInfo,
  FileDetail,
  FilesResponse,
  Folder,
  Health,
  Peer,
  Settings,
  SyncSession,
  TransferActionKind,
  TransferDetail,
  TransferStatus,
} from "@/lib/types";

const ACTIVE_TRANSFER_STATUSES: ReadonlySet<TransferStatus> = new Set([
  "QUEUED",
  "PREPARING",
  "TRANSFERRING",
  "VERIFYING",
]);

const agentQueryDefaults = {
  retry: false as const,
  refetchOnWindowFocus: true,
};

// ---------------------------------------------------------------------------
// Health / reachability
// ---------------------------------------------------------------------------

export function useHealth(port: number): UseQueryResult<Health> {
  return useQuery({
    queryKey: qk.health(port),
    queryFn: () => api.getHealth(port),
    ...agentQueryDefaults,
    refetchInterval: 5_000,
  });
}

/** Invalidate every cached agent query (Retry button in the banner). */
export function useInvalidateAgent(port: number) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey as unknown[];
        return key[0] === "agent" && key[1] === port;
      },
    });
  }, [queryClient, port]);
}

/**
 * Live uptime: the agent's last reported uptimeSeconds plus the measured
 * time elapsed since that sample — no simulation, pure arithmetic.
 */
export function useLiveUptime(port: number): number | null {
  const health = useHealth(port);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  if (!health.data) return null;
  const elapsed = Math.max(0, Date.now() - health.dataUpdatedAt) / 1000;
  return health.data.uptimeSeconds + elapsed;
}

// ---------------------------------------------------------------------------
// Core resources
// ---------------------------------------------------------------------------

export function useDevice(port: number): UseQueryResult<DeviceInfo> {
  return useQuery({
    queryKey: qk.device(port),
    queryFn: () => api.getDevice(port),
    ...agentQueryDefaults,
    refetchInterval: 10_000,
  });
}

export function usePeers(port: number): UseQueryResult<{ peers: Peer[] }> {
  return useQuery({
    queryKey: qk.peers(port),
    queryFn: () => api.getPeers(port),
    ...agentQueryDefaults,
    refetchInterval: 5_000,
  });
}

export function useFolders(port: number): UseQueryResult<{
  folders: Folder[];
}> {
  return useQuery({
    queryKey: qk.folders(port),
    queryFn: () => api.getFolders(port),
    ...agentQueryDefaults,
    refetchInterval: 30_000,
  });
}

export function useConflicts(port: number): UseQueryResult<{
  conflicts: Conflict[];
}> {
  return useQuery({
    queryKey: qk.conflicts(port),
    queryFn: () => api.getConflicts(port),
    ...agentQueryDefaults,
    refetchInterval: 10_000,
  });
}

export function useSettings(port: number): UseQueryResult<Settings> {
  return useQuery({
    queryKey: qk.settings(port),
    queryFn: () => api.getSettings(port),
    ...agentQueryDefaults,
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function useFiles(
  port: number,
  folderId: number | null,
  path: string
): UseQueryResult<FilesResponse> {
  const enabled = folderId !== null;
  return useQuery({
    queryKey: qk.files(port, folderId ?? -1, path),
    queryFn: () => api.listFiles(port, folderId as number, path),
    ...agentQueryDefaults,
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function useFileDetail(
  port: number,
  folderId: number | null,
  filePath: string | null
): UseQueryResult<FileDetail> {
  const enabled = folderId !== null && filePath !== null;
  return useQuery({
    queryKey: qk.fileDetail(port, folderId ?? -1, filePath ?? ""),
    queryFn: () =>
      api.fileDetail(port, folderId as number, filePath as string),
    ...agentQueryDefaults,
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export function useTransfers(
  port: number
): UseQueryResult<TransfersCache> {
  return useQuery({
    queryKey: qk.transfers(port),
    queryFn: () => api.getTransfers(port, { limit: TRANSFERS_LIMIT }),
    ...agentQueryDefaults,
    refetchInterval: (query) => {
      const data = query.state.data as TransfersCache | undefined;
      const anyActive =
        data?.transfers.some((t) => ACTIVE_TRANSFER_STATUSES.has(t.status)) ??
        false;
      return anyActive ? 3_000 : 15_000;
    },
  });
}

/** Detail (with chunk map) for one transfer — live while it is active. */
export function useTransfer(
  port: number,
  transferId: string | null
): UseQueryResult<TransferDetail> {
  const enabled = transferId !== null;
  return useQuery({
    queryKey: qk.transfer(port, transferId ?? ""),
    queryFn: () => api.getTransfer(port, transferId as string),
    ...agentQueryDefaults,
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as TransferDetail | undefined;
      const active =
        data ? ACTIVE_TRANSFER_STATUSES.has(data.transfer.status) : true;
      return active ? 2_000 : false;
    },
  });
}

/** Pause / resume / cancel / retry with optimistic status update. */
export function useTransferAction(port: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      action: TransferActionKind;
      optimistic: TransferStatus;
    }) => api.transferAction(port, vars.id, vars.action),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.transfers(port) });
      const prev = queryClient.getQueryData<TransfersCache>(
        qk.transfers(port)
      );
      if (prev) {
        queryClient.setQueryData<TransfersCache>(qk.transfers(port), {
          transfers: prev.transfers.map((t) =>
            t.id === vars.id ? { ...t, status: vars.optimistic } : t
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData<TransfersCache>(
          qk.transfers(port),
          ctx.prev
        );
      }
      void queryClient.invalidateQueries({ queryKey: qk.transfers(port) });
    },
    onSuccess: (resp) => {
      queryClient.setQueryData<TransfersCache>(qk.transfers(port), (old) =>
        upsertTransfer(old, resp.transfer)
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export function useSessions(
  port: number
): UseQueryResult<{ sessions: SyncSession[] }> {
  return useQuery({
    queryKey: qk.sessions(port),
    queryFn: () => api.getSessions(port),
    ...agentQueryDefaults,
    refetchInterval: (query) => {
      const data = query.state.data as
        | { sessions: SyncSession[] }
        | undefined;
      const running =
        data?.sessions.some((s) => s.finishedAt === null) ?? false;
      return running ? 5_000 : 30_000;
    },
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function useEvents(port: number): UseQueryResult<AgentEvent[]> {
  const queryClient = useQueryClient();
  const eventsLimit = useConsoleStore((s) => s.eventsLimit[port]);
  return useQuery({
    queryKey: qk.events(port),
    queryFn: async () => {
      const limit =
        useConsoleStore.getState().eventsLimit[port] ??
        EVENTS_INITIAL_LIMIT;
      const rest = await api.getEvents(port, {
        sinceEventId: 0,
        limit,
      });
      const current =
        queryClient.getQueryData<EventsCache>(qk.events(port)) ?? [];
      return mergeEventsDesc(current, rest.events);
    },
    ...agentQueryDefaults,
    refetchInterval: 10_000,
  });
}

/** Grows the REST backfill window and refetches (Load more). */
export function useLoadMoreEvents(port: number) {
  const queryClient = useQueryClient();
  const setEventsLimit = useConsoleStore((s) => s.setEventsLimit);
  return useCallback(() => {
    const current =
      useConsoleStore.getState().eventsLimit[port] ??
      EVENTS_INITIAL_LIMIT;
    setEventsLimit(port, current + 100);
    void queryClient.refetchQueries({ queryKey: qk.events(port) });
  }, [queryClient, port, setEventsLimit]);
}

// Re-export so components can build WS-compatible writes without imports
// scattered across the codebase.
export { qk, TRANSFERS_LIMIT };
