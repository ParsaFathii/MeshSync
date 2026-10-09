"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Plus,
  RadioTower,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { EmptyState } from "@/components/meshsync/empty-state";
import { HashChip } from "@/components/meshsync/hash-chip";
import { StatusDot, trustTone } from "@/components/meshsync/status-dot";
import { TrustBadge } from "@/components/meshsync/trust-badge";
import {
  DetailRow,
  InlineError,
  LoadingRows,
  SectionCard,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDevice, usePeers } from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query-keys";
import type { DeviceInfo, Peer } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

const ADDRESS_RE = /^([A-Za-z0-9._-]+):(\d{1,5})$/;

// ---------------------------------------------------------------------------
// Mesh strip — an honest SVG diagram of this device + its peers
// ---------------------------------------------------------------------------

function linkClass(trust: string): string {
  switch (trust) {
    case "TRUSTED":
      return "stroke-primary";
    case "PAIRING":
      return "stroke-amber-500";
    case "REVOKED":
      return "stroke-red-600 dark:stroke-red-500";
    default:
      return "stroke-stone-400 dark:stroke-stone-500";
  }
}

function MeshStrip({
  device,
  peers,
}: {
  device: DeviceInfo | undefined;
  peers: Peer[];
}) {
  const { t } = useI18n();
  const W = 640;
  const H = 230;
  const cx = W / 2;
  const cy = H / 2 + 8;
  const rx = 215;
  const ry = 72;

  const nodes = useMemo(
    () =>
      peers.map((p, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / peers.length;
        return {
          peer: p,
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
        };
      }),
    [peers, cx, cy, rx, ry]
  );

  const deviceName = device?.name ?? "…";

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${t("peers.meshDiagram")}: ${deviceName}, ${peers.length} peers`}
      >
        {nodes.map(({ peer, x, y }) => {
          const midX = (cx + x) / 2;
          const midY = (cy + y) / 2;
          return (
            <g key={`link-${peer.peerId}`}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                strokeWidth={peer.trust === "TRUSTED" ? 2 : 1.6}
                strokeDasharray={
                  peer.trust === "PAIRING"
                    ? "7 5"
                    : peer.trust === "DISCOVERED"
                      ? "2 6"
                      : peer.trust === "REVOKED"
                        ? undefined
                        : undefined
                }
                className={cn(linkClass(peer.trust), "fill-none")}
              />
              {peer.trust === "REVOKED" ? (
                <g
                  className="stroke-red-600 dark:stroke-red-500"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1={midX - 5} y1={midY - 5} x2={midX + 5} y2={midY + 5} />
                  <line x1={midX - 5} y1={midY + 5} x2={midX + 5} y2={midY - 5} />
                </g>
              ) : null}
            </g>
          );
        })}

        {/* peer nodes */}
        {nodes.map(({ peer, x, y }) => (
          <g key={`node-${peer.peerId}`}>
            <circle
              cx={x}
              cy={y}
              r={7}
              className={cn(
                "stroke-background dark:stroke-background",
                peer.online
                  ? "fill-emerald-600 dark:fill-emerald-500"
                  : "fill-stone-400 dark:fill-stone-600"
              )}
              strokeWidth={2}
            />
            <text
              x={x}
              y={y + 21}
              textAnchor="middle"
              className="fill-stone-600 font-mono text-[11px] dark:fill-stone-400"
            >
              {peer.name}
            </text>
          </g>
        ))}

        {/* this device node */}
        <circle cx={cx} cy={cy} r={10} className="fill-primary stroke-background dark:stroke-background" strokeWidth={2.5} />
        <circle cx={cx} cy={cy} r={15} className="fill-none stroke-primary/40" strokeWidth={1.5} />
        <text
          x={cx}
          y={cy + 32}
          textAnchor="middle"
          className="fill-foreground font-mono text-[12px] font-semibold"
        >
          {deviceName}
        </text>
        <text
          x={cx}
          y={cy - 22}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {t("peers.thisDevice")}
        </text>
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("peers.legend")}:</span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="2" aria-hidden="true"><line x1="0" y1="1" x2="20" y2="1" className="stroke-primary" strokeWidth="2" /></svg>
          {t("peers.legend.trusted")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="2" aria-hidden="true"><line x1="0" y1="1" x2="20" y2="1" className="stroke-amber-500" strokeWidth="2" strokeDasharray="5 3" /></svg>
          {t("peers.legend.pairing")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="2" aria-hidden="true"><line x1="0" y1="1" x2="20" y2="1" className="stroke-stone-400" strokeWidth="2" strokeDasharray="1 4" /></svg>
          {t("peers.legend.discovered")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="20" y2="3" className="stroke-red-600 dark:stroke-red-500" strokeWidth="2" />
            <line x1="8" y1="0" x2="14" y2="6" className="stroke-red-600 dark:stroke-red-500" strokeWidth="2" />
          </svg>
          {t("peers.legend.revoked")}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peer row + detail
// ---------------------------------------------------------------------------

function PeerRow({
  peer,
  selected,
  onSelect,
  onApprove,
  onRevoke,
  onRemoveRequest,
}: {
  peer: Peer;
  selected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onRevoke: () => void;
  onRemoveRequest: () => void;
}) {
  const { t, fmt } = useI18n();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(peer.address);
      setCopied(true);
      toast.success(t("common.copiedAddress"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("err.requestFailed"));
    }
  };

  return (
    <div
      className={cn(
        "group rounded-lg border p-3 transition-colors",
        selected
          ? "border-primary/40 bg-primary/5"
          : "bg-card hover:border-foreground/20"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-3 text-start focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-pressed={selected}
      >
        <StatusDot
          tone={peer.online ? "emerald" : "stone"}
          label={peer.online ? t("common.online") : t("common.offline")}
          className="mt-1.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm font-semibold text-foreground" dir="ltr">
              {peer.name}
            </span>
            <TrustBadge trust={peer.trust} />
            <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
              v{peer.version}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono" dir="ltr">{peer.address}</span>
            <span dir="auto">{t("peers.lastSeen")}: {fmt.relative(peer.lastSeen)}</span>
            <span dir="auto">
              {t("peers.sharedFolders")}: <span className="font-mono" dir="ltr">{peer.sharedFolders}</span>
            </span>
          </div>
        </div>
        <HashChip
          hash={peer.peerId}
          className="hidden sm:inline-flex"
          copyLabel={t("common.copy")}
        />
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 ps-1">
        {peer.trust === "PAIRING" ? (
          <Button type="button" size="sm" variant="outline" onClick={onApprove}>
            <Check className="size-3.5" aria-hidden="true" />
            {t("peers.approve")}
          </Button>
        ) : null}
        {peer.trust === "TRUSTED" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRevoke}
            className="text-amber-700 hover:text-amber-800 dark:text-amber-400"
          >
            <ShieldOff className="size-3.5" aria-hidden="true" />
            {t("peers.revoke")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={copyAddress}
          aria-label={t("peers.copyAddress")}
          title={peer.address}
        >
          {copied ? (
            <Check className="size-3.5 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-red-600 hover:text-red-700 dark:text-red-400"
          onClick={onRemoveRequest}
          aria-label={t("peers.remove")}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function PeerDetail({
  peer,
  port,
  onApprove,
  onRevoke,
  onRemoveRequest,
}: {
  peer: Peer;
  port: number;
  onApprove: () => void;
  onRevoke: () => void;
  onRemoveRequest: () => void;
}) {
  const { t, fmt } = useI18n();
  return (
    <SectionCard title={t("peers.selectedPeer")} className="h-full overflow-y-auto">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone={peer.online ? "emerald" : "stone"} />
          <span className="truncate font-mono text-sm font-semibold" dir="ltr">
            {peer.name}
          </span>
          <TrustBadge trust={peer.trust} />
        </div>
        <div className="divide-y">
          <DetailRow label={t("device.peerId")}>
            <HashChip hash={peer.peerId} copyLabel={t("common.copy")} />
          </DetailRow>
          <DetailRow label={t("peers.address")} mono>
            {peer.address}
          </DetailRow>
          <DetailRow label={t("common.version")} mono>
            v{peer.version}
          </DetailRow>
          <DetailRow label={t("device.platform")} mono>
            {peer.platform}
          </DetailRow>
          <DetailRow label={t("peers.lastSeen")}>
            {fmt.dateTime(peer.lastSeen)}
          </DetailRow>
          <DetailRow label={t("device.startedAt")}>
            {fmt.dateTime(peer.addedAt)}
          </DetailRow>
          <DetailRow label={t("peers.sharedFolders")} mono>
            {peer.sharedFolders}
          </DetailRow>
          <DetailRow label={t("common.status")} mono>
            {peer.online ? "ONLINE" : "OFFLINE"} · {peer.trust}
          </DetailRow>
        </div>

        {peer.trust === "DISCOVERED" ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {t("peers.discoveredNote")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {peer.trust === "PAIRING" ? (
            <Button type="button" size="sm" variant="outline" onClick={onApprove}>
              <Check className="size-3.5" aria-hidden="true" />
              {t("peers.approve")}
            </Button>
          ) : null}
          {peer.trust === "TRUSTED" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRevoke}
              className="text-amber-700 hover:text-amber-800 dark:text-amber-400"
            >
              <ShieldOff className="size-3.5" aria-hidden="true" />
              {t("peers.revoke")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-red-600 hover:text-red-700 dark:text-red-400"
            onClick={onRemoveRequest}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("peers.remove")}
          </Button>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground" dir="ltr">
          agent port {port}
        </p>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function PeersWorkspace({ port }: { port: number }) {
  const { t } = useI18n();
  const peers = usePeers(port);
  const device = useDevice(port);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const selectedPeerId = useConsoleStore((s) => s.selectedPeerId[port]) ?? null;
  const setSelectedPeerId = useConsoleStore((s) => s.setSelectedPeerId);

  const [pairOpen, setPairOpen] = useState(false);
  const [pairAddress, setPairAddress] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Peer | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Peer | null>(null);

  const list = peers.data?.peers ?? [];
  const selected = list.find((p) => p.peerId === selectedPeerId) ?? null;

  const invalidatePeers = () =>
    void queryClient.invalidateQueries({ queryKey: qk.peers(port) });

  const approve = useMutation({
    mutationFn: (peerId: string) => api.approvePeer(port, peerId),
    onSuccess: (resp) => {
      invalidatePeers();
      toast.success(t("toast.peerApproved", { name: resp.peer.name }));
    },
    onError: (err) => toastAgentError(err, t),
  });

  const revoke = useMutation({
    mutationFn: (peerId: string) => api.revokePeer(port, peerId),
    onSuccess: (resp) => {
      invalidatePeers();
      toast.success(t("toast.peerRevoked", { name: resp.peer.name }));
      setConfirmRevoke(null);
    },
    onError: (err) => toastAgentError(err, t),
  });

  const remove = useMutation({
    mutationFn: (peerId: string) => api.removePeer(port, peerId),
    onSuccess: (_void, peerId) => {
      invalidatePeers();
      const name = list.find((p) => p.peerId === peerId)?.name ?? "";
      toast.success(t("toast.peerRemoved", { name }));
      setConfirmRemove(null);
      if (selectedPeerId === peerId) setSelectedPeerId(port, null);
    },
    onError: (err) => toastAgentError(err, t),
  });

  const pair = useMutation({
    mutationFn: (address: string) => api.pairPeer(port, address),
    onSuccess: () => {
      invalidatePeers();
      toast.success(t("toast.pairRequested"));
      setPairOpen(false);
      setPairAddress("");
      setPairError(null);
    },
    onError: (err) => setPairError(api.isAgentError(err) ? err.message : null),
  });

  const scan = useMutation({
    mutationFn: () => api.scanDiscovery(port),
    onSuccess: (resp) => {
      invalidatePeers();
      toast.success(t("toast.scanFound", { count: resp.found.length }));
    },
    onError: (err) => toastAgentError(err, t),
  });

  const submitPair = () => {
    const value = pairAddress.trim();
    const match = ADDRESS_RE.exec(value);
    if (!match) {
      setPairError(t("validation.invalidAddress"));
      return;
    }
    const portNumber = Number(match[2]);
    if (portNumber < 1 || portNumber > 65535) {
      setPairError(t("validation.port"));
      return;
    }
    setPairError(null);
    pair.mutate(value);
  };

  const pairDialog = (
    <Dialog open={pairOpen} onOpenChange={setPairOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialog.pairTitle")}</DialogTitle>
          <DialogDescription>{t("peers.pairExplain")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pair-address">{t("peers.pairAddress")}</Label>
          <Input
            id="pair-address"
            value={pairAddress}
            onChange={(e) => setPairAddress(e.target.value)}
            placeholder={t("peers.pairAddressPlaceholder")}
            className="font-mono"
            dir="ltr"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPair();
            }}
          />
          {pairError ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {pairError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setPairOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={submitPair}
            disabled={pair.isPending || pairAddress.trim().length === 0}
          >
            {pair.isPending ? t("peers.pairSubmit") + "…" : t("peers.pairSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const confirmDialogs = (
    <>
      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("peers.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("peers.removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => confirmRemove && remove.mutate(confirmRemove.peerId)}
            >
              {t("peers.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("peers.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("peers.revokeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => confirmRevoke && revoke.mutate(confirmRevoke.peerId)}
            >
              {t("peers.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  const header = (
    <WorkspaceHeader
      title={t("peers.title")}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
          >
            <RadioTower
              className={cn("size-3.5", scan.isPending && "animate-pulse")}
              aria-hidden="true"
            />
            {scan.isPending ? t("peers.scanning") : t("peers.scan")}
          </Button>
          <Button type="button" size="sm" onClick={() => setPairOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("peers.pair")}
          </Button>
        </>
      }
    />
  );

  const listPane = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {peers.isLoading ? <LoadingRows rows={4} /> : null}
      {peers.isError ? <InlineError error={peers.error} /> : null}
      {peers.data && list.length === 0 ? (
        <EmptyState
          kind="peers"
          title={t("peers.noPeers")}
          hint={t("peers.noPeersHint")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => scan.mutate()}
                disabled={scan.isPending}
              >
                <RadioTower className="size-3.5" aria-hidden="true" />
                {t("peers.scan")}
              </Button>
              <Button type="button" size="sm" onClick={() => setPairOpen(true)}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t("peers.pair")}
              </Button>
            </div>
          }
        />
      ) : null}
      {list.length > 0 ? (
        <div className="flex flex-col gap-2">
          {list.map((peer) => (
            <PeerRow
              key={peer.peerId}
              peer={peer}
              selected={peer.peerId === selectedPeerId}
              onSelect={() => setSelectedPeerId(port, peer.peerId)}
              onApprove={() => approve.mutate(peer.peerId)}
              onRevoke={() => setConfirmRevoke(peer)}
              onRemoveRequest={() => setConfirmRemove(peer)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  const detailPane = selected ? (
    <PeerDetail
      peer={selected}
      port={port}
      onApprove={() => approve.mutate(selected.peerId)}
      onRevoke={() => setConfirmRevoke(selected)}
      onRemoveRequest={() => setConfirmRemove(selected)}
    />
  ) : (
    <SectionCard title={t("peers.selectedPeer")} className="hidden md:block">
      <EmptyState
        kind="generic"
        title={t("peers.noPeerSelected")}
        hint={t("peers.noPeerSelectedHint")}
      />
    </SectionCard>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        {header}
        <MeshStrip device={device.data} peers={list} />
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {listPane}
            {selected ? detailPane : null}
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="min-h-[22rem]">
            <ResizablePanel defaultSize={58} minSize={35} className="min-w-0">
              <div className="h-full pe-1">{listPane}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={42} minSize={28} className="min-w-0">
              <div className="h-full ps-1">{detailPane}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        {pairDialog}
        {confirmDialogs}
      </div>
    </div>
  );
}
