/// Hand-rolled bilingual strings (fa / en). Persian is the primary language.
///
/// A single [AppStrings] instance carries every UI string; [AppStrings.fa]
/// and [AppStrings.en] are the two built-in instances. Numbers are rendered
/// with Persian digits in the `fa` instance.
library;

/// Converts [n] to a display string with locale-appropriate digits.
typedef NumberFormatter = String Function(int n);

class AppStrings {
  const AppStrings._(this._fa, this._digits);

  /// Persian (primary).
  static const AppStrings fa = AppStrings._(true, _persianDigits);

  /// English.
  static const AppStrings en = AppStrings._(false, _latinDigits);

  static String _latinDigits(int n) => '$n';

  static const List<String> _faDigits = [
    '۰',
    '۱',
    '۲',
    '۳',
    '۴',
    '۵',
    '۶',
    '۷',
    '۸',
    '۹',
  ];

  static String _persianDigits(int n) {
    final raw = '$n';
    if (!raw.codeUnits.any((u) => u >= 0x30 && u <= 0x39)) return raw;
    return String.fromCharCodes(
      raw.codeUnits.map((u) {
        if (u >= 0x30 && u <= 0x39) return _faDigits[u - 0x30].codeUnitAt(0);
        return u;
      }),
    );
  }

  final bool _fa;
  final NumberFormatter _digits;

  /// Locale-aware number formatting.
  String num(int n) => _digits(n);

  // -- App ----------------------------------------------------------------
  String get appTitle => 'MeshSync';

  String get tabDevice => _fa ? 'دستگاه' : 'Device';
  String get tabPeers => _fa ? 'همتاها' : 'Peers';
  String get tabFolders => _fa ? 'پوشه‌ها' : 'Folders';
  String get tabSync => _fa ? 'همگام‌سازی' : 'Sync';
  String get tabTransfers => _fa ? 'انتقال‌ها' : 'Transfers';
  String get conflictsTitle => _fa ? 'تعارض‌ها' : 'Conflicts';
  String get settingsTitle => _fa ? 'تنظیمات' : 'Settings';

  // -- Common -------------------------------------------------------------
  String get retry => _fa ? 'تلاش دوباره' : 'Retry';
  String get refresh => _fa ? 'بازخوانی' : 'Refresh';
  String get save => _fa ? 'ذخیره' : 'Save';
  String get cancel => _fa ? 'انصراف' : 'Cancel';
  String get deleteBtn => _fa ? 'حذف' : 'Delete';
  String get close => _fa ? 'بستن' : 'Close';
  String get ok => _fa ? 'باشه' : 'OK';
  String get yes => _fa ? 'بله' : 'Yes';
  String get no => _fa ? 'خیر' : 'No';
  String get loading => _fa ? 'در حال بارگذاری…' : 'Loading…';
  String get errorOccurred => _fa ? 'خطا رخ داد' : 'Something went wrong';
  String actionFailed(Object error) =>
      _fa ? 'عملیات ناموفق بود: $error' : 'Action failed: $error';
  String get savedMsg => _fa ? 'ذخیره شد' : 'Saved';

  // -- Connection ---------------------------------------------------------
  String get online => _fa ? 'آنلاین' : 'Online';
  String get offline => _fa ? 'آفلاین' : 'Offline';
  String get connecting => _fa ? 'در حال اتصال…' : 'Connecting…';
  String get agentUnreachable => _fa ? 'ایجنت در دسترس نیست' : 'Agent unreachable';
  String get checkAddressHint => _fa
      ? 'آدرس را در تنظیمات بررسی کنید. برنامه مستقیم به ایجنت روی شبکه محلی وصل می‌شود.'
      : 'Check the address in settings. The app talks directly to the agent on your LAN.';
  String get openConflicts => _fa ? 'تعارض‌های باز' : 'Open conflicts';

