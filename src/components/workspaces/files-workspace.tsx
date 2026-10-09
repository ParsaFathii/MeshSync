"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  type LucideIcon,
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
import { Textarea } from "@/components/ui/textarea";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChunkProgress } from "@/components/meshsync/chunk-progress";
import { EmptyState } from "@/components/meshsync/empty-state";
import { HashChip } from "@/components/meshsync/hash-chip";
import { SyncStateBadge } from "@/components/meshsync/sync-state-badge";
import {
  DetailRow,
  InlineError,
  LoadingRows,
  SectionCard,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useFileDetail,
  useFiles,
  useFolders,
  usePeers,
} from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query-keys";
import type { FileEntry, FileSyncState } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

/** Render helper (not a component): returns the file-type glyph element. */
function fileGlyph(name: string, className: string): React.ReactNode {
  const lower = name.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext))
    return <FileImage className={className} aria-hidden="true" />;
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext))
    return <FileVideo className={className} aria-hidden="true" />;
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext))
    return <FileAudio className={className} aria-hidden="true" />;
  if (["zip", "tar", "gz", "bz2", "xz", "7z", "rar"].includes(ext))
    return <FileArchive className={className} aria-hidden="true" />;
  if (
    ["js", "ts", "tsx", "jsx", "json", "py", "go", "rs", "c", "cpp", "h", "sh", "yaml", "yml", "toml"].includes(
      ext
    )
  )
    return <FileCode className={className} aria-hidden="true" />;
  if (["txt", "md", "log", "csv"].includes(ext))
    return <FileText className={className} aria-hidden="true" />;
  return <File className={className} aria-hidden="true" />;
}

function iconForEntry(entry: FileEntry): LucideIcon {
  if (entry.type === "dir") return Folder;
  const lower = entry.name.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext))
    return FileImage;
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return FileVideo;
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) return FileAudio;
  if (["zip", "tar", "gz", "bz2", "xz", "7z", "rar"].includes(ext))
    return FileArchive;
  if (
    ["js", "ts", "tsx", "jsx", "json", "py", "go", "rs", "c", "cpp", "h", "sh", "yaml", "yml", "toml"].includes(
      ext
    )
  )
    return FileCode;
  if (["txt", "md", "log", "csv"].includes(ext)) return FileText;
  return File;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// ---------------------------------------------------------------------------

