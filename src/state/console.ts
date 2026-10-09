"use client";

/**
 * MeshSync Console client state (Zustand):
 * selected agent endpoint, active workspace, language, WS connection state,
 * and workspace-scoped UI state namespaced per agent port.
 */

import { create } from "zustand";

import type { SyncPlan } from "@/lib/types";

export type Workspace =
  | "device"
  | "peers"
  | "folders"
  | "files"
  | "sync"
  | "transfers"
  | "conflicts"
  | "activity"
  | "settings";

export type WsConnectionState = "idle" | "connecting" | "live" | "reconnecting";

export type ConsoleLang = "en" | "fa";

const SPEED_SAMPLE_CAP = 64;

interface ConsoleState {
  /** Agent API port currently driving the whole console. */
  selectedAgentPort: number;
  activeWorkspace: Workspace;
  language: ConsoleLang;
  wsState: WsConnectionState;

  // workspace-scoped state, namespaced by agent port ------------------------
  selectedPeerId: Record<number, string | null>;
  selectedFolderId: Record<number, number | null>;
  filesPath: Record<number, string>;
  filesSelected: Record<number, string | null>;
  syncPeerId: Record<number, string | null>;
  syncFolderId: Record<number, number | null>;
  syncPlan: Record<number, SyncPlan | null>;
  conflictId: Record<number, number | null>;
  eventsLimit: Record<number, number>;

  /** transferId → recent real speedBps samples (newest last). */
  speedSamples: Record<string, number[]>;

  // actions -----------------------------------------------------------------
  setSelectedAgentPort: (port: number) => void;
  setActiveWorkspace: (ws: Workspace) => void;
  setLanguage: (lang: ConsoleLang) => void;
  setWsState: (state: WsConnectionState) => void;

  setSelectedPeerId: (port: number, peerId: string | null) => void;
  setSelectedFolderId: (port: number, folderId: number | null) => void;
  setFilesPath: (port: number, path: string) => void;
  setFilesSelected: (port: number, name: string | null) => void;
  setSyncPeerId: (port: number, peerId: string | null) => void;
  setSyncFolderId: (port: number, folderId: number | null) => void;
  setSyncPlan: (port: number, plan: SyncPlan | null) => void;
  setConflictId: (port: number, conflictId: number | null) => void;
  setEventsLimit: (port: number, limit: number) => void;
  pushSpeedSample: (transferId: string, speedBps: number) => void;
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  selectedAgentPort: 3040,
  activeWorkspace: "device",
  language: "en",
  wsState: "idle",

  selectedPeerId: {},
  selectedFolderId: {},
  filesPath: {},
  filesSelected: {},
  syncPeerId: {},
  syncFolderId: {},
  syncPlan: {},
  conflictId: {},
  eventsLimit: {},

  speedSamples: {},

  setSelectedAgentPort: (port) => set({ selectedAgentPort: port }),
  setActiveWorkspace: (ws) => set({ activeWorkspace: ws }),
  setLanguage: (lang) => set({ language: lang }),
  setWsState: (wsState) => set({ wsState }),

  setSelectedPeerId: (port, peerId) =>
    set((s) => ({ selectedPeerId: { ...s.selectedPeerId, [port]: peerId } })),
  setSelectedFolderId: (port, folderId) =>
    set((s) => ({
      selectedFolderId: { ...s.selectedFolderId, [port]: folderId },
    })),
  setFilesPath: (port, path) =>
    set((s) => ({ filesPath: { ...s.filesPath, [port]: path } })),
  setFilesSelected: (port, name) =>
    set((s) => ({ filesSelected: { ...s.filesSelected, [port]: name } })),
  setSyncPeerId: (port, peerId) =>
    set((s) => ({ syncPeerId: { ...s.syncPeerId, [port]: peerId } })),
  setSyncFolderId: (port, folderId) =>
    set((s) => ({ syncFolderId: { ...s.syncFolderId, [port]: folderId } })),
  setSyncPlan: (port, plan) =>
    set((s) => ({ syncPlan: { ...s.syncPlan, [port]: plan } })),
  setConflictId: (port, conflictId) =>
    set((s) => ({ conflictId: { ...s.conflictId, [port]: conflictId } })),
  setEventsLimit: (port, limit) =>
    set((s) => ({ eventsLimit: { ...s.eventsLimit, [port]: limit } })),
  pushSpeedSample: (transferId, speedBps) =>
    set((s) => {
      const prev = s.speedSamples[transferId] ?? [];
      const next = [...prev, Math.max(0, speedBps)];
      if (next.length > SPEED_SAMPLE_CAP) next.splice(0, next.length - SPEED_SAMPLE_CAP);
      return { speedSamples: { ...s.speedSamples, [transferId]: next } };
    }),
}));

/** Imperative helper usable outside React (WS message handling). */
export function pushSpeedSample(transferId: string, speedBps: number) {
  useConsoleStore.getState().pushSpeedSample(transferId, speedBps);
}

export function setWsStateGlobal(state: WsConnectionState) {
  useConsoleStore.getState().setWsState(state);
}
