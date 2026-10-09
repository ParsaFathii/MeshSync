"use client";

import { useQuery } from "@tanstack/react-query";

import type { AgentEndpointInfo } from "./types";

/** Agent endpoint registry served by the Next.js web backend. */
export function useAgentEndpoints() {
  return useQuery({
    queryKey: ["web", "agents"],
    queryFn: async (): Promise<AgentEndpointInfo[]> => {
      const res = await fetch("/api/web/agents", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`agent registry request failed: HTTP ${res.status}`);
      }
      return (await res.json()) as AgentEndpointInfo[];
    },
    staleTime: 30_000,
    retry: 1,
  });
}