function Breadcrumbs({
  rootLabel,
  path,
  onNavigate,
}: {
  rootLabel: string;
  path: string;
  onNavigate: (next: string) => void;
}) {
  const { t } = useI18n();
  const segments = api.pathSegments(path);
  return (
    <nav
      aria-label={t("files.breadcrumb")}
      className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs"
    >
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="rounded px-1.5 py-1 font-medium text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {rootLabel}
      </button>
      {segments.map((seg, i) => {
        const target = segments.slice(0, i + 1).join("/");
        const last = i === segments.length - 1;
        return (
          <span key={target} className="flex items-center gap-0.5">
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground rtl-flip"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => onNavigate(target)}
              aria-current={last ? "page" : undefined}
              className={cn(
                "rounded px-1.5 py-1 font-mono hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                last ? "text-foreground" : "text-muted-foreground"
              )}
              dir="ltr"
            >
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------

function FileDetailPane({
  port,
  folderId,
  dirPath,
  name,
}: {
  port: number;
  folderId: number;
  dirPath: string;
  name: string | null;
}) {
  const { t, fmt } = useI18n();
  const queryClient = useQueryClient();
  const peers = usePeers(port);
  const filePath = name ? api.joinPath(dirPath, name) : null;
  const detail = useFileDetail(port, folderId, filePath);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const del = useMutation({
    mutationFn: () => api.deleteFile(port, folderId, filePath as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === "agent" && key[1] === port;
        },
      });
      toast.success(t("toast.fileDeleted", { name: name ?? "" }));
      setConfirmDelete(false);
      useConsoleStore.getState().setFilesSelected(port, null);
    },
    onError: (err) => toastAgentError(err, t),
  });

  const peerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of peers.data?.peers ?? []) map.set(p.peerId, p.name);
    return map;
  }, [peers.data]);

  if (!name) {
    return (
      <SectionCard title={t("files.fileDetail")} className="h-full overflow-y-auto">
        <EmptyState
          kind="files"
          title={t("files.selectHint")}
          hint={t("files.selectHintHint")}
        />
      </SectionCard>
    );
  }

  if (detail.isLoading) {
    return (
      <SectionCard title={t("files.fileDetail")} className="h-full overflow-y-auto">
        <LoadingRows rows={4} />
      </SectionCard>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <SectionCard title={t("files.fileDetail")} className="h-full overflow-y-auto">
        <InlineError error={detail.error} />
      </SectionCard>
    );
  }

  const d = detail.data;
  const chunksDone = d.chunks.filter((c) => c.state === "DONE").length;
  const downloadUrl = api.fileContentUrl(port, folderId, filePath as string);
  const peerRows = Object.entries(d.peers);

  return (
    <SectionCard
      title={t("files.fileDetail")}
      className="h-full overflow-y-auto"
      actions={
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={downloadUrl} download={d.name}>
              <Download className="size-3.5" aria-hidden="true" />
              {t("files.download")}
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-red-600 hover:text-red-700 dark:text-red-400"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("common.delete")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {fileGlyph(d.name, "size-4 shrink-0 text-muted-foreground")}
          <span className="truncate font-mono text-sm font-semibold" dir="ltr">
            {d.name}
          </span>
          <SyncStateBadge state={d.syncState as FileSyncState | null} />
        </div>

        <div className="divide-y">
          <DetailRow label={t("common.path")} mono>
            <span title={d.path}>{d.path}</span>
          </DetailRow>
          <DetailRow label={t("common.size")} mono>
            {fmt.bytes(d.size)}
          </DetailRow>
          <DetailRow label={t("files.mtime")}>
            {fmt.dateTime(d.mtime)}
            <span className="ms-1 text-muted-foreground">
              ({fmt.relative(d.mtime)})
            </span>
          </DetailRow>
          <DetailRow label={t("files.hash")}>
            <HashChip hash={d.hash} copyLabel={t("common.copy")} />
          </DetailRow>
          <DetailRow label={t("files.lastSyncedHash")}>
            <HashChip hash={d.lastSyncedHash} copyLabel={t("common.copy")} />
          </DetailRow>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("files.chunkMap")}
            <span className="ms-2 font-mono normal-case" dir="ltr">
              {t("files.chunks", { done: chunksDone, total: d.chunks.length })}
            </span>
          </p>
          <ChunkProgress
            chunksTotal={d.chunks.length}
            chunksDone={chunksDone}
            chunks={d.chunks}
            size={d.size}
          />
          <p className="mt-1 font-mono text-[11px] text-muted-foreground" dir="ltr">
            {t("files.chunkSize")}: {fmt.bytes(d.chunkSize)}
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("files.remotePeers")}
          </p>
          {peerRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("common.none")}</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("files.peerName")}</TableHead>
                    <TableHead className="text-start">{t("files.peerHash")}</TableHead>
                    <TableHead className="text-end">{t("files.peerSize")}</TableHead>
                    <TableHead className="text-end">{t("common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peerRows.map(([peerId, state]) => {
                    const matches = state.hash !== null && state.hash === d.hash;
                    return (
                      <TableRow key={peerId}>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {peerNameById.get(peerId) ?? peerId}
                        </TableCell>
                        <TableCell>
                          <HashChip hash={state.hash} copyLabel={t("common.copy")} />
                        </TableCell>
                        <TableCell className="text-end font-mono text-xs" dir="ltr">
                          {fmt.bytes(state.size)}
                        </TableCell>
                        <TableCell className="text-end">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs",
                              matches
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-amber-700 dark:text-amber-500"
                            )}
                          >
                            {matches ? (
                              <Check className="size-3.5" aria-hidden="true" />
                            ) : (
                              <span aria-hidden="true">≠</span>
                            )}
                            {matches ? t("files.peerMatch") : t("files.peerDiffers")}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("files.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("files.deleteBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => del.mutate()}
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SectionCard>
  );
}

