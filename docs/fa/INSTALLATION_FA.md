# نصب و راه‌اندازی

پیش‌نیازها بسته به کامپوننت متفاوت‌اند و هر کامپوننت مستقل ساخته می‌شود:

- **ایجنت Go**: Go 1.25 یا جدیدتر (مطابق `agent/go.mod`). بدون cgo؛
  SQLite از `modernc.org/sqlite` است، پس کامپایل متقاطع هم راحت انجام
  می‌شود.
- **موتور هش بومی**: g++ با پشتیبانی C++20 (در `native/cpp`).
- **کنسول وب**: Bun (یا Node) نسخهٔ ۱۸ به بالا.
- **کلاینت Flutter**: Flutter SDK سری ۳.

## ساخت ایجنت

```sh
cd agent
go build -o meshsync-agent ./cmd/meshsync-agent
```

خروجی، یک باینری تکی است. اجرای آن بدون هیچ پرچمی، ایجنت را با تنظیمات
پیش‌فرض بالا می‌آورد:

```sh
./meshsync-agent
# meshsync-agent 0.1.0 listening on http://127.0.0.1:3040 (peer 4040, id …)
```

## ساخت موتور هش C++ (اختیاری)

```sh
cd native/cpp
make            # ساخت meshsync-native
make test       # تست‌های موتور هش
```

موتور بومی برای فایل‌های بزرگ (≥ ۱ MiB) سرعت هش‌کردن را بالا می‌برد و
به‌صورت یک پروسهٔ جدایی کار می‌کند که با ایجنت روی stdin/stdout به زبان
JSON-lines حرف می‌زند. بدون آن هم همه‌چیز کار می‌کند: ایجنت به هش‌کردن
Go برمی‌گردد و فقط یک رویداد `NATIVE_FALLBACK` ثبت می‌کند. برای فعال‌سازی:

```sh
./meshsync-agent --native-path ./native/cpp/meshsync-native
```

## پرچم‌های خط فرمان

جدول دقیقاً از `agent/cmd/meshsync-agent/main.go` آمده است. اولویت
اعمال: **پرچم > متغیر محیطی > `config.json` > پیش‌فرض**.

| پرچم | پیش‌فرض | توضیح |
|---|---|---|
| `--data-dir` | `~/.meshsync` | دایرکتوری وضعیت (کلید هویت، دیتابیس، سطل زباله، partها) |
| `--api-port` | `3040` | پورت HTTP محلی (۰ یعنی از config بخوان) |
| `--peer-port` | `4040` | پورت TCP برای اتصال همتاها |
| `--api-bind` | `127.0.0.1` | آدرس bind برای API |
| `--name` | hostname | نامی که به همتاها اعلام می‌شود |
| `--api-token` | خالی | الزام هدر `Authorization: Bearer <token>` روی API |
| `--native-path` | خالی | مسیر باینری موتور هش C++ |
| `--version` | — | چاپ نسخه و خروج |

متغیرهای محیطی معادل: `MESHSYNC_DATA_DIR`، `MESHSYNC_NAME`،
`MESHSYNC_API_BIND`، `MESHSYNC_API_PORT`، `MESHSYNC_PEER_PORT`،
`MESHSYNC_API_TOKEN`، `MESHSYNC_NATIVE_PATH`.

## ساختار دایرکتوری وضعیت

```
~/.meshsync/
├── identity.key     # کلید خصوصی Ed25519 (0600)
├── peer-cert.pem    # گواهی self-signed همتا (کلیدش همان کلید هویت)
├── peer-key.pem
├── meshsync.db      # SQLite — همهٔ وضعیت
├── config.json      # تنظیمات (0600، قابل ویرایش دستی)
├── trash/           # نسخه‌های حذف‌شده به تفکیک پوشه
└── parts/           # فایل‌های ناقص انتقال (خارج از پوشه‌های اشتراکی)
```

برای اجرای چند ایجنت روی یک ماشین، به هر کدام یک `--data-dir` جدا
بدهید؛ لیسنر کشف مالتی‌کست با `SO_REUSEADDR` باز می‌شود، پس چند ایجنت
روی یک هاست بدون تداخل کار می‌کنند.

## تنظیمات زمان اجرا

از `PUT /api/v1/settings` قابل تغییرند و در `config.json` ذخیره می‌شوند:

| کلید | دامنه | پیش‌فرض |
|---|---|---|
| `deviceName` | حداکثر ۶۴ نویسه | hostname |
| `bandwidthLimitBps` | ۰ به بالا (۰ = نامحدود) | ۰ |
| `concurrentTransfers` | ۱ تا ۸ | ۲ |
| `chunkSizeBytes` | ۶۴ KiB تا ۱۶ MiB | ۱ MiB |
| `discoveryEnabled` | true/false | true |
| `skipHiddenFiles` | true/false | false |
| `autoSyncSeconds` | ۰ یا ≥ ۱۰ (۰ = فقط دستی) | ۰ |

تغییر تنظیمات بدون ری‌استارت اعمال می‌شود (مثلاً سقف پهنای باند و
تعداد انتقال موازی بلافاصله اثر می‌کند).

## کنسول وب و کلاینت Flutter

```sh
# کنسول وب
bun install
bun run dev        # http://localhost:3000

# کلاینت Flutter
cd flutter
flutter pub get
flutter run
```

## اجرای دمو دو دستگاهی روی یک ماشین

```sh
./meshsync-agent --name mesh-alpha --api-port 3040 --peer-port 4040 \
  --data-dir ~/.meshsync-a

./meshsync-agent --name mesh-beta --api-port 3041 --peer-port 4041 \
  --data-dir ~/.meshsync-b
```

از اینجا به بعد، مراحل جفت‌سازی و همگام‌سازی در
[USER_GUIDE_FA.md](USER_GUIDE_FA.md) و
[QUICKSTART.md](../QUICKSTART.md) آمده است.

نکتهٔ گیت‌وی: در محیط سندباکس، هر درخواست به‌جای پورت مستقیم، با پارامتر
کوئری به گیت‌وی (پورت ۸۱) می‌رود:

```sh
curl -s "http://<host>:81/api/v1/peers?XTransformPort=3040"
```
