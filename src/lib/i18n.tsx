"use client";

/**
 * MeshSync Console i18n — full English + Persian (فارسی) dictionaries.
 * Persian is natural technical Persian, not mechanical word-by-word.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  formatBytes,
  formatCompactNum,
  formatDateIso,
  formatDateTime,
  formatDuration,
  formatNum,
  formatRelative,
  formatSpeed,
  formatUptime,
  type Lang,
} from "./format";

export type { Lang };

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------

const en = {
  // -- common ---------------------------------------------------------------
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.remove": "Remove",
  "common.confirm": "Confirm",
  "common.refresh": "Refresh",
  "common.copy": "Copy",
  "common.copied": "Copied to clipboard",
  "common.create": "Create",
  "common.add": "Add",
  "common.upload": "Upload",
  "common.download": "Download",
  "common.search": "Search",
  "common.all": "All",
  "common.loading": "Loading…",
  "common.never": "never",
  "common.unknown": "unknown",
  "common.none": "None",
  "common.details": "Details",
  "common.actions": "Actions",
  "common.status": "Status",
  "common.name": "Name",
  "common.path": "Path",
  "common.size": "Size",
  "common.type": "Type",
  "common.time": "Time",
  "common.error": "Error",
  "common.back": "Back",
  "common.loadMore": "Load more",
  "common.execute": "Execute",
  "common.pause": "Pause",
  "common.resume": "Resume",
  "common.retryAction": "Retry",
  "common.version": "Version",
  "common.unsaved": "Unsaved changes",
  "common.notAvailable": "—",
  "common.noResults": "No matching results",
  "common.copiedHash": "Hash copied",
  "common.copiedAddress": "Address copied",
  "common.bytes": "bytes",
  "common.online": "online",
  "common.offline": "offline",

  // -- app / navigation -----------------------------------------------------
  "nav.workspaces": "Workspaces",
  "nav.device": "Device",
  "nav.peers": "Peers",
  "nav.folders": "Folders",
  "nav.files": "Files",
  "nav.sync": "Sync",
  "nav.transfers": "Transfers",
  "nav.conflicts": "Conflicts",
  "nav.activity": "Activity",
  "nav.settings": "Settings",

  // -- top bar --------------------------------------------------------------
  "topbar.deviceContext": "Active device",
  "topbar.live": "LIVE",
  "topbar.connecting": "CONNECTING",
  "topbar.reconnecting": "RECONNECTING",
  "topbar.language": "Language",
  "topbar.switchLang": "Switch language",
  "topbar.theme": "Theme",
  "topbar.toggleTheme": "Toggle theme",
  "topbar.wsLive": "Live event stream connected",
  "topbar.wsReconnecting": "Reconnecting to live event stream",

  // -- status bar -----------------------------------------------------------
  "statusbar.engineOk": "Engine online",
  "statusbar.engineDown": "Engine offline",
  "statusbar.activeTransfers": "{count} active",
  "statusbar.noTransfers": "No active transfers",
  "statusbar.lastEvent": "Last event",
  "statusbar.copyright": "© 2026 Parsa Fathi",

  // -- connection banner ----------------------------------------------------
  "conn.unreachable": "Agent unreachable at port {port} — reconnecting…",
  "conn.unreachableHint":
    "The MeshSync agent is not responding. Data below may be stale; a retry runs automatically.",
  "conn.retryNow": "Retry now",
  "conn.retrying": "Retrying…",

  // -- device workspace -----------------------------------------------------
  "device.title": "Device",
  "device.identity": "Identity",
  "device.deviceName": "Device name",
  "device.peerId": "Peer ID",
  "device.keyFingerprint": "Key fingerprint",
  "device.version": "Version",
  "device.platform": "Platform",
  "device.startedAt": "Started at",
  "device.ports": "Ports",
  "device.apiPort": "API port",
  "device.peerPort": "Peer port",
  "device.nativeEngine": "Native engine",
  "device.nativeEngineHint": "C++ hashing worker",
  "device.rename": "Rename",
  "device.renameHint": "Shown to peers when pairing and syncing",
  "device.saving": "Saving…",
  "device.stats": "Live statistics",
  "device.folders": "Shared folders",
  "device.filesIndexed": "Files indexed",
  "device.bytesIndexed": "Bytes indexed",
  "device.peersTrusted": "Trusted peers",
  "device.peersOnline": "Peers online",
  "device.transfersActive": "Active transfers",
  "device.transfersCompleted": "Completed transfers",
  "device.conflictsOpen": "Open conflicts",
  "device.lastSync": "Last sync",
  "device.uptime": "Uptime",

  // -- peers workspace ------------------------------------------------------
  "peers.title": "Peers",
  "peers.meshDiagram": "Mesh",
  "peers.thisDevice": "This device",
  "peers.legend": "Legend",
  "peers.legend.trusted": "trusted link",
  "peers.legend.pairing": "pairing",
  "peers.legend.discovered": "discovered",
  "peers.legend.revoked": "revoked",
  "peers.list": "Peer list",
  "peers.address": "Address",
  "peers.lastSeen": "Last seen",
  "peers.sharedFolders": "Shared folders",
  "peers.pair": "Pair new peer",
  "peers.pairAddress": "Peer address (host:port)",
  "peers.pairAddressPlaceholder": "127.0.0.1:4041",
  "peers.pairSubmit": "Send pairing request",
  "peers.pairExplain":
    "A pairing request is sent to that address. The remote device must approve it explicitly before any data is exchanged.",
  "peers.approve": "Approve",
  "peers.revoke": "Revoke trust",
  "peers.remove": "Remove",
  "peers.copyAddress": "Copy address",
  "peers.removeTitle": "Remove peer?",
  "peers.removeBody":
    "The peer record is deleted entirely. To sync again you must pair from scratch.",
  "peers.revokeTitle": "Revoke trust?",
  "peers.revokeBody":
    "Connections are closed and future pairing attempts from this peer are refused until it is removed and re-paired.",
  "peers.scan": "Discovery scan",
  "peers.scanning": "Scanning…",
  "peers.selectedPeer": "Peer details",
  "peers.noPeers": "No peers yet",
  "peers.noPeersHint":
    "Nothing is discovered or paired yet. Run a discovery scan or send a pairing request to a known address.",
  "peers.noPeerSelected": "No peer selected",
  "peers.noPeerSelectedHint": "Select a peer from the list to inspect its details.",
  "peers.discoveredNote": "Discovered peers are never trusted automatically.",

  // -- folders workspace ----------------------------------------------------
  "folders.title": "Shared folders",
  "folders.name": "Name",
  "folders.path": "Path",
  "folders.files": "Files",
  "folders.totalBytes": "Size",
  "folders.lastScan": "Last scan",
  "folders.add": "Add shared folder",
  "folders.folderName": "Folder name",
  "folders.folderPath": "Absolute path",
  "folders.folderPathPlaceholder": "/home/z/meshsync/shared-a",
  "folders.nameHint":
    "Folders sync between trusted peers when both sides define a shared folder with the same name.",
  "folders.rescan": "Rescan",
  "folders.rescanning": "Scanning…",
  "folders.remove": "Remove",
  "folders.removeTitle": "Remove shared folder?",
  "folders.removeBody":
    "Tracking stops for this folder. Files on disk are kept — nothing is deleted.",
  "folders.noFolders": "No shared folders",
  "folders.noFoldersHint":
    "Add an existing directory as a shared folder to index it and sync it with trusted peers.",
  "folders.invalidName": "Name is required (1–64 characters)",
  "folders.invalidPath": "Path must be an absolute path of an existing directory",

  // -- files workspace ------------------------------------------------------
  "files.title": "File browser",
  "files.breadcrumb": "Path",
  "files.folder": "Folder",
  "files.selectFolder": "Select folder",
  "files.newFile": "New file",
  "files.fileName": "File name",
  "files.content": "Content",
  "files.contentPlaceholder": "File text content…",
  "files.upload": "Upload",
  "files.refresh": "Refresh",
  "files.delete": "Delete file",
  "files.deleteTitle": "Delete file?",
  "files.deleteBody":
    "The file is moved into the agent trash (.meshsync/trash) and tombstoned in the index.",
  "files.emptyDir": "This directory is empty",
  "files.emptyDirHint":
    "Create a file here or drop content in with the upload button.",
  "files.emptyRoot": "Nothing here yet",
  "files.emptyRootHint":
    "The shared folder is empty. Create a new file or upload one to start syncing.",
  "files.noFolder": "No shared folder",
  "files.noFolderHint": "Add a shared folder first, then browse its files here.",
  "files.selectHint": "Select a file to inspect its details",
  "files.selectHintHint": "Hashes, chunk map and per-peer state appear here.",
  "files.hash": "SHA-256 hash",
  "files.lastSyncedHash": "Last synced hash",
  "files.mtime": "Modified",
  "files.syncState": "Sync state",
  "files.remotePeers": "Up-to-date at peers",
  "files.remotePeersHint": "Trusted peers whose latest manifest matches this hash",
  "files.chunkMap": "Chunk map",
  "files.chunkSize": "Chunk size",
  "files.chunks": "{done}/{total} chunks",
  "files.peerStates": "Per-peer state",
  "files.peerName": "Peer",
  "files.peerHash": "Hash",
  "files.peerMatch": "match",
  "files.peerDiffers": "differs",
  "files.peerSize": "Size",
  "files.peerSeen": "Seen",
  "files.download": "Download",
  "files.dirStats": "{count} files · {bytes}",
  "files.invalidName": "File name must not contain / or be empty",
  "files.dirEntries": "Entries",
  "files.fileDetail": "File detail",

  // -- sync workspace -------------------------------------------------------
  "sync.title": "Synchronization",
  "sync.peer": "Peer",
  "sync.folder": "Folder",
  "sync.selectPeer": "Select peer",
  "sync.selectFolder": "Select folder",
  "sync.trustedOnly": "Only trusted peers can sync",
  "sync.computePlan": "Compute plan",
  "sync.computing": "Computing plan…",
  "sync.planSummary": "Plan summary",
  "sync.planActions": "Plan actions",
  "sync.generatedAt": "Generated",
  "sync.total": "Total",
  "sync.pull": "Pull",
  "sync.push": "Push",
  "sync.deleteLocal": "Delete local",
  "sync.deleteRemote": "Delete remote",
  "sync.conflicts": "Conflicts",
  "sync.unchanged": "Unchanged",
  "sync.execute": "Execute plan",
  "sync.executing": "Running…",
  "sync.executeTitle": "Execute sync plan?",
  "sync.executeIntro":
    "This will transfer, delete and overwrite files exactly as listed in the plan.",
  "sync.executeDeletes":
    "It includes {deletes} deletion(s) — affected files go to the trash on the losing side.",
  "sync.executeConflicts":
    "{conflicts} file(s) are in conflict and will be SKIPPED until you resolve them in the Conflicts workspace.",
  "sync.executePlain": "No deletions and no conflicts — the plan only transfers files.",
  "sync.liveProgress": "Live progress",
  "sync.liveProgressHint": "Active transfers for this session",
  "sync.sessionStarted": "Session {id} started",
  "sync.noActive": "No active transfers right now",
  "sync.sessionsHistory": "Session history",
  "sync.peerCol": "Peer",
  "sync.folderCol": "Folder",
  "sync.started": "Started",
  "sync.duration": "Duration",
  "sync.filesCol": "Files",
  "sync.bytesCol": "Bytes",
  "sync.errorCol": "Error",
  "sync.noSessions": "No sync sessions yet",
  "sync.noSessionsHint":
    "Run a sync to create the first session. History appears here.",
  "sync.noPlan": "No plan computed",
  "sync.noPlanHint":
    "Pick a trusted peer and a shared folder, then compute the plan to see what would happen — nothing is touched until you execute it.",
  "sync.lastSynced": "Last synced",
  "sync.localHash": "Local",
  "sync.remoteHash": "Remote",

  // -- transfers workspace --------------------------------------------------
  "transfers.title": "Transfers",
  "transfers.filter.all": "All",
  "transfers.filter.active": "Active",
  "transfers.filter.queued": "Queued",
  "transfers.filter.completed": "Completed",
  "transfers.filter.failed": "Failed",
  "transfers.filter.cancelled": "Cancelled",
  "transfers.speed": "Speed",
  "transfers.eta": "ETA",
  "transfers.started": "Started",
  "transfers.completed": "Completed",
  "transfers.chunks": "Chunks",
  "transfers.direction": "Direction",
  "transfers.errorDetails": "Error details",
  "transfers.noTransfers": "No transfers",
  "transfers.noTransfersHint":
    "Nothing has been transferred yet. Start a sync or resolve a conflict to generate transfers.",
  "transfers.noMatchFilter": "No transfers in this state",
  "transfers.sparkline": "Recent speed (live samples)",
  "transfers.aggregate": "Aggregate",
  "transfers.pushHint": "Push to {peer}",
  "transfers.pullHint": "Pull from {peer}",

  // -- conflicts workspace --------------------------------------------------
  "conflicts.title": "Conflicts",
  "conflicts.open": "Open conflicts",
  "conflicts.resolvedHistory": "Resolved history",
  "conflicts.selected": "Resolution",
  "conflicts.relPath": "File",
  "conflicts.folder": "Folder",
  "conflicts.peer": "Peer",
  "conflicts.created": "Detected",
  "conflicts.localVersion": "Local — this device",
  "conflicts.remoteVersion": "Remote — {peer}",
  "conflicts.sizeDiff": "Sizes differ by {delta}",
  "conflicts.sameSize": "Same size, different content",
  "conflicts.keepLocal": "Keep local",
  "conflicts.keepLocalHint":
    "This device's version is pushed to the peer; the peer's current copy goes to its trash.",
  "conflicts.keepRemote": "Keep remote",
  "conflicts.keepRemoteHint":
    "The remote version overwrites the local copy; the local copy goes to the local trash.",
  "conflicts.keepBoth": "Keep both",
  "conflicts.keepBothHint":
    "The remote version is saved next to the local file as {filename}, then the local version wins for the original path.",
  "conflicts.later": "Resolve later",
  "conflicts.laterHint": "The conflict stays open and no data is touched.",
  "conflicts.resolve": "Resolve",
  "conflicts.resolving": "Resolving…",
  "conflicts.noConflicts": "No open conflicts",
  "conflicts.noConflictsHint":
    "Nothing needs your decision. Conflicts appear here when both sides changed the same file.",
  "conflicts.noResolved": "No resolved conflicts yet",
  "conflicts.noSelection": "No conflict selected",
  "conflicts.noSelectionHint":
    "Pick a conflict from the list to compare versions and resolve it.",
  "conflicts.resolution": "Resolution",
  "conflicts.resolvedAt": "Resolved",
  "conflicts.size": "Size",
  "conflicts.mtime": "Modified",

  // -- activity workspace ---------------------------------------------------
  "activity.title": "Activity",
  "activity.severity": "Severity",
  "activity.type": "Type",
  "activity.message": "Message",
  "activity.searchPlaceholder": "Search messages…",
  "activity.allTypes": "All types",
  "activity.severity.all": "All",
  "activity.severity.info": "Info",
  "activity.severity.warn": "Warnings",
  "activity.severity.error": "Errors",
  "activity.eventData": "Event data (JSON)",
  "activity.noEvents": "No events yet",
  "activity.noEventsHint":
    "The agent has not emitted any events. Actions and state changes will appear here live.",
  "activity.noMatch": "No events match the filters",
  "activity.live": "Live — newest first",
  "activity.count": "{count} events",

  // -- settings workspace ---------------------------------------------------
  "settings.title": "Settings",
  "settings.identity": "Identity",
  "settings.transfer": "Transfer",
  "settings.behavior": "Behavior",
  "settings.interface": "Interface",
  "settings.about": "About",
  "settings.deviceName": "Device name",
  "settings.deviceNameHint": "Shown to peers when pairing and syncing",
  "settings.bandwidthLimit": "Bandwidth limit",
  "settings.unlimited": "Unlimited",
  "settings.bandwidthUnit": "Limit",
  "settings.concurrency": "Concurrent transfers",
  "settings.chunkSize": "Chunk size",
  "settings.discovery": "Peer discovery",
  "settings.discoveryHint": "Announce and listen for discovery beacons on the local network",
  "settings.skipHidden": "Skip hidden files",
  "settings.skipHiddenHint": "Dot-files and hidden entries are not indexed or synced",
  "settings.autoSync": "Auto-sync interval",
  "settings.autoSyncOff": "Manual only",
  "settings.autoSyncHint": "How often shared folders sync with trusted peers",
  "settings.save": "Save settings",
  "settings.saving": "Saving…",
  "settings.saved": "Settings saved",
  "settings.storedResponse": "Stored settings (agent response)",
  "settings.storedHint": "These are the values the agent actually persisted, verbatim.",
  "settings.language": "Language",
  "settings.theme": "Theme",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.aboutText":
    "MeshSync — peer-to-peer local-first file synchronization",
  "settings.license": "Apache-2.0 license",
  "settings.copyright": "© 2026 Parsa Fathi",
  "settings.validation": "Fix the highlighted fields before saving",
  "settings.invalidBandwidth": "Bandwidth limit must be a positive number",
  "settings.invalidConcurrency": "Concurrency must be between 1 and 16",
  "settings.invalidName": "Device name is required",
  "settings.notLoaded": "Settings not loaded yet",
  "settings.notLoadedHint":
    "The settings appear once the agent responds. Reachability is shown in the banner above.",

  // -- empty / loading / errors ---------------------------------------------
  "state.loadingData": "Loading data from the agent…",
  "state.unreachableShort": "Agent unreachable",
  "err.agentError": "{message} ({code})",
  "err.unknown": "Unexpected error: {message}",
  "err.requestFailed": "Request failed",
  "err.offline": "The agent is offline; the action was not performed.",

  // -- toasts ---------------------------------------------------------------
  "toast.savedName": "Device renamed to {name}",
  "toast.pairRequested": "Pairing request sent — waiting for remote approval",
  "toast.peerApproved": "{name} approved and trusted",
  "toast.peerRevoked": "Trust revoked for {name}",
  "toast.peerRemoved": "Peer {name} removed",
  "toast.scanFound": "Discovery scan finished — {count} peer(s) found",
  "toast.folderAdded": "Shared folder {name} added",
  "toast.folderRemoved": "Shared folder {name} removed",
  "toast.rescanDone": "Scan: {scanned} files, {changed} changed, {removed} removed",
  "toast.fileCreated": "File {name} created",
  "toast.fileUploaded": "File {name} uploaded ({size})",
  "toast.fileDeleted": "File {name} moved to trash",
  "toast.planComputed": "Plan computed — {total} paths classified",
  "toast.syncStarted": "Sync session {id} started",
  "toast.transferPaused": "Transfer paused",
  "toast.transferResumed": "Transfer resumed",
  "toast.transferCancelled": "Transfer cancelled",
  "toast.transferRetried": "Transfer requeued",
  "toast.conflictResolved": "Conflict resolved — {resolution}",
  "toast.settingsSaved": "Settings saved",
  "toast.copied": "Copied to clipboard",

  // -- dialogs / misc -------------------------------------------------------
  "dialog.renameDevice": "Rename device",
  "dialog.newFileTitle": "New file",
  "dialog.uploadTitle": "Upload file",
  "dialog.pairTitle": "Pair with a peer",
  "dialog.addFolderTitle": "Add shared folder",
  "validation.address": "Address must look like host:port",
  "validation.port": "Port must be a number between 1 and 65535",
  "validation.required": "This field is required",
  "validation.invalidAddress": "Enter a valid address (host:port)",
  "validation.fileRequired": "Choose a file to upload",
  "misc.yes": "Yes",
  "misc.no": "No",
  "misc.confirmProceed": "Yes, proceed",
  "misc.perSecondSuffix": "/s",
  "misc.pct": "{value}%",
  "misc.dash": "—",
  "misc.agent": "agent",
} as const;

export type DictKey = keyof typeof en;

const fa: Record<DictKey, string> = {
  // -- common ---------------------------------------------------------------
  "common.save": "ذخیره",
  "common.cancel": "انصراف",
  "common.retry": "تلاش دوباره",
  "common.close": "بستن",
  "common.delete": "حذف",
  "common.remove": "حذف",
  "common.confirm": "تأیید",
  "common.refresh": "به‌روزرسانی",
  "common.copy": "کپی",
  "common.copied": "در حافظه کپی شد",
  "common.create": "ایجاد",
  "common.add": "افزودن",
  "common.upload": "بارگذاری",
  "common.download": "دانلود",
  "common.search": "جستجو",
  "common.all": "همه",
  "common.loading": "در حال بارگذاری…",
  "common.never": "هرگز",
  "common.unknown": "نامشخص",
  "common.none": "هیچ",
  "common.details": "جزئیات",
  "common.actions": "عملیات",
  "common.status": "وضعیت",
  "common.name": "نام",
  "common.path": "مسیر",
  "common.size": "حجم",
  "common.type": "نوع",
  "common.time": "زمان",
  "common.error": "خطا",
  "common.back": "بازگشت",
  "common.loadMore": "موارد بیشتر",
  "common.execute": "اجرا",
  "common.pause": "توقف",
  "common.resume": "ادامه",
  "common.retryAction": "تلاش مجدد",
  "common.version": "نسخه",
  "common.unsaved": "تغییرات ذخیره نشده",
  "common.notAvailable": "—",
  "common.noResults": "نتیجه‌ای مطابق نیست",
  "common.copiedHash": "هش کپی شد",
  "common.copiedAddress": "نشانی کپی شد",
  "common.bytes": "بایت",
  "common.online": "آنلاین",
  "common.offline": "آفلاین",

  // -- app / navigation -----------------------------------------------------
  "nav.workspaces": "فضاهای کاری",
  "nav.device": "دستگاه",
  "nav.peers": "همتاها",
  "nav.folders": "پوشه‌ها",
  "nav.files": "فایل‌ها",
  "nav.sync": "همگام‌سازی",
  "nav.transfers": "انتقال‌ها",
  "nav.conflicts": "تعارض‌ها",
  "nav.activity": "فعالیت",
  "nav.settings": "تنظیمات",

  // -- top bar --------------------------------------------------------------
  "topbar.deviceContext": "دستگاه فعال",
  "topbar.live": "زنده",
  "topbar.connecting": "در حال اتصال",
  "topbar.reconnecting": "اتصال مجدد",
  "topbar.language": "زبان",
  "topbar.switchLang": "تغییر زبان",
  "topbar.theme": "پوسته",
  "topbar.toggleTheme": "تغییر پوسته",
  "topbar.wsLive": "جریان رخدادهای زنده متصل است",
  "topbar.wsReconnecting": "اتصال مجدد به جریان رخدادهای زنده",

  // -- status bar -----------------------------------------------------------
  "statusbar.engineOk": "موتور روشن است",
  "statusbar.engineDown": "موتور خاموش است",
  "statusbar.activeTransfers": "{count} فعال",
  "statusbar.noTransfers": "انتقال فعالی در جریان نیست",
  "statusbar.lastEvent": "آخرین رخداد",
  "statusbar.copyright": "© 2026 Parsa Fathi",

  // -- connection banner ----------------------------------------------------
  "conn.unreachable": "ایجنت روی پورت {port} در دسترس نیست — در حال اتصال مجدد…",
  "conn.unreachableHint":
    "ایجنت MeshSync پاسخ نمی‌دهد. داده‌های زیر ممکن است قدیمی باشند؛ تلاش مجدد به‌طور خودکار انجام می‌شود.",
  "conn.retryNow": "همین حالا تلاش کن",
  "conn.retrying": "در حال تلاش…",

  // -- device workspace -----------------------------------------------------
  "device.title": "دستگاه",
  "device.identity": "هویت",
  "device.deviceName": "نام دستگاه",
  "device.peerId": "شناسهٔ همتا",
  "device.keyFingerprint": "اثر انگشت کلید",
  "device.version": "نسخه",
  "device.platform": "پلتفرم",
  "device.startedAt": "زمان اجرا",
  "device.ports": "پورت‌ها",
  "device.apiPort": "پورت API",
  "device.peerPort": "پورت همتا",
  "device.nativeEngine": "موتور بومی",
  "device.nativeEngineHint": "کارگر هش C++",
  "device.rename": "تغییر نام",
  "device.renameHint": "این نام هنگام جفت‌سازی و همگام‌سازی به همتاها نمایش داده می‌شود",
  "device.saving": "در حال ذخیره…",
  "device.stats": "آمار زنده",
  "device.folders": "پوشه‌های اشتراکی",
  "device.filesIndexed": "فایل‌های نمایه‌شده",
  "device.bytesIndexed": "حجم نمایه‌شده",
  "device.peersTrusted": "همتاهای مورد اعتماد",
  "device.peersOnline": "همتاهای آنلاین",
  "device.transfersActive": "انتقال‌های فعال",
  "device.transfersCompleted": "انتقال‌های کامل‌شده",
  "device.conflictsOpen": "تعارض‌های باز",
  "device.lastSync": "آخرین همگام‌سازی",
  "device.uptime": "مدت کارکرد",

  // -- peers workspace ------------------------------------------------------
  "peers.title": "همتاها",
  "peers.meshDiagram": "نقشهٔ مش",
  "peers.thisDevice": "این دستگاه",
  "peers.legend": "راهنما",
  "peers.legend.trusted": "پیوند مورد اعتماد",
  "peers.legend.pairing": "در حال جفت‌سازی",
  "peers.legend.discovered": "کشف‌شده",
  "peers.legend.revoked": "اعتماد لغو‌شده",
  "peers.list": "فهرست همتاها",
  "peers.address": "نشانی",
  "peers.lastSeen": "آخرین دیدار",
  "peers.sharedFolders": "پوشه‌های اشتراکی",
  "peers.pair": "جفت‌سازی همتای جدید",
  "peers.pairAddress": "نشانی همتا (host:port)",
  "peers.pairAddressPlaceholder": "127.0.0.1:4041",
  "peers.pairSubmit": "ارسال درخواست جفت‌سازی",
  "peers.pairExplain":
    "درخواست جفت‌سازی به آن نشانی ارسال می‌شود. دستگاه مقابل باید آن را صریحاً تأیید کند تا رد و بدل داده آغاز شود.",
  "peers.approve": "تأیید",
  "peers.revoke": "لغو اعتماد",
  "peers.remove": "حذف",
  "peers.copyAddress": "کپی نشانی",
  "peers.removeTitle": "همتا حذف شود؟",
  "peers.removeBody":
    "رکورد این همتا به‌کلی حذف می‌شود. برای همگام‌سازی مجدد باید از نو جفت‌سازی کنید.",
  "peers.revokeTitle": "اعتماد به همتا لغو شود؟",
  "peers.revokeBody":
    "اتصال‌های فعلی بسته می‌شوند و تلاش‌های جفت‌سازی بعدی این همتا رد می‌شود تا زمانی که حذف و مجدداً جفت‌سازی شود.",
  "peers.scan": "اسکن کشف",
  "peers.scanning": "در حال اسکن…",
  "peers.selectedPeer": "جزئیات همتا",
  "peers.noPeers": "هنوز همتایی وجود ندارد",
  "peers.noPeersHint":
    "چیزی کشف یا جفت‌سازی نشده است. یک اسکن کشف اجرا کنید یا به نشانی همتای مشخصی درخواست جفت‌سازی بفرستید.",
  "peers.noPeerSelected": "همتایی انتخاب نشده",
  "peers.noPeerSelectedHint": "برای دیدن جزئیات، یک همتا از فهرست انتخاب کنید.",
  "peers.discoveredNote": "همتاهای کشف‌شده هرگز به‌طور خودکار مورد اعتماد قرار نمی‌گیرند.",

  // -- folders workspace ----------------------------------------------------
  "folders.title": "پوشه‌های اشتراکی",
  "folders.name": "نام",
  "folders.path": "مسیر",
  "folders.files": "فایل‌ها",
  "folders.totalBytes": "حجم",
  "folders.lastScan": "آخرین اسکن",
  "folders.add": "افزودن پوشهٔ اشتراکی",
  "folders.folderName": "نام پوشه",
  "folders.folderPath": "مسیر مطلق",
  "folders.folderPathPlaceholder": "/home/z/meshsync/shared-a",
  "folders.nameHint":
    "پوشه‌ها وقتی همگام می‌شوند که هر دو طرف پوشه‌ای با همین نام تعریف کرده باشند.",
  "folders.rescan": "اسکن مجدد",
  "folders.rescanning": "در حال اسکن…",
  "folders.remove": "حذف",
  "folders.removeTitle": "پوشهٔ اشتراکی حذف شود؟",
  "folders.removeBody":
    "ردیابی این پوشه متوقف می‌شود. فایل‌ها روی دیسک می‌مانند — چیزی حذف نمی‌شود.",
  "folders.noFolders": "پوشهٔ اشتراکی‌ای وجود ندارد",
  "folders.noFoldersHint":
    "یک پوشهٔ موجود را به‌عنوان پوشهٔ اشتراکی اضافه کنید تا نمایه شود و با همتاهای مورد اعتماد همگام شود.",
  "folders.invalidName": "نام لازم است (۱ تا ۶۴ نویسه)",
  "folders.invalidPath": "مسیر باید یک مسیر مطلق به پوشه‌ای موجود باشد",

  // -- files workspace ------------------------------------------------------
  "files.title": "مرورگر فایل",
  "files.breadcrumb": "مسیر",
  "files.folder": "پوشه",
  "files.selectFolder": "انتخاب پوشه",
  "files.newFile": "فایل جدید",
  "files.fileName": "نام فایل",
  "files.content": "محتوا",
  "files.contentPlaceholder": "محتوای متنی فایل…",
  "files.upload": "بارگذاری",
  "files.refresh": "به‌روزرسانی",
  "files.delete": "حذف فایل",
  "files.deleteTitle": "فایل حذف شود؟",
  "files.deleteBody":
    "فایل به بازیافت ایجنت (.meshsync/trash) منتقل و در نمایه ثبت می‌شود.",
  "files.emptyDir": "این پوشه خالی است",
  "files.emptyDirHint":
    "اینجا فایلی ایجاد کنید یا با دکمهٔ بارگذاری فایلی اضافه کنید.",
  "files.emptyRoot": "هنوز چیزی اینجا نیست",
  "files.emptyRootHint":
    "پوشهٔ اشتراکی خالی است. یک فایل جدید بسازید یا فایلی بارگذاری کنید تا همگام‌سازی آغاز شود.",
  "files.noFolder": "پوشهٔ اشتراکی‌ای وجود ندارد",
  "files.noFolderHint": "ابتدا یک پوشهٔ اشتراکی اضافه کنید، بعد فایل‌هایش را اینجا مرور کنید.",
  "files.selectHint": "برای دیدن جزئیات، یک فایل انتخاب کنید",
  "files.selectHintHint": "هش، نقشهٔ قطعه‌ها و وضعیت هر همتا اینجا نمایش داده می‌شود.",
  "files.hash": "هش SHA-256",
  "files.lastSyncedHash": "آخرین هش همگام‌شده",
  "files.mtime": "آخرین تغییر",
  "files.syncState": "وضعیت همگام‌سازی",
  "files.remotePeers": "به‌روز نزد همتاها",
  "files.remotePeersHint": "همتاهای مورد اعتمادی که آخرین مانیفستشان با این هش یکسان است",
  "files.chunkMap": "نقشهٔ قطعه‌ها",
  "files.chunkSize": "اندازهٔ قطعه",
  "files.chunks": "{done}/{total} قطعه",
  "files.peerStates": "وضعیت نزد همتاها",
  "files.peerName": "همتا",
  "files.peerHash": "هش",
  "files.peerMatch": "یکسان",
  "files.peerDiffers": "متفاوت",
  "files.peerSize": "حجم",
  "files.peerSeen": "دیده‌شده",
  "files.download": "دانلود",
  "files.dirStats": "{count} فایل · {bytes}",
  "files.invalidName": "نام فایل نمی‌تواند خالی یا دارای / باشد",
  "files.dirEntries": "موجودیت‌ها",
  "files.fileDetail": "جزئیات فایل",

  // -- sync workspace -------------------------------------------------------
  "sync.title": "همگام‌سازی",
  "sync.peer": "همتا",
  "sync.folder": "پوشه",
  "sync.selectPeer": "انتخاب همتا",
  "sync.selectFolder": "انتخاب پوشه",
  "sync.trustedOnly": "فقط همتاهای مورد اعتماد می‌توانند همگام شوند",
  "sync.computePlan": "محاسبهٔ طرح",
  "sync.computing": "در حال محاسبهٔ طرح…",
  "sync.planSummary": "خلاصهٔ طرح",
  "sync.planActions": "اقدام‌های طرح",
  "sync.generatedAt": "زمان تولید",
  "sync.total": "کل",
  "sync.pull": "دریافت (pull)",
  "sync.push": "ارسال (push)",
  "sync.deleteLocal": "حذف محلی",
  "sync.deleteRemote": "حذف نزد همتا",
  "sync.conflicts": "تعارض‌ها",
  "sync.unchanged": "بدون تغییر",
  "sync.execute": "اجرای طرح",
  "sync.executing": "در حال اجرا…",
  "sync.executeTitle": "طرح همگام‌سازی اجرا شود؟",
  "sync.executeIntro":
    "دقیقاً طبق فهرست طرح، فایل‌ها منتقل، حذف و بازنویسی می‌شوند.",
  "sync.executeDeletes":
    "این طرح شامل {deletes} حذف است — فایل‌های حذف‌شده به بازیافت طرف بازنده می‌روند.",
  "sync.executeConflicts":
    "{conflicts} فایل در حال تعارض است و تا زمان رفع تعارض نادیده گرفته می‌شود.",
  "sync.executePlain": "نه حذفی در کار است و نه تعارضی — طرح فقط فایل منتقل می‌کند.",
  "sync.liveProgress": "پیشرفت زنده",
  "sync.liveProgressHint": "انتقال‌های فعالِ این نشست",
  "sync.sessionStarted": "نشست {id} آغاز شد",
  "sync.noActive": "در حال حاضر انتقال فعالی در جریان نیست",
  "sync.sessionsHistory": "تاریخچهٔ نشست‌ها",
  "sync.peerCol": "همتا",
  "sync.folderCol": "پوشه",
  "sync.started": "شروع",
  "sync.duration": "مدت",
  "sync.filesCol": "فایل‌ها",
  "sync.bytesCol": "حجم",
  "sync.errorCol": "خطا",
  "sync.noSessions": "هنوز نشست همگام‌سازی‌ای ثبت نشده",
  "sync.noSessionsHint":
    "برای ساخت اولین نشست یک همگام‌سازی اجرا کنید. تاریخچه اینجا ظاهر می‌شود.",
  "sync.noPlan": "طرحی محاسبه نشده",
  "sync.noPlanHint":
    "یک همتای مورد اعتماد و یک پوشهٔ اشتراکی انتخاب کنید و طرح را محاسبه کنید تا ببینید چه اتفاقی می‌افتد — تا وقتی اجرا نکنید هیچ فایلی دست نمی‌خورد.",
  "sync.lastSynced": "آخرین همگام‌سازی",
  "sync.localHash": "محلی",
  "sync.remoteHash": "همتا",

  // -- transfers workspace --------------------------------------------------
  "transfers.title": "انتقال‌ها",
  "transfers.filter.all": "همه",
  "transfers.filter.active": "فعال",
  "transfers.filter.queued": "در صف",
  "transfers.filter.completed": "کامل‌شده",
  "transfers.filter.failed": "ناموفق",
  "transfers.filter.cancelled": "لغوشده",
  "transfers.speed": "سرعت",
  "transfers.eta": "زمان باقی‌مانده",
  "transfers.started": "شروع",
  "transfers.completed": "پایان",
  "transfers.chunks": "قطعه‌ها",
  "transfers.direction": "جهت",
  "transfers.errorDetails": "جزئیات خطا",
  "transfers.noTransfers": "انتقالی وجود ندارد",
  "transfers.noTransfersHint":
    "هنوز چیزی منتقل نشده است. یک همگام‌سازی اجرا کنید یا تعارضی را رفع کنید تا انتقال ساخته شود.",
  "transfers.noMatchFilter": "انتقالی در این وضعیت نیست",
  "transfers.sparkline": "سرعت اخیر (نمونه‌های زنده)",
  "transfers.aggregate": "مجموع",
  "transfers.pushHint": "ارسال به {peer}",
  "transfers.pullHint": "دریافت از {peer}",

  // -- conflicts workspace --------------------------------------------------
  "conflicts.title": "تعارض‌ها",
  "conflicts.open": "تعارض‌های باز",
  "conflicts.resolvedHistory": "تاریخچهٔ تعارض‌های حل‌شده",
  "conflicts.selected": "رفع تعارض",
  "conflicts.relPath": "فایل",
  "conflicts.folder": "پوشه",
  "conflicts.peer": "همتا",
  "conflicts.created": "زمان تشخیص",
  "conflicts.localVersion": "محلی — این دستگاه",
  "conflicts.remoteVersion": "همتا — {peer}",
  "conflicts.sizeDiff": "حجم‌ها {delta} با هم تفاوت دارند",
  "conflicts.sameSize": "حجم یکسان، محتوای متفاوت",
  "conflicts.keepLocal": "نگه‌داشتن نسخهٔ محلی",
  "conflicts.keepLocalHint":
    "نسخهٔ این دستگاه به همتا ارسال می‌شود؛ نسخهٔ فعلی همتا به بازیافتِ آن دستگاه می‌رود.",
  "conflicts.keepRemote": "نگه‌داشتن نسخهٔ همتا",
  "conflicts.keepRemoteHint":
    "نسخهٔ همتا روی نسخهٔ محلی بازنویسی می‌شود؛ نسخهٔ محلی به بازیافت می‌رود.",
  "conflicts.keepBoth": "نگه‌داشتن هر دو",
  "conflicts.keepBothHint":
    "نسخهٔ همتا با نام {filename} کنار فایل محلی ذخیره می‌شود و نسخهٔ محلی برندهٔ مسیر اصلی می‌شود.",
  "conflicts.later": "بعداً حل می‌کنم",
  "conflicts.laterHint": "تعارض باز می‌ماند و هیچ داده‌ای دست نمی‌خورد.",
  "conflicts.resolve": "رفع",
  "conflicts.resolving": "در حال رفع…",
  "conflicts.noConflicts": "تعارض بازی وجود ندارد",
  "conflicts.noConflictsHint":
    "چیزی منتظر تصمیم شما نیست. هر وقت هر دو طرف یک فایل را تغییر داده باشند، تعارض اینجا ظاهر می‌شود.",
  "conflicts.noResolved": "هنوز تعارضی حل نشده",
  "conflicts.noSelection": "تعارضی انتخاب نشده",
  "conflicts.noSelectionHint":
    "برای مقایسهٔ نسخه‌ها و رفع تعارض، یکی را از فهرست انتخاب کنید.",
  "conflicts.resolution": "نتیجهٔ رفع",
  "conflicts.resolvedAt": "زمان رفع",
  "conflicts.size": "حجم",
  "conflicts.mtime": "آخرین تغییر",

  // -- activity workspace ---------------------------------------------------
  "activity.title": "فعالیت",
  "activity.severity": "سطح",
  "activity.type": "نوع",
  "activity.message": "پیام",
  "activity.searchPlaceholder": "جستجو در پیام‌ها…",
  "activity.allTypes": "همهٔ نوع‌ها",
  "activity.severity.all": "همه",
  "activity.severity.info": "اطلاع",
  "activity.severity.warn": "هشدار",
  "activity.severity.error": "خطا",
  "activity.eventData": "دادهٔ رخداد (JSON)",
  "activity.noEvents": "هنوز رخدادی ثبت نشده",
  "activity.noEventsHint":
    "ایجنت هنوز رخدادی تولید نکرده است. عملیات و تغییر وضعیت‌ها به‌صورت زنده اینجا ظاهر می‌شوند.",
  "activity.noMatch": "رخدادی مطابق پالایه‌ها نیست",
  "activity.live": "زنده — از جدیدترین",
  "activity.count": "{count} رخداد",

  // -- settings workspace ---------------------------------------------------
  "settings.title": "تنظیمات",
  "settings.identity": "هویت",
  "settings.transfer": "انتقال",
  "settings.behavior": "رفتار",
  "settings.interface": "رابط کاربری",
  "settings.about": "درباره",
  "settings.deviceName": "نام دستگاه",
  "settings.deviceNameHint": "این نام هنگام جفت‌سازی و همگام‌سازی به همتاها نمایش داده می‌شود",
  "settings.bandwidthLimit": "محدودیت پهنای باند",
  "settings.unlimited": "نامحدود",
  "settings.bandwidthUnit": "مقدار محدودیت",
  "settings.concurrency": "انتقال‌های همزمان",
  "settings.chunkSize": "اندازهٔ قطعه",
  "settings.discovery": "کشف همتاها",
  "settings.discoveryHint": "اعلان و شنود بیکن‌های کشف در شبکهٔ محلی",
  "settings.skipHidden": "نادیده‌گرفتن فایل‌های مخفی",
  "settings.skipHiddenHint": "فایل‌های نقطه‌دار و مخفی نمایه و همگام نمی‌شوند",
  "settings.autoSync": "فاصلهٔ همگام‌سازی خودکار",
  "settings.autoSyncOff": "فقط دستی",
  "settings.autoSyncHint": "هر چند وقت پوشه‌های اشتراکی با همتاهای مورد اعتماد همگام شوند",
  "settings.save": "ذخیرهٔ تنظیمات",
  "settings.saving": "در حال ذخیره…",
  "settings.saved": "تنظیمات ذخیره شد",
  "settings.storedResponse": "تنظیمات ذخیره‌شده (پاسخ ایجنت)",
  "settings.storedHint": "این‌ها همان مقادیری هستند که ایجنت واقعاً ذخیره کرده است، بدون تغییر.",
  "settings.language": "زبان",
  "settings.theme": "پوسته",
  "settings.themeLight": "روشن",
  "settings.themeDark": "تاریک",
  "settings.aboutText": "MeshSync — همگام‌سازی بومی-اول فایل‌ها به‌صورت همتا-به-همتا",
  "settings.license": "مجوز Apache-2.0",
  "settings.copyright": "© 2026 Parsa Fathi",
  "settings.validation": "قبل از ذخیره، فیلدهای مشخص‌شده را اصلاح کنید",
  "settings.invalidBandwidth": "محدودیت پهنای باند باید عددی مثبت باشد",
  "settings.invalidConcurrency": "همزمانی باید بین 1 تا 16 باشد",
  "settings.invalidName": "نام دستگاه لازم است",
  "settings.notLoaded": "تنظیمات هنوز بارگذاری نشده",
  "settings.notLoadedHint":
    "با پاسخ ایجنت تنظیمات اینجا ظاهر می‌شود. وضعیت دسترسی در بنر بالا نشان داده می‌شود.",

  // -- empty / loading / errors ---------------------------------------------
  "state.loadingData": "در حال دریافت داده از ایجنت…",
  "state.unreachableShort": "ایجنت در دسترس نیست",
  "err.agentError": "{message} ({code})",
  "err.unknown": "خطای غیرمنتظره: {message}",
  "err.requestFailed": "درخواست ناموفق بود",
  "err.offline": "ایجنت آفلاین است؛ عملیات انجام نشد.",

  // -- toasts ---------------------------------------------------------------
  "toast.savedName": "نام دستگاه به {name} تغییر کرد",
  "toast.pairRequested": "درخواست جفت‌سازی ارسال شد — در انتظار تأیید دستگاه مقابل",
  "toast.peerApproved": "همتای {name} تأیید و مورد اعتماد شد",
  "toast.peerRevoked": "اعتماد به {name} لغو شد",
  "toast.peerRemoved": "همتای {name} حذف شد",
  "toast.scanFound": "اسکن کشف تمام شد — {count} همتا پیدا شد",
  "toast.folderAdded": "پوشهٔ اشتراکی {name} اضافه شد",
  "toast.folderRemoved": "پوشهٔ {name} حذف شد",
  "toast.rescanDone": "اسکن: {scanned} فایل، {changed} تغییر، {removed} حذف",
  "toast.fileCreated": "فایل {name} ایجاد شد",
  "toast.fileUploaded": "فایل {name} بارگذاری شد ({size})",
  "toast.fileDeleted": "فایل {name} به بازیافت منتقل شد",
  "toast.planComputed": "طرح محاسبه شد — {total} مسیر دسته‌بندی شد",
  "toast.syncStarted": "نشست همگام‌سازی {id} آغاز شد",
  "toast.transferPaused": "انتقال متوقف شد",
  "toast.transferResumed": "انتقال ادامه یافت",
  "toast.transferCancelled": "انتقال لغو شد",
  "toast.transferRetried": "انتقال دوباره وارد صف شد",
  "toast.conflictResolved": "تعارض حل شد — {resolution}",
  "toast.settingsSaved": "تنظیمات ذخیره شد",
  "toast.copied": "در حافظه کپی شد",

  // -- dialogs / misc -------------------------------------------------------
  "dialog.renameDevice": "تغییر نام دستگاه",
  "dialog.newFileTitle": "فایل جدید",
  "dialog.uploadTitle": "بارگذاری فایل",
  "dialog.pairTitle": "جفت‌سازی با همتا",
  "dialog.addFolderTitle": "افزودن پوشهٔ اشتراکی",
  "validation.address": "نشانی باید به شکل host:port باشد",
  "validation.port": "پورت باید عددی بین 1 و 65535 باشد",
  "validation.required": "این فیلد الزامی است",
  "validation.invalidAddress": "یک نشانی معتبر وارد کنید (host:port)",
  "validation.fileRequired": "یک فایل برای بارگذاری انتخاب کنید",
  "misc.yes": "بله",
  "misc.no": "خیر",
  "misc.confirmProceed": "بله، انجام بده",
  "misc.perSecondSuffix": "/ث",
  "misc.pct": "{value}%",
  "misc.dash": "—",
  "misc.agent": "ایجنت",
};

const dictionaries: Record<Lang, Record<DictKey, string>> = {
  en,
  fa,
};

// ---------------------------------------------------------------------------
// Client id (browser) for the prefs API
// ---------------------------------------------------------------------------

const CLIENT_ID_KEY = "meshsync.client-id";
const LANG_KEY = "meshsync.lang";

export function getClientId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.localStorage.setItem(CLIENT_ID_KEY, id);
    } catch {
      /* storage unavailable — keep in-memory id */
    }
  }
  return id;
}