function DirDetailPane({ entry }: { entry: FileEntry & { type: "dir" } }) {
  const { t, fmt } = useI18n();
  return (
    <SectionCard title={t("files.fileDetail")} className="h-full overflow-y-auto">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-mono text-sm font-semibold" dir="ltr">
            {entry.name}
          </span>
        </div>
        <div className="divide-y">
          <DetailRow label={t("common.type")} mono>
            DIR
          </DetailRow>
          <DetailRow label={t("folders.files")} mono>
            {fmt.num(entry.fileCount)}
          </DetailRow>
          <DetailRow label={t("folders.totalBytes")} mono>
            {fmt.bytes(entry.totalBytes)}
          </DetailRow>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

function NewFileDialog({
  port,
  folderId,
  dirPath,
  open,
  onOpenChange,
}: {
  port: number;
  folderId: number;
  dirPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (vars: { path: string; content: string }) =>
      api.createFile(port, folderId, vars.path, vars.content),
    onSuccess: (resp) => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === "agent" && key[1] === port;
        },
      });
      toast.success(t("toast.fileCreated", { name: resp.name }));
      onOpenChange(false);
      setName("");
      setContent("");
      setError(null);
    },
    onError: (err) => {
      setError(api.isAgentError(err) ? err.message : null);
      if (!api.isAgentError(err)) toastAgentError(err, t);
    },
  });

  const submit = () => {
    const clean = name.trim();
    if (!clean || clean.includes("/")) {
      setError(t("files.invalidName"));
      return;
    }
    setError(null);
    create.mutate({ path: api.joinPath(dirPath, clean), content });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialog.newFileTitle")}</DialogTitle>
          <DialogDescription>
            <span className="font-mono" dir="ltr">
              {api.joinPath(dirPath, "") || "/"}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-file-name">{t("files.fileName")}</Label>
            <Input
              id="new-file-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) submit();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-file-content">{t("files.content")}</Label>
            <Textarea
              id="new-file-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("files.contentPlaceholder")}
              className="min-h-32 font-mono text-xs"
              dir="ltr"
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={create.isPending || name.trim().length === 0}
          >
            {create.isPending ? t("common.loading") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function FilesWorkspace({ port }: { port: number }) {
  const { t, fmt } = useI18n();
  const folders = useFolders(port);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const selectedFolderId = useConsoleStore((s) => s.selectedFolderId[port]) ?? null;
  const setSelectedFolderId = useConsoleStore((s) => s.setSelectedFolderId);
  const path = useConsoleStore((s) => s.filesPath[port]) ?? "";
  const setFilesPath = useConsoleStore((s) => s.setFilesPath);
  const selectedName = useConsoleStore((s) => s.filesSelected[port]) ?? null;
  const setFilesSelected = useConsoleStore((s) => s.setFilesSelected);
  const setActiveWorkspace = useConsoleStore((s) => s.setActiveWorkspace);

  const folderList = folders.data?.folders ?? [];

  // Default to the first folder once the list loads.
  useEffect(() => {
    if (selectedFolderId === null && folderList.length > 0) {
      setSelectedFolderId(port, folderList[0].id);
    }
  }, [selectedFolderId, folderList, port, setSelectedFolderId]);

  // Drop the selection whenever the folder or directory changes.
  useEffect(() => {
    setFilesSelected(port, null);
  }, [port, selectedFolderId, path, setFilesSelected]);

  const files = useFiles(port, selectedFolderId, path);

  const entries = useMemo(
    () => sortEntries(files.data?.entries ?? []),
    [files.data]
  );
  const selectedEntry = entries.find((e) => e.name === selectedName) ?? null;
  const activeFolder = folderList.find((f) => f.id === selectedFolderId) ?? null;

  const [newFileOpen, setNewFileOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.uploadFile(port, selectedFolderId as number, api.joinPath(path, file.name), file),
    onSuccess: (resp) => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === "agent" && key[1] === port;
        },
      });
      toast.success(
        t("toast.fileUploaded", { name: resp.name, size: fmt.bytes(resp.size) })
      );
    },
    onError: (err) => toastAgentError(err, t),
  });

  const onUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = "";
  };

  const navigate = (next: string) => {
    setFilesPath(port, next);
  };

  if (folderList.length === 0 && !folders.isLoading && !folders.isError) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
          <WorkspaceHeader title={t("files.title")} />
          <EmptyState
            kind="files"
            title={t("files.noFolder")}
            hint={t("files.noFolderHint")}
            action={
              <Button
                type="button"
                size="sm"
                onClick={() => setActiveWorkspace("folders")}
              >
                <FolderPlus className="size-3.5" aria-hidden="true" />
                {t("folders.add")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const listPane = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {files.isLoading ? <LoadingRows rows={5} /> : null}
      {files.isError ? <InlineError error={files.error} /> : null}
      {files.data && entries.length === 0 ? (
        <EmptyState
          kind="files"
          title={path ? t("files.emptyDir") : t("files.emptyRoot")}
          hint={path ? t("files.emptyDirHint") : t("files.emptyRootHint")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setNewFileOpen(true)}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t("files.newFile")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => uploadInputRef.current?.click()}
                disabled={upload.isPending}
              >
                <Upload className="size-3.5" aria-hidden="true" />
                {t("files.upload")}
              </Button>
            </div>
          }
        />
      ) : null}
      {entries.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="text-start">{t("common.name")}</TableHead>
                <TableHead className="text-end">{t("common.size")}</TableHead>
                <TableHead className="text-end">{t("files.mtime")}</TableHead>
                <TableHead className="text-end">{t("files.syncState")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const selected = entry.name === selectedName;
                const Icon = iconForEntry(entry);
                return (
                  <TableRow
                    key={entry.name}
                    onClick={() => {
                      if (entry.type === "dir") {
                        navigate(api.joinPath(path, entry.name));
                      } else {
                        setFilesSelected(port, entry.name);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                    tabIndex={0}
                    className={cn(
                      "group cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      selected && "bg-primary/5"
                    )}
                    aria-selected={selected}
                  >
                    <TableCell className="max-w-0">
                      <span className="flex items-center gap-2">
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            entry.type === "dir"
                              ? "text-primary"
                              : "text-muted-foreground"
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-xs" dir="ltr">
                          {entry.name}
                        </span>
                        {entry.type === "file" && entry.remotePeers.length > 0 ? (
                          <span
                            className="hidden shrink-0 text-[10px] text-muted-foreground md:inline"
                            dir="auto"
                            title={t("files.remotePeersHint")}
                          >
                            ⇄ {entry.remotePeers.length}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-end font-mono text-xs" dir="ltr">
                      {entry.type === "dir"
                        ? fmt.num(entry.fileCount)
                        : fmt.bytes(entry.size)}
                    </TableCell>
                    <TableCell className="text-end text-xs">
                      {entry.type === "file" && entry.mtime ? (
                        <span title={fmt.dateTime(entry.mtime)}>
                          {fmt.relative(entry.mtime)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {entry.type === "file" ? (
                        <span className="flex items-center justify-end gap-1.5">
                          {selected ? (
                            <HashChip
                              hash={entry.hash}
                              copyLabel={t("common.copy")}
                            />
                          ) : (
                            <HashChip
                              hash={entry.hash}
                              className="hidden opacity-0 transition-opacity group-hover:flex group-hover:opacity-100 md:inline-flex"
                              copyLabel={t("common.copy")}
                            />
                          )}
                          <SyncStateBadge state={entry.syncState as FileSyncState | null} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );

  const detailPane = selectedEntry
    ? selectedEntry.type === "dir"
      ? <DirDetailPane entry={selectedEntry} />
      : (
        <FileDetailPane
          port={port}
          folderId={selectedFolderId as number}
          dirPath={path}
          name={selectedEntry.name}
        />
      )
    : (
      <SectionCard title={t("files.fileDetail")} className="hidden md:block">
        <EmptyState
          kind="files"
          title={t("files.selectHint")}
          hint={t("files.selectHintHint")}
        />
      </SectionCard>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-background/60 px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2">
          <Select
            value={selectedFolderId !== null ? String(selectedFolderId) : undefined}
            onValueChange={(value) => {
              setSelectedFolderId(port, Number(value));
              setFilesPath(port, "");
              setFilesSelected(port, null);
            }}
          >
            <SelectTrigger
              id="files-folder"
              className="w-36 sm:w-44"
              aria-label={t("files.selectFolder")}
            >
              <SelectValue placeholder={t("files.selectFolder")} />
            </SelectTrigger>
            <SelectContent>
              {folderList.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-0 flex-1">
            <Breadcrumbs
              rootLabel={activeFolder?.name ?? "…"}
              path={path}
              onNavigate={navigate}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setNewFileOpen(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("files.newFile")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => uploadInputRef.current?.click()}
              disabled={upload.isPending || selectedFolderId === null}
            >
              <Upload
                className={cn("size-3.5", upload.isPending && "animate-pulse")}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">{t("files.upload")}</span>
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={t("files.refresh")}
              onClick={() => void files.refetch()}
            >
              <RefreshCw
                className={cn("size-3.5", files.isFetching && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={onUploadChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-3 sm:px-6">
        <div className="mx-auto h-full w-full max-w-6xl">
          {isMobile ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="min-h-0 flex-1">{listPane}</div>
              {selectedEntry ? detailPane : null}
            </div>
          ) : (
            <ResizablePanelGroup direction="horizontal" className="min-h-0">
              <ResizablePanel defaultSize={58} minSize={35} className="min-w-0">
                <div className="h-full pe-1">{listPane}</div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={42} minSize={28} className="min-w-0">
                <div className="h-full ps-1">{detailPane}</div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </div>

      <NewFileDialog
        port={port}
        folderId={selectedFolderId as number}
        dirPath={path}
        open={newFileOpen}
        onOpenChange={setNewFileOpen}
      />
    </div>
  );
}
