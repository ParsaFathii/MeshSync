# قرارداد API ایجنت MeshSync — نسخهٔ ۱ (فارسی)

این سند معادل فارسیِ [docs/API.md](../API.md) است؛ مرجع قطعی همان سند
انگلیسی است و اینجا خلاصهٔ دقیقی از همان قرارداد می‌بینید. همهٔ
مسیرها، نام‌ها و مقادیر دقیقاً همان‌هایی هستند که ایجنت پیاده کرده است.

- نشانی پایه (محلی): `http://127.0.0.1:{apiPort}` — پورت پیش‌فرض `3040`
  (دستگاه دوم در دمو: `3041`).
- نوع محتوا: `application/json` مگر خلافش گفته شود.
- زمان‌ها: رشتهٔ RFC 3339 در UTC. هش‌ها: hex کوچکِ SHA-256.
- پورت‌ها: API یعنی `3040`/`3041`؛ peer یعنی TCP `4040`/`4041`.
- در محیط سندباکس، هر درخواست پورت مقصد را به‌صورت پارامتر کوئری
  می‌گیرد: `GET /api/v1/device?XTransformPort=3040`.

## قالب خطا

هر پاسخ غیر 2xx یک پاکت واحد دارد:

```json
{ "error": { "code": "PEER_NOT_FOUND", "message": "peer … is not known to this device" } }
```

کدهای رایج: `BAD_REQUEST`، `VALIDATION`، `NOT_FOUND`، `PEER_NOT_FOUND`،
`FOLDER_NOT_FOUND`، `TRANSFER_NOT_FOUND`، `CONFLICT_NOT_FOUND`،
`PEER_OFFLINE`، `NOT_TRUSTED`، `IO_ERROR`، `UNAUTHORIZED`، `RATE_LIMITED`.

## شمارش‌ها (Enums)

- اعتماد همتا: `DISCOVERED`، `PAIRING`، `TRUSTED`، `REVOKED`
- وضعیت انتقال: `QUEUED`، `PREPARING`، `TRANSFERRING`، `VERIFYING`،
  `PAUSED`، `COMPLETED`، `FAILED`، `CANCELLED`
- جهت انتقال: `PUSH` (ما می‌فرستیم)، `PULL` (ما می‌گیریم)
- وضعیت همگام‌سازی فایل: `SYNCED`، `PENDING`، `SYNCING`، `CONFLICT`،
  `LOCAL_ONLY`
- وضعیت اقدام برنامهٔ sync: `UNCHANGED`، `LOCAL_ONLY`، `REMOTE_ONLY`،
  `LOCAL_MODIFIED`، `REMOTE_MODIFIED`، `CONFLICT`، `DELETE_LOCAL`،
  `DELETE_REMOTE`
- وضعیت تعارض: `OPEN`، `RESOLVED`
- شدت رویداد: `INFO`، `WARN`، `ERROR`
- نوع رویداد: `PEER_DISCOVERED`، `PAIR_REQUESTED`، `PAIR_APPROVED`،
  `PEER_REVOKED`، `PEER_ONLINE`، `PEER_OFFLINE`، `SYNC_STARTED`،
  `SYNC_COMPLETED`، `SYNC_FAILED`، `TRANSFER_STARTED`،
  `TRANSFER_PROGRESS`، `TRANSFER_COMPLETED`، `TRANSFER_FAILED`،
  `TRANSFER_PAUSED`، `TRANSFER_RESUMED`، `TRANSFER_CANCELLED`،
  `CONFLICT_DETECTED`، `CONFLICT_RESOLVED`، `FILE_INDEXED`،
  `FILE_CHANGED`، `FILE_DELETED`، `FOLDER_ADDED`، `FOLDER_REMOVED`،
  `SETTINGS_UPDATED`، `NATIVE_FALLBACK`

## نقطه‌های پایانی

### سلامت و دستگاه

- `GET /api/v1/health` → `{status, version, uptimeSeconds, dbOk}`
- `GET /api/v1/device` → هویت دستگاه (`peerId`، `name`، `version`،
  `platform`، `startedAt`، `apiPort`، `peerPort`، `keyFingerprint`،
  `nativeEngine`) به‌همراه `stats` (پوشه‌ها، فایل‌های نمایه‌شده، بایت‌ها،
  همتاهای مورد اعتماد/آنلاین، انتقال‌های فعال/کامل، تعارض‌های باز،
  آخرین sync).

### همتاها

- `GET /api/v1/peers` → فهرست همتاها با `trust`، `online`، `address`،
  `lastSeen`، `addedAt`، `sharedFolders`.
- `POST /api/v1/peers/pair` — بدنهٔ `{"address":"127.0.0.1:4041"}` —
  درخواست جفت‌سازی؛ سمت مقابل آن را `PAIRING` می‌بیند و باید تأییدش
  کند. خطاها: `PEER_OFFLINE`، `VALIDATION`.
