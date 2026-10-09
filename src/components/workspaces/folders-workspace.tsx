"use client";

import { useState } from "react";
import { FolderPlus, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/meshsync/empty-state";
import {
  InlineError,
  LoadingRows,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import { useFolders } from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query-keys";
import type { Folder } from "@/lib/types";
import { cn } from "@/lib/utils";

function AddFolderDialog({
  port,
  open,
  onOpenChange,
}: {
  port: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [errors, setErrors] = useState<{ name?: string; path?: string; general?: string }>({});

  const add = useMutation({
    mutationFn: (vars: { name: string; path: string }) =>
      api.addFolder(port, vars.name, vars.path),
    onSuccess: (resp) => {
      void queryClient.invalidateQueries({ queryKey: qk.folders(port) });
      toast.success(t("toast.folderAdded", { name: resp.folder.name }));
      onOpenChange(false);
      setName("");
      setPath("");
      setErrors({});
    },
    onError: (err) => {
      if (api.isAgentError(err)) {
        // Surface server-side validation inline.
        setErrors({ general: err.message });
      } else {
        toastAgentError(err, t);
      }
    },
  });

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    const nextErrors: typeof errors = {};
    if (!trimmedName || trimmedName.length > 64) {
      nextErrors.name = t("folders.invalidName");
    }
    if (!trimmedPath.startsWith("/") || trimmedPath.length < 2) {
      nextErrors.path = t("folders.invalidPath");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      add.mutate({ name: trimmedName, path: trimmedPath });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialog.addFolderTitle")}</DialogTitle>
          <DialogDescription>{t("folders.nameHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-name">{t("folders.folderName")}</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              autoFocus
            />
            {errors.name ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {errors.name}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-path">{t("folders.folderPath")}</Label>
            <Input
              id="folder-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t("folders.folderPathPlaceholder")}
              className="font-mono"
              dir="ltr"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            {errors.path ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {errors.path}
              </p>
            ) : null}
          </div>
          {errors.general ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {errors.general}
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
            disabled={add.isPending || name.trim().length === 0 || path.trim().length === 0}
          >
            {add.isPending ? t("common.loading") : t("common.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FoldersWorkspace({ port }: { port: number }) {
  const { t, fmt } = useI18n();
  const folders = useFolders(port);
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [rescanningId, setRescanningId] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Folder | null>(null);

  const invalidateFolders = () =>
    void queryClient.invalidateQueries({ queryKey: qk.folders(port) });

  const rescan = useMutation({
    mutationFn: (folderId: number) => api.rescanFolder(port, folderId),
    onMutate: (folderId) => setRescanningId(folderId),
    onSuccess: (resp) => {
      invalidateFolders();
      toast.success(
        t("toast.rescanDone", {
          scanned: resp.scanned,
          changed: resp.changed,
          removed: resp.removed,
        })
      );
    },
    onError: (err) => toastAgentError(err, t),
    onSettled: () => setRescanningId(null),
  });

  const remove = useMutation({
    mutationFn: (folderId: number) => api.removeFolder(port, folderId, false),
    onSuccess: () => {
      invalidateFolders();
      const name = confirmRemove?.name ?? "";
      toast.success(t("toast.folderRemoved", { name }));
      setConfirmRemove(null);
    },
    onError: (err) => toastAgentError(err, t),
  });

  const list = folders.data?.folders ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        <WorkspaceHeader
          title={t("folders.title")}
          actions={
            <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
              <FolderPlus className="size-3.5" aria-hidden="true" />
              {t("folders.add")}
            </Button>
          }
        />

        {folders.isLoading ? <LoadingRows rows={4} /> : null}
        {folders.isError ? <InlineError error={folders.error} /> : null}

        {folders.data && list.length === 0 ? (
          <EmptyState
            kind="folders"
            title={t("folders.noFolders")}
            hint={t("folders.noFoldersHint")}
            action={
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <FolderPlus className="size-3.5" aria-hidden="true" />
                {t("folders.add")}
              </Button>
            }
          />
        ) : null}

        {list.length > 0 ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t("folders.name")}</TableHead>
                  <TableHead className="text-start">{t("folders.path")}</TableHead>
                  <TableHead className="text-end">{t("folders.files")}</TableHead>
                  <TableHead className="text-end">{t("folders.totalBytes")}</TableHead>
                  <TableHead className="text-end">{t("folders.lastScan")}</TableHead>
                  <TableHead className="w-24 text-end">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((folder) => (
                  <TableRow key={folder.id}>
                    <TableCell className="font-medium">{folder.name}</TableCell>
                    <TableCell className="max-w-[16rem]">
                      <span
                        className="block truncate font-mono text-xs text-muted-foreground"
                        dir="ltr"
                        title={folder.path}
                      >
                        {folder.path}
                      </span>
                    </TableCell>
                    <TableCell className="text-end font-mono text-xs" dir="ltr">
                      {fmt.num(folder.fileCount)}
                    </TableCell>
                    <TableCell className="text-end font-mono text-xs" dir="ltr">
                      {fmt.bytes(folder.totalBytes)}
                    </TableCell>
                    <TableCell className="text-end text-xs">
                      {folder.lastScanAt ? (
                        <span title={fmt.dateTime(folder.lastScanAt)}>
                          {fmt.relative(folder.lastScanAt)}
                        </span>
                      ) : (
                        t("common.never")
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={t("folders.rescan")}
                          title={t("folders.rescan")}
                          disabled={rescan.isPending}
                          onClick={() => rescan.mutate(folder.id)}
                        >
                          {rescanningId === folder.id ? (
                            <RefreshCw
                              className="size-3.5 animate-spin text-primary"
                              aria-hidden="true"
                            />
                          ) : (
                            <ScanSearch className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className={cn(
                            "size-7 text-red-600 hover:text-red-700 dark:text-red-400"
                          )}
                          aria-label={t("folders.remove")}
                          title={t("folders.remove")}
                          onClick={() => setConfirmRemove(folder)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <AddFolderDialog port={port} open={addOpen} onOpenChange={setAddOpen} />

        <AlertDialog
          open={confirmRemove !== null}
          onOpenChange={(open) => !open && setConfirmRemove(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("folders.removeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("folders.removeBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => confirmRemove && remove.mutate(confirmRemove.id)}
              >
                {t("folders.remove")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