  // -- Device screen ------------------------------------------------------
  String get thisDevice => _fa ? 'این دستگاه' : 'This device';
  String get uptime => _fa ? 'مدت فعالیت' : 'Uptime';
  String get startedAt => _fa ? 'زمان اجرا' : 'Started at';
  String get apiPort => 'API ${_fa ? 'پورت' : 'port'}';
  String get peerPort => _fa ? 'پورت همتا' : 'Peer port';
  String get keyFingerprint => _fa ? 'اثر انگشت کلید' : 'Key fingerprint';
  String get nativeEngine => _fa ? 'موتور بومی' : 'Native engine';
  String get platform => _fa ? 'پلتفرم' : 'Platform';
  String get version => _fa ? 'نسخه' : 'Version';
  String get peerIdLabel => _fa ? 'شناسه همتا' : 'Peer ID';
  String get dbOkLabel => _fa ? 'پایگاه‌داده' : 'Database';
  String get dbHealthy => _fa ? 'سالم' : 'healthy';
  String get dbUnhealthy => _fa ? 'مشکل دارد' : 'unhealthy';
  String get stats => _fa ? 'آمار' : 'Stats';
  String get foldersStat => _fa ? 'پوشه‌ها' : 'Folders';
  String get filesIndexedStat => _fa ? 'فایل‌های نمایه‌شده' : 'Files indexed';
  String get bytesIndexedStat => _fa ? 'حجم نمایه‌شده' : 'Bytes indexed';
  String get peersTrustedStat => _fa ? 'همتاهای مطمئن' : 'Trusted peers';
  String get peersOnlineStat => _fa ? 'همتاهای آنلاین' : 'Online peers';
  String get transfersActiveStat => _fa ? 'انتقال‌های فعال' : 'Active transfers';
  String get transfersCompletedStat =>
      _fa ? 'انتقال‌های کامل‌شده' : 'Completed transfers';
  String get conflictsOpenStat => _fa ? 'تعارض‌های باز' : 'Open conflicts';
  String get lastSyncAt => _fa ? 'آخرین همگام‌سازی' : 'Last sync';
  String get never => _fa ? 'هرگز' : 'Never';
  String get recentActivity => _fa ? 'آخرین رویدادها' : 'Recent activity';
  String get noEventsYet => _fa ? 'هنوز رویدادی ثبت نشده.' : 'No events yet.';

  // -- Peers --------------------------------------------------------------
  String get noPeersTitle => _fa ? 'همتایی نیست' : 'No peers yet';
  String get noPeersHint => _fa
      ? 'با «اسکن شبکه» همتاهای هم‌شبکه را پیدا کنید یا آدرسشان را دستی وارد کنید.'
      : 'Scan the network to find peers, or enter an address by hand.';
  String get scanNetwork => _fa ? 'اسکن شبکه' : 'Scan network';
  String get pairNewPeer => _fa ? 'جفت‌سازی همتای جدید' : 'Pair a new peer';
  String get peerAddressLabel => _fa ? 'آدرس همتا (host:port)' : 'Peer address (host:port)';
  String get peerAddressHint => _fa ? 'مثلاً 192.168.1.20:4040' : 'e.g. 192.168.1.20:4040';
  String get pair => _fa ? 'جفت‌سازی' : 'Pair';
  String get trustDiscovered => _fa ? 'کشف‌شده' : 'Discovered';
  String get trustPairing => _fa ? 'در انتظار تأیید' : 'Awaiting approval';
  String get trustTrusted => _fa ? 'مطمئن' : 'Trusted';
  String get trustRevoked => _fa ? 'لغوشده' : 'Revoked';
  String get approve => _fa ? 'تأیید' : 'Approve';
  String get revoke => _fa ? 'لغو اعتماد' : 'Revoke trust';
  String get removePeer => _fa ? 'حذف همتا' : 'Remove peer';
  String get confirmRemovePeerTitle => _fa ? 'حذف همتا؟' : 'Remove peer?';
  String get confirmRemovePeerBody => _fa
      ? 'رکورد این همتا کامل حذف می‌شود؛ برای همگام‌سازی مجدد باید دوباره جفت‌سازی کنید.'
      : 'The peer record is removed. You will have to pair again to re-sync.';
  String get lastSeenLabel => _fa ? 'آخرین حضور' : 'Last seen';
  String get neverSeen => _fa ? 'دیده نشده' : 'Never seen';
  String get justNow => _fa ? 'همین حالا' : 'Just now';
  String minutesAgo(int n) => _fa ? '${num(n)} دقیقه پیش' : '$n min ago';
  String hoursAgo(int n) => _fa ? '${num(n)} ساعت پیش' : '$n h ago';
  String daysAgo(int n) => _fa ? '${num(n)} روز پیش' : '$n d ago';
  String sharedFoldersCount(int n) =>
      _fa ? '${num(n)} پوشه مشترک' : '$n shared ${n == 1 ? 'folder' : 'folders'}';
  String get noNewPeersFound => _fa ? 'همتای تازه‌ای پیدا نشد.' : 'No new peers found.';
  String newPeersFound(int n) =>
      _fa ? '${num(n)} همتای تازه پیدا شد.' : 'Found $n new ${n == 1 ? 'peer' : 'peers'}.';
  String get waitingForApproval =>
      _fa ? 'منتظر تأیید طرف مقابل است' : 'Waiting for the other side to approve';