- `POST /api/v1/peers/{peerId}/approve` — تأیید؛ اگر طرف مقابل هم ما را
  تأیید کرده باشد، دو طرف فوراً `TRUSTED` می‌شوند.
- `POST /api/v1/peers/{peerId}/revoke` — انتقال به `REVOKED`؛ اتصال‌ها
  بسته و تلاش جفت‌سازی بعدی رد می‌شود.
- `DELETE /api/v1/peers/{peerId}` — حذف کامل رکورد. پاسخ: `204`.
- `POST /api/v1/discovery/scan` — یک جاروی بیکِن؛ تازه‌ها `DISCOVERED`
  می‌شوند (هرگز خودکار مورد اعتماد نمی‌شوند) و رویداد `PEER_DISCOVERED`
  می‌گیرند.

### پوشه‌های اشتراکی

- `GET /api/v1/shared-folders` → فهرست پوشه‌ها با `id`، `name`، `path`،
  `fileCount`، `totalBytes`، `lastScanAt`.
- `POST /api/v1/shared-folders` — بدنهٔ `{"name":"Documents",
  "path":"/abs/dir"}`؛ مسیر باید دایرکتوری مطلقِ موجود باشد. همگام‌سازی
  بین دو همتا وقتی شروع می‌شود که هر دو پوشه‌ای با همان نام داشته باشند.
- `DELETE /api/v1/shared-folders/{id}` — توقف ردیابی؛ فایل‌ها روی دیسک
  می‌مانند. پاسخ: `204`.
- `POST /api/v1/shared-folders/{id}/rescan` — پیمایش کامل، هش استریمینگ،
  به‌روزرسانی نمایه و tombstone. خروجی:
  `{folder, scanned, changed, removed, durationMs}`.

### فایل‌ها

- `GET /api/v1/files?folder={id}&path={relDir}` — فهرست یک سطح از یک
  پوشه (ترکیب دیسک و نمایه)؛ دایرکتوری‌ها اول، مرتب‌سازی نام حساس به
  بزرگی/کوچکی نیست. هر فایل: `size`، `mtime`، `hash`، `syncState`،
  `lastSyncedHash`، `remotePeers` (همتاهایی که نسخهٔ به‌رو دارند).
- `GET /api/v1/files/detail?folder={id}&path={relFile}` — جزئیات کامل
  شامل نگاشت قطعه‌ها (`chunkSize`، آرایهٔ `chunks` با `state`) و
  `peers` (نسخهٔ هر همتا).
- `GET /api/v1/files/content?folder={id}&path={relFile}` — استریم محتوا
  (`application/octet-stream` + `Content-Disposition: attachment`).
- `POST /api/v1/files` — ساخت/جایگزینی فایل و نمایه‌اش:
  - JSON: `{folder, path, content, encoding:"utf8"}`
  - multipart: فیلدهای `folder` و `path` + یک پارت `file` (باینری)
- `DELETE /api/v1/files?folder={id}&path={relFile}` — انتقال به سطل
  زبالهٔ ایجنت (`.meshsync/trash`)، tombstone و رویداد `FILE_DELETED`.
  پاسخ: `204`.

### همگام‌سازی

- `GET /api/v1/sync/plan?peer={peerId}&folder={id}` — اتصال به همتا،
  ردوبدل مانیفست و دسته‌بندی همهٔ مسیرها **بدون لمس هیچ فایلی**. خروجی
  شامل `summary` (total/pull/push/deleteLocal/deleteRemote/conflicts/
  unchanged) و آرایهٔ `actions` (هر کدام `relPath`، `state`، `direction`،
  `size`، `localHash`، `remoteHash`، `lastSyncedHash`).
- `POST /api/v1/sync/run` — بدنهٔ `{"peer":"…","folder":1}` — اجرای
  برنامه؛ پیشرفت از رویدادها/WS. پاسخ: `{sessionId, plan}`. خطاها:
  `PEER_OFFLINE`، `NOT_TRUSTED`، `FOLDER_NOT_FOUND` (و `PEER_NOT_FOUND`).
- `GET /api/v1/sync/sessions` — تاریخچهٔ نشست‌ها با وضعیت، بایت‌های
  منتقل‌شده، تعداد فایل و خطا.

### انتقال‌ها

- `GET /api/v1/transfers?limit=50&status=TRANSFERRING` — صف زنده با
  `progressPct`، `speedBps`، `etaSeconds`، `chunksTotal`، `chunksDone`.
  همه از وضعیت واقعی می‌آیند.
- `GET /api/v1/transfers/{id}` — همان شکل + آرایهٔ `chunks` (state هر
  قطعه).
