"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { ConnectionBanner } from "@/components/meshsync/connection-banner";
import { NavRail, NavStrip } from "@/components/console/nav-rail";
import { StatusStrip } from "@/components/console/status-strip";
import { TopBar } from "@/components/console/top-bar";
import {
  DeviceWorkspace,
} from "@/components/workspaces/device-workspace";
import { PeersWorkspace } from "@/components/workspaces/peers-workspace";
import { FoldersWorkspace } from "@/components/workspaces/folders-workspace";
import { FilesWorkspace } from "@/components/workspaces/files-workspace";
import { SyncWorkspace } from "@/components/workspaces/sync-workspace";
import { TransfersWorkspace } from "@/components/workspaces/transfers-workspace";
import { ConflictsWorkspace } from "@/components/workspaces/conflicts-workspace";
import { ActivityWorkspace } from "@/components/workspaces/activity-workspace";
import { SettingsWorkspace } from "@/components/workspaces/settings-workspace";
import { useHealth, useInvalidateAgent } from "@/hooks/use-agent-data";
import { useAgentEndpoints } from "@/hooks/use-web-api";
import { useAgentEvents } from "@/lib/ws";
import { useConsoleStore, type Workspace } from "@/state/console";

function WorkspaceById({ id, port }: { id: Workspace; port: number }) {
  switch (id) {
    case "device":
      return <DeviceWorkspace port={port} />;
    case "peers":
      return <PeersWorkspace port={port} />;
    case "folders":
      return <FoldersWorkspace port={port} />;
    case "files":
      return <FilesWorkspace port={port} />;
    case "sync":
      return <SyncWorkspace port={port} />;
    case "transfers":
      return <TransfersWorkspace port={port} />;
    case "conflicts":
      return <ConflictsWorkspace port={port} />;
    case "activity":
      return <ActivityWorkspace port={port} />;
    case "settings":
      return <SettingsWorkspace port={port} />;
    default:
      return null;
  }
}

/** The MeshSync Console shell: top bar, nav rail, workspace area, status strip. */
export function MeshSyncConsole() {
  const port = useConsoleStore((s) => s.selectedAgentPort);
  const workspace = useConsoleStore((s) => s.activeWorkspace);

  // Live event stream bridge (one WS for the selected agent).
  useAgentEvents(port);

  // Keep the selected port aligned with the agent registry.
  const registry = useAgentEndpoints();
  useEffect(() => {
    const list = registry.data;
    if (list && list.length > 0 && !list.some((a) => a.port === port)) {
      useConsoleStore.getState().setSelectedAgentPort(list[0].port);
    }
  }, [registry.data, port]);

  const health = useHealth(port);
  const invalidateAgent = useInvalidateAgent(port);
  const unreachable = health.isError;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <header className="shrink-0">
        <TopBar />
        <NavStrip />
      </header>

      <div className="flex min-h-0 flex-1">
        <NavRail />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {unreachable ? (
            <div className="shrink-0 px-4 pt-3 sm:px-6">
              <ConnectionBanner
                port={port}
                onRetry={invalidateAgent}
                isRetrying={health.isFetching}
              />
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${port}:${workspace}`}
                className="h-full"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                <WorkspaceById id={workspace} port={port} />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <StatusStrip />
    </div>
  );
}