  // -- Folders ------------------------------------------------------------
  String get noFoldersTitle => _fa ? 'پوشه‌ای به اشتراک گذاشته نشده' : 'No shared folders yet';
  String get noFoldersHint => _fa
      ? 'یک مسیر محلی را برای همگام‌سازی تعریف کنید. پوشه‌ای با همان نام روی همتا همگام می‌شود.'
      : 'Define a local path to share. A folder with the same name syncs with the peer.';
  String get addFolder => _fa ? 'افزودن پوشه' : 'Add folder';
  String get folderNameLabel => _fa ? 'نام پوشه' : 'Folder name';
  String get folderNameHint => _fa ? 'مثلاً Documents — روی هر دو دستگاه یکسان' : 'e.g. Documents — must match on both devices';
  String get folderPathLabel => _fa ? 'مسیر مطلق پوشه' : 'Absolute folder path';
  String get folderPathHint => _fa ? 'مثلاً /home/z/meshsync/shared' : 'e.g. /home/z/meshsync/shared';
  String get rescan => _fa ? 'اسکن مجدد' : 'Rescan';
  String get removeFolder => _fa ? 'حذف پوشه' : 'Remove folder';
  String get confirmRemoveFolderBody => _fa
      ? 'همگام‌سازی این پوشه متوقف می‌شود؛ فایل‌ها روی دیسک می‌مانند.'
      : 'Syncing stops for this folder; files stay on disk.';
  String get deleteFilesToo => _fa ? 'فایل‌ها هم حذف شوند (به سبد بازیافت)' : 'Also delete files (sent to trash)';
  String filesCount(int n) => _fa ? '${num(n)} فایل' : '$n ${n == 1 ? 'file' : 'files'}';
  String get lastScanLabel => _fa ? 'آخرین اسکن' : 'Last scan';
  String get open => _fa ? 'باز کردن' : 'Open';
  String rescanResult(int scanned, int changed, int removed) => _fa
      ? '${num(scanned)} فایل بررسی شد، ${num(changed)} تغییر، ${num(removed)} حذف'
      : 'Scanned $scanned, changed $changed, removed $removed';

  // -- Files --------------------------------------------------------------
  String get emptyDir => _fa ? 'این پوشه خالی است.' : 'This folder is empty.';
  String get upLevel => _fa ? 'سطح بالاتر' : 'Up one level';
  String get newFile => _fa ? 'فایل متنی جدید' : 'New text file';
  String get fileNameLabel => _fa ? 'نام فایل' : 'File name';
  String get fileContentLabel => _fa ? 'محتوا' : 'Content';
  String get create => _fa ? 'ایجاد' : 'Create';
  String get deleteFileTitle => _fa ? 'حذف فایل؟' : 'Delete file?';
  String get deleteFileBody => _fa
      ? 'فایل به سبد بازیافت ایجنت منتقل و از نمایه حذف می‌شود.'
      : 'The file is moved to the agent trash and tombstoned in the index.';
  String get download => _fa ? 'دانلود' : 'Download';
  String downloadedTo(String path) => _fa ? 'در $path ذخیره شد' : 'Saved to $path';
  String get details => _fa ? 'جزئیات فایل' : 'File details';
  String get hashLabel => 'SHA-256';
  String get lastSyncedHashLabel => _fa ? 'هش آخرین همگام‌سازی' : 'Last synced hash';
  String get sizeLabel => _fa ? 'اندازه' : 'Size';
  String get modifiedLabel => _fa ? 'زمان تغییر' : 'Modified';
  String get syncStateLabel => _fa ? 'وضعیت همگام‌سازی' : 'Sync state';
  String get chunksLabel => _fa ? 'قطعه‌ها' : 'Chunks';
  String get peerCopiesLabel => _fa ? 'نسخه‌های روی همتاها' : 'Copies on peers';
  String copiesOnPeers(int n) =>
      _fa ? 'به‌روز روی ${num(n)} همتا' : 'Up to date on $n ${n == 1 ? 'peer' : 'peers'}';
  String get neverIndexed => _fa ? 'هنوز نمایه نشده' : 'Not indexed yet';
  String get fileNotFound => _fa ? 'فایل پیدا نشد' : 'File not found';
  String get fileHint => _fa ? 'مسیر فایل' : 'File path';

