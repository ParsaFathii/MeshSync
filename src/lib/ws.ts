"use client";

/**
 * MeshSync live event stream.
 *
 * One WebSocket per selected agent through the gateway
 * (`/api/v1/events/ws?XTransformPort={port}`), pushing frames into the
 * TanStack Query caches. Auto-reconnects with exponential backoff (1s → 30s
 * cap), sends a client ping every 25s and invalidates all queries on
 * (re)connect so stale WS state is never treated as authoritative.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  EVENTS_CAP,
  qk,
  upsertTransfer,
  type EventsCache,
  type TransfersCache,
} from "./query-keys";
import { pushSpeedSample, setWsStateGlobal } from "@/state/console";
import type { AgentEvent, WsFrame } from "./types";

const PING_INTERVAL_MS = 25_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

function wsUrl(port: number): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/v1/events/ws?XTransformPort=${port}`;
}

/**
 * Mounts the WS bridge for the selected agent. Returns nothing — the
 * connection state lives in the console store (useConsoleStore.wsState).
 */
export function useAgentEvents(port: number): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const clearTimers = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(
        BACKOFF_START_MS * 2 ** attempt,
        BACKOFF_CAP_MS
      );
      attempt += 1;
      setWsStateGlobal("reconnecting");
      reconnectTimer = setTimeout(connect, delay);
    };

    const handleMessage = (raw: MessageEvent) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(String(raw.data)) as WsFrame;
      } catch {
        return;
      }
      if (!frame || typeof frame.kind !== "string") return;

      switch (frame.kind) {
        case "hello":
        case "device":
          queryClient.setQueryData(qk.device(port), frame.device);
          break;
        case "peers":
          queryClient.setQueryData(qk.peers(port), { peers: frame.peers });
          break;
        case "transfer": {
          queryClient.setQueryData<TransfersCache>(
            qk.transfers(port),
            (old) => upsertTransfer(old, frame.transfer)
          );
          if (frame.transfer.speedBps > 0) {
            pushSpeedSample(frame.transfer.id, frame.transfer.speedBps);
          }
          break;
        }
        case "event": {
          const event: AgentEvent = frame.event;
          queryClient.setQueryData<EventsCache>(qk.events(port), (old = []) => {
            if (old.some((e) => e.id === event.id)) return old;
            const next = [event, ...old];
            return next.length > EVENTS_CAP ? next.slice(0, EVENTS_CAP) : next;
          });
          break;
        }
        case "pong":
          break;
        default:
          break;
      }
    };

    const connect = () => {
      if (disposed) return;
      setWsStateGlobal(attempt === 0 ? "connecting" : "reconnecting");

      try {
        socket = new WebSocket(wsUrl(port));
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (disposed) {
          socket?.close();
          return;
        }
        attempt = 0;
        setWsStateGlobal("live");
        // Fresh connection → REST state is the source of truth; refetch all.
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey as unknown[];
            return key[0] === "agent" && key[1] === port;
          },
        });
        pingTimer = setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            try {
              socket.send(JSON.stringify({ kind: "ping" }));
            } catch {
              /* send failures surface via onclose */
            }
          }
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = handleMessage;

      socket.onclose = () => {
        clearTimers();
        if (!disposed) scheduleReconnect();
      };

      socket.onerror = () => {
        // onclose always follows onerror for failed sockets.
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimers();
      setWsStateGlobal("idle");
      if (socket) {
        try {
          socket.onclose = null;
          socket.onerror = null;
          socket.onmessage = null;
          socket.onopen = null;
          socket.close();
        } catch {
          /* ignore */
        }
        socket = null;
      }
    };
  }, [port, queryClient]);
}
