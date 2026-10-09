import { EnumBadge, type BadgeTone } from "./enum-badge";

import type {
  ConflictResolution,
  ConflictStatus,
  FileSyncState,
  PlanActionState,
  TransferStatus,
} from "@/lib/types";

/** SYNCED / PENDING / SYNCING / CONFLICT / LOCAL_ONLY — latin mono badge. */
export function SyncStateBadge({ state }: { state: FileSyncState | null }) {
  if (!state) return <EnumBadge value="—" tone="stone" />;
  const tone: BadgeTone =
    state === "SYNCED"
      ? "emerald"
      : state === "PENDING" || state === "SYNCING"
        ? "amber"
        : state === "CONFLICT"
          ? "red"
          : "stone";
  return <EnumBadge value={state} tone={tone} />;
}

/** Transfer status badge (QUEUED … FAILED / CANCELLED). */
export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const tone: BadgeTone =
    status === "COMPLETED"
      ? "emerald"
      : status === "TRANSFERRING" ||
          status === "PREPARING" ||
          status === "VERIFYING"
        ? "amber"
        : status === "FAILED"
          ? "red"
          : "stone";
  return <EnumBadge value={status} tone={tone} />;
}

/** Sync plan action state badge (UNCHANGED … DELETE_REMOTE). */
export function PlanStateBadge({ state }: { state: PlanActionState }) {
  const tone: BadgeTone =
    state === "CONFLICT" || state === "DELETE_LOCAL" || state === "DELETE_REMOTE"
      ? "red"
      : state === "LOCAL_MODIFIED" ||
          state === "REMOTE_MODIFIED" ||
          state === "REMOTE_ONLY"
        ? "amber"
        : "stone";
  return <EnumBadge value={state} tone={tone} />;
}

/** Conflict status + resolution badge. */
export function ConflictStatusBadge({
  status,
  resolution,
}: {
  status: ConflictStatus;
  resolution?: ConflictResolution | null;
}) {
  if (status === "RESOLVED") {
    return (
      <EnumBadge
        value={resolution ? `RESOLVED·${resolution}` : "RESOLVED"}
        tone="emerald"
      />
    );
  }
  return <EnumBadge value="OPEN" tone="red" />;
}