async function persistPref(patch: { language?: string; theme?: string }) {
  try {
    const clientId = getClientId();
    await fetch("/api/web/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, ...patch }),
    });
  } catch {
    /* prefs persistence is best-effort */
  }
}

export { persistPref };

async function readPref(): Promise<{ language: string | null } | null> {
  try {
    const clientId = getClientId();
    const res = await fetch(
      `/api/web/prefs?clientId=${encodeURIComponent(clientId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as { language: string | null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type TranslateFn = (
  key: DictKey,
  params?: Record<string, string | number>
) => string;

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TranslateFn;
  fmt: {
    bytes: (n: number | null | undefined) => string;
    speed: (n: number | null | undefined) => string;
    num: (n: number | null | undefined) => string;
    compact: (n: number | null | undefined) => string;
    duration: (seconds: number | null | undefined) => string;
    uptime: (seconds: number | null | undefined) => string;
    relative: (iso: string | null | undefined) => string;
    dateTime: (iso: string | null | undefined) => string;
    dateIso: (iso: string | null | undefined) => string;
  };
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Detect language on mount: localStorage → prefs API → navigator.
  useEffect(() => {
    let cancelled = false;
    const stored = window.localStorage.getItem(LANG_KEY);
    const detect = (): Lang => {
      const nav = navigator.language ?? "en";
      return nav.toLowerCase().startsWith("fa") ? "fa" : "en";
    };
    const apply = (l: Lang) => {
      if (cancelled || l === lang) {
        if (!cancelled) setLangState(l);
        return;
      }
      setLangState(l);
    };
    if (stored === "fa" || stored === "en") {
      apply(stored);
    } else {
      const initial = detect();
      apply(initial);
      // Consult the server pref as a secondary source (async, non-blocking).
      void readPref().then((pref) => {
        if (!cancelled && pref?.language === "fa") setLangState("fa");
        if (!cancelled && pref?.language === "en") setLangState("en");
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep <html lang/dir> in sync (must run on every lang change).
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "fa" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      /* ignore storage failures */
    }
    void persistPref({ language: next });
  }, []);

  const t = useCallback<TranslateFn>(
    (key, params) => {
      const dict = dictionaries[lang];
      const template = dict[key] ?? dictionaries.en[key] ?? key;
      return interpolate(template, params);
    },
    [lang]
  );

  const fmt = useMemo<I18nContextValue["fmt"]>(
    () => ({
      bytes: (n) => formatBytes(n),
      speed: (n) => formatSpeed(n),
      num: (n) => formatNum(n),
      compact: (n) => formatCompactNum(n),
      duration: (s) => formatDuration(s),
      uptime: (s) => formatUptime(s),
      relative: (iso) => formatRelative(iso, lang),
      dateTime: (iso) => formatDateTime(iso, lang),
      dateIso: (iso) => formatDateIso(iso),
    }),
    [lang]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t, fmt }),
    [lang, setLang, t, fmt]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}