  // -- File sync states ---------------------------------------------------
  String get syncSynced => _fa ? 'همگام' : 'Synced';
  String get syncPending => _fa ? 'در انتظار' : 'Pending';
  String get syncSyncing => _fa ? 'در حال همگام‌سازی' : 'Syncing';
  String get syncConflict => _fa ? 'تعارض' : 'Conflict';
  String get syncLocalOnly => _fa ? 'فقط محلی' : 'Local only';

  // -- Sync screen --------------------------------------------------------
  String get pickPeerPrompt => _fa ? 'همتا را انتخاب کنید' : 'Select a peer';
  String get pickFolderPrompt => _fa ? 'پوشه را انتخاب کنید' : 'Select a folder';
  String get peerLabel => _fa ? 'همتا' : 'Peer';
  String get folderLabel => _fa ? 'پوشه' : 'Folder';
  String get previewPlan => _fa ? 'پیش‌نمایش تغییرات' : 'Preview changes';
  String get startSync => _fa ? 'شروع همگام‌سازی' : 'Start sync';
  String get planSummaryLabel => _fa ? 'خلاصه برنامه همگام‌سازی' : 'Sync plan summary';
  String get total => _fa ? 'کل' : 'Total';
  String get pullLabel => _fa ? 'دریافت' : 'Pull';
  String get pushLabel => _fa ? 'ارسال' : 'Push';
  String get deleteLocalLabel => _fa ? 'حذف محلی' : 'Delete local';
  String get deleteRemoteLabel => _fa ? 'حذف از همتا' : 'Delete remote';
  String get conflictsLabel => _fa ? 'تعارض' : 'Conflicts';
  String get unchangedLabel => _fa ? 'بدون تغییر' : 'Unchanged';
  String get planActionsLabel => _fa ? 'اقدام‌های برنامه' : 'Planned actions';
  String get allSynced => _fa ? 'تفاوتی نیست؛ همه‌چیز همگام است.' : 'Nothing to do — everything is in sync.';
  String sessionStarted(String id) =>
      _fa ? 'نشست همگام‌سازی $id شروع شد' : 'Sync session $id started';
  String get recentSessions => _fa ? 'نشست‌های اخیر' : 'Recent sessions';
  String get noSessions => _fa ? 'هنوز همگام‌سازی‌ای اجرا نشده.' : 'No sync sessions yet.';
  String get needTrustedPeer => _fa ? 'برای همگام‌سازی اول یک همتا را تأیید کنید.' : 'Approve a peer first to sync.';
  String get needFolder => _fa ? 'برای همگام‌سازی اول یک پوشه تعریف کنید.' : 'Add a shared folder first.';
  String get conflictsBanner => _fa
      ? 'تعارض باز وجود دارد؛ قبل از همگام‌سازی حلش کنید.'
      : 'There are open conflicts — resolve them before syncing.';

  // -- Plan action states -------------------------------------------------
  String get actionUnchanged => _fa ? 'بدون تغییر' : 'Unchanged';
  String get actionLocalOnly => _fa ? 'فقط محلی' : 'Local only';
  String get actionRemoteOnly => _fa ? 'فقط روی همتا' : 'Remote only';
  String get actionLocalModified => _fa ? 'تغییر محلی' : 'Local modified';
  String get actionRemoteModified => _fa ? 'تغییر روی همتا' : 'Remote modified';
  String get actionConflict => _fa ? 'تعارض' : 'Conflict';
  String get actionDeleteLocal => _fa ? 'حذف محلی' : 'Delete local';
  String get actionDeleteRemote => _fa ? 'حذف از همتا' : 'Delete remote';