- `POST /api/v1/transfers/{id}/pause | /resume | /cancel | /retry` —
  `pause` وضعیت را ذخیره می‌کند (از ری‌استارت هم جان سالم به در می‌برد)،
  `resume` از اولین قطعهٔ pending ادامه می‌دهد، `cancel` → `CANCELLED`،
  `retry` یک `FAILED` را دوباره صف می‌کند.

### تعارض‌ها

- `GET /api/v1/conflicts` — فهرست تعارض‌ها با هش/اندازه/mtime هر دو
  نسخه، همتای ریموت، `status` و `resolution`.
- `POST /api/v1/conflicts/{id}/resolve` — بدنهٔ
  `{"action":"KEEP_LOCAL"|"KEEP_REMOTE"|"KEEP_BOTH"|"LATER"}`.
  - `KEEP_LOCAL`: نسخهٔ محلی به همتا push می‌شود (نسخهٔ فعلی همتا اول
    به trash خودش می‌رود).
  - `KEEP_REMOTE`: نسخهٔ ریموت روی نسخهٔ محلی pull می‌شود (نسخهٔ محلی
    اول به trash محلی می‌رود).
  - `KEEP_BOTH`: نسخهٔ ریموت با نام
    `report (conflict from mesh-beta 2026-10-08).pdf` کنار فایل ذخیره و
    نسخهٔ محلی روی مسیر اصلی برنده می‌شود.
  - `LATER`: تعارض باز می‌ماند، هیچ داده‌ای لمس نمی‌شود.
  پاسخ: `{conflict}` با `RESOLVED`؛ خطا → `PEER_OFFLINE` و تعارض `OPEN`
  می‌ماند.

### رویدادها و WebSocket

- `GET /api/v1/events?sinceEventId=0&limit=100` — رویدادها صعودی بر اساس
  شناسه (جدیدترین آخر). هر رویداد: `id`، `type`، `severity`، `message`،
  `data`، `ts`.
- `GET /api/v1/events/ws` — استریم رویداد WebSocket (از گیت‌وی:
  `ws(s)://<host>/api/v1/events/ws?XTransformPort=3040`).

فریم‌های سرور → کلاینت (یک شیء JSON در هر فریم):

```json
{ "kind": "hello",   "device": {…}, "ts": "…" }
{ "kind": "event",   "event":  {…} }
{ "kind": "transfer","transfer": {…} }
{ "kind": "peers",   "peers": [ … ] }
{ "kind": "device",  "device": {…} }
{ "kind": "pong" }
```

کلاینت → سرور: `{"kind":"ping"}`. فریم‌های `transfer` روی پیشرفت
(throttle حدود ۸ فریم بر ثانیه به‌ازای هر انتقال) و هر تغییر وضعیت
ارسال می‌شوند؛ `peers` با هر تغییر trust/online و `device` با تغییر
آمار. قطع‌شدن طبیعی است؛ کلاینت با backoff وصل می‌شود و وضعیت را از
REST می‌گیرد — وضعیت کهنهٔ WS هرگز مرجع نیست.

### تنظیمات

- `GET /api/v1/settings` / `PUT /api/v1/settings`

```json
{
  "deviceName": "mesh-alpha",
  "bandwidthLimitBps": 0,
  "concurrentTransfers": 2,
  "chunkSizeBytes": 1048576,
  "discoveryEnabled": true,
  "skipHiddenFiles": false,
  "autoSyncSeconds": 0
}
```

`bandwidthLimitBps` صفر یعنی نامحدود؛ بازهٔ `chunkSizeBytes` بین ۶۴ KiB
و ۱۶ MiB؛ `autoSyncSeconds` صفر یعنی فقط دستی. PUT بعد از اعتبارسنجی،
تنظیمات ذخیره‌شده را برمی‌گرداند و مقادیر در ری‌استارت‌ها باقی می‌مانند.

## نکات امنیتی

- API به‌صورت پیش‌فرض روی `127.0.0.1` بایند می‌شود (`--api-bind` /
  `MESHSYNC_API_BIND` برای تغییر).
- اگر توکن تنظیم شده باشد (`--api-token` / `MESHSYNC_API_TOKEN`)، هر
  درخواست باید `Authorization: Bearer <token>` داشته باشد.
- اتصال همتاها TLS 1.3 با کلیدهای گواهیِ pinشده به هویت Ed25519 هر
  دستگاه است؛ اعتماد فقط با تأیید صریح جفت‌سازی ساخته می‌شود. جزئیات
  در [SECURITY_FA.md](SECURITY_FA.md).
- همهٔ مسیرهای ریموت قبل از هر نوشتنِ فایل‌سیستمی اعتبارسنجی می‌شوند
  (بدون مسیر مطلق، بدون `..`، بدون فرار symlink).