  // -- Transfers ----------------------------------------------------------
  String get transfersEmptyTitle => _fa ? 'انتقالی نیست' : 'No transfers';
  String get transfersEmptyHint => _fa
      ? 'با شروع همگام‌سازی، انتقال‌ها همراه پیشرفت واقعی اینجا دیده می‌شوند.'
      : 'Start a sync — transfers with real progress show up here.';
  String get activeTransfers => _fa ? 'فعال' : 'Active';
  String get allTransfers => _fa ? 'همه' : 'All';
  String get etaLabel => _fa ? 'باقی‌مانده' : 'ETA';
  String get chunksProgressLabel => _fa ? 'قطعه‌ها' : 'Chunks';
  String get pause => _fa ? 'توقف' : 'Pause';
  String get resume => _fa ? 'ادامه' : 'Resume';
  String get cancelTransfer => _fa ? 'لغو' : 'Cancel';
  String get retryTransfer => _fa ? 'تلاش دوباره' : 'Retry';
  String get directionPush => _fa ? 'ارسال' : 'Push';
  String get directionPull => _fa ? 'دریافت' : 'Pull';
  String get statusQueued => _fa ? 'در صف' : 'Queued';
  String get statusPreparing => _fa ? 'آماده‌سازی' : 'Preparing';
  String get statusTransferring => _fa ? 'در حال انتقال' : 'Transferring';
  String get statusVerifying => _fa ? 'در حال بررسی' : 'Verifying';
  String get statusPaused => _fa ? 'متوقف‌شده' : 'Paused';
  String get statusCompleted => _fa ? 'کامل‌شده' : 'Completed';
  String get statusFailed => _fa ? 'شکست‌خورده' : 'Failed';
  String get statusCancelled => _fa ? 'لغوشده' : 'Cancelled';
  String get transferErrorLabel => _fa ? 'خطا' : 'Error';

  // -- Conflicts ----------------------------------------------------------
  String get conflictsEmptyTitle => _fa ? 'تعارضی نیست' : 'No conflicts';
  String get conflictsEmptyHint => _fa
      ? 'وقتی دو دستگاه همزمان یک فایل را تغییر دهند، تعارض اینجا ظاهر می‌شود.'
      : 'When two devices change the same file at once, the conflict shows up here.';
  String get openConflictsSection => _fa ? 'تعارض‌های باز' : 'Open conflicts';
  String get resolvedConflictsSection => _fa ? 'حل‌شده' : 'Resolved';
  String get resolveConflictTitle => _fa ? 'حل تعارض' : 'Resolve conflict';
  String get localVersionLabel => _fa ? 'نسخه محلی' : 'Local version';
  String remoteVersionFrom(String peer) =>
      _fa ? 'نسخه $peer' : 'Version from $peer';
  String get keepLocalBtn => _fa ? 'نگه‌داشتن محلی' : 'Keep local';
  String get keepRemoteBtn => _fa ? 'نگه‌داشتن نسخه همتا' : 'Keep remote';
  String get keepBothBtn => _fa ? 'نگه‌داشتن هر دو' : 'Keep both';
  String get laterBtn => _fa ? 'بعداً حل می‌کنم' : 'Resolve later';
  String get keepLocalDesc => _fa
      ? 'نسخه محلی برنده می‌شود و به همتا ارسال می‌شود؛ نسخه فعلی همتا به سبد بازیافت آن می‌رود.'
      : 'Local wins and is pushed to the peer; the peer copy goes to its trash.';
  String get keepRemoteDesc => _fa
      ? 'نسخه همتا جایگزین فایل محلی می‌شود؛ نسخه محلی به سبد بازیافت می‌رود.'
      : 'Remote wins and replaces the local file; local goes to the trash.';
  String get keepBothDesc => _fa
      ? 'نسخه همتا با نامی جدید کنار فایل محلی ذخیره می‌شود و نسخه محلی برنده می‌شود.'
      : 'The remote copy is saved next to the local file under a new name; local wins the original path.';
  String get laterDesc => _fa
      ? 'فعلاً هیچ‌چیز تغییر نمی‌کند و تعارض باز می‌ماند.'
      : 'Nothing changes for now — the conflict stays open.';
  String get resolvedLabel => _fa ? 'حل‌شده' : 'Resolved';
  String get createdLabel => _fa ? 'ایجادشده' : 'Created';
  String get onDevice => _fa ? 'روی این دستگاه' : 'on this device';
  String get onPeerDevice => _fa ? 'روی دستگاه همتا' : 'on the peer device';

  // -- Settings -----------------------------------------------------------
  String get appSection => _fa ? 'تنظیمات برنامه' : 'App settings';
  String get connectionSection => _fa ? 'اتصال به ایجنت' : 'Agent connection';
  String get hostLabel => _fa ? 'آدرس ایجنت' : 'Agent host';
  String get hostHint => _fa ? 'IP ایجنت روی شبکه محلی، مثلاً 192.168.1.20' : 'Agent IP on the LAN, e.g. 192.168.1.20';
  String get portLabel => _fa ? 'پورت API' : 'API port';
  String get directConnectionNote => _fa
      ? 'این اپ مستقیم به ایجنت روی شبکه محلی وصل می‌شود و از هیچ سرور واسطی استفاده نمی‌کند؛ ایجنت باید روی همین شبکه در دسترس باشد.'
      : 'This app talks directly to the agent on your LAN — there is no gateway in between. The agent must be reachable from this network.';
  String get applyAndReconnect => _fa ? 'اعمال و اتصال مجدد' : 'Apply & reconnect';
  String get languageLabel => _fa ? 'زبان' : 'Language';
  String get persian => 'فارسی';
  String get english => 'English';
  String get themeLabel => _fa ? 'پوسته' : 'Theme';
  String get themeSystem => _fa ? 'همسان با سیستم' : 'System';
  String get themeLight => _fa ? 'روشن' : 'Light';
  String get themeDark => _fa ? 'تیره' : 'Dark';
  String get agentSection => _fa ? 'تنظیمات ایجنت' : 'Agent settings';
  String get deviceNameLabel => _fa ? 'نام دستگاه' : 'Device name';
  String get bandwidthLimitLabel => _fa ? 'محدودیت پهنای‌باند (بایت/ثانیه)' : 'Bandwidth limit (bytes/s)';
  String get unlimitedHint => _fa ? 'صفر یعنی بدون محدودیت' : '0 means unlimited';
  String get concurrentTransfersLabel => _fa ? 'انتقال‌های همزمان' : 'Concurrent transfers';
  String get chunkSizeLabel => _fa ? 'اندازه قطعه (بایت)' : 'Chunk size (bytes)';
  String get discoveryEnabledLabel => _fa ? 'کشف خودکار همتاها' : 'Automatic peer discovery';
  String get skipHiddenFilesLabel => _fa ? 'نادیده‌گرفتن فایل‌های مخفی' : 'Skip hidden files';
  String get autoSyncSecondsLabel => _fa ? 'بازهٔ همگام‌سازی خودکار (ثانیه)' : 'Auto-sync interval (seconds)';
  String get manualSyncHint => _fa ? 'صفر یعنی فقط همگام‌سازی دستی' : '0 means manual sync only';
  String get saveAgentSettings => _fa ? 'ذخیره تنظیمات ایجنت' : 'Save agent settings';
  String get agentSettingsLoadFailed => _fa ? 'تنظیمات ایجنت خوانده نشد.' : 'Could not read agent settings.';
  String get aboutSection => _fa ? 'درباره' : 'About';
  String get clientVersionLabel => _fa ? 'نسخهٔ کلاینت' : 'Client version';
  String get apiContractLabel => _fa ? 'قرارداد API' : 'API contract';
  String get invalidNumber => _fa ? 'عدد معتبر نیست' : 'Not a valid number';
  String get invalidPort => _fa ? 'پورت باید بین ۱ تا ۶۵۵۳۵ باشد' : 'Port must be 1–65535';
  String get hostRequired => _fa ? 'آدرس ایجنت را وارد کنید' : 'Enter the agent host';

  // -- Misc ---------------------------------------------------------------
  String get notAvailable => '—';
  String get detailsTag => _fa ? 'جزئیات' : 'Details';
}
