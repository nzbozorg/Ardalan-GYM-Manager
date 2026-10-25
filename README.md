# Ardalan GYM Manager 🏋️

> سیستم مدیریت حرفه‌ای باشگاه‌های ورزشی — سبک، سریع و کاملاً آفلاین

<div align="center">

![Version](https://img.shields.io/badge/version-1.3.0-blue?style=for-the-badge)
![Node](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Offline](https://img.shields.io/badge/offline-ready-orange?style=for-the-badge)

**ساخته شده با ❤️ توسط [Amir NoZohour](https://github.com/nzbozorg) برای باشگاه اردلان**

[☕ حمایت مالی](https://coffeebede.com/Amir_NoZohour) • [🐛 گزارش باگ](https://github.com/nzbozorg/Ardalan-GYM-Manager/issues) • [💡 پیشنهاد ویژگی](https://github.com/nzbozorg/Ardalan-GYM-Manager/discussions)

</div>

---

## ✨ معرفی

**Ardalan GYM Manager** یک سیستم کامل مدیریت باشگاه ورزشی است که بدون نیاز به اینترنت، روی لپ‌تاپ مربی اجرا می‌شود. از ثبت‌نام اعضا تا حسابداری، بوفه، حضور و غیاب و گزارش مالی — همه در یک برنامه سبک و فارسی.

> **چرا آفلاین؟** چون باشگاه‌ها اینترنت پایدار ندارند. این برنامه با `SQLite` روی خود سیستم کار می‌کند، حتی اگر برق برود اطلاعات نمی‌پرد.

---

## 🎯 ویژگی‌ها

| بخش | توضیح |
| :--- | :--- |
| **👥 مدیریت اعضا** | ثبت‌نام با نام، شماره، جنسیت، قد/وزن • جستجوی لحظه‌ای • فیلتر آقا/خانم • سورت هوشمند |
| **🏋️ جلسات و شهریه** | پکیج‌های 1، 12، 16، 20، 26 جلسه • تک‌جلسه = 1 روز، بقیه = 30 روز (ماهانه) • جلسات باقی‌مانده خودکار بعد از 30 روز صفر می‌شود |
| **📅 شهریه ماهانه** | هر عضو تاریخ انقضای شهریه دارد • نمایش روزهای باقی‌مانده (سبز/زرد/قرمز) • تمدید خودکار بعد از هر پرداخت |
| **✅ حضور و غیاب** | دکمه حضور سریع در لیست داشبورد (کنار اسم) • خاکستری تا فردا حتی بعد از رفرش • جلوگیری از ثبت تکراری همان روز |
| **💰 مالی و بدهی** | سیستم بدهی `pending/paid` • تایید پرداخت • بوفه (آب کوچک/بزرگ + آیتم سفارشی) • هوازی و برنامه تمرینی |
| **📊 گزارش ماهانه** | جمع بوفه/باشگاه/کل • لیست اعضا و تراکنش‌های ماه • قابل سورت و پرینت |
| **🧹 پاکسازی خودکار** | اعضای غیرفعال بعد از 60 روز خودکار حذف می‌شوند (هر 24 ساعت) • پیش‌نمایش و حذف دستی از تنظیمات |
| **💾 پشتیبان‌گیری** | دانلود `database.sqlite` با یک کلیک • ذخیره خودکار در پوشه `backups` • بازگردانی آسان |
| **🔄 آپدیت خودکار** | بررسی نسخه جدید از گیت‌هاب از داخل تنظیمات • لینک مستقیم به ریلیزها |
| **🎨 فارسی و زیبا** | فونت وزیرمتن • RTL کامل • ریسپانسیو موبایل • تم روشن |

---

## 📸 پیش‌نمایش

> عکس واقعی باشگاه با فیلتر کارتونی به عنوان پس‌زمینه لاگین

| داشبورد | پروفایل عضو | نرخ‌ها |
| :---: | :---: | :---: |
| لیست اعضا + حضور سریع | جلسات، شهریه، تاریخچه تراکنش | مدیریت قیمت پکیج‌ها و بوفه |

---

## 🚀 نصب و اجرا

### پیش‌نیاز
- **Node.js 18+** (دانلود از [nodejs.org](https://nodejs.org))
- ویندوز / لینوکس / مک

### روش ۱ — اجرای سریع (توسعه)
```bash
git clone https://github.com/nzbozorg/Ardalan-GYM-Manager.git
cd Ardalan-GYM-Manager
npm install
npm start
# یا
node server.js
```
بعد برو به: `http://localhost:3000` — رمز پیش‌فرض: `12345`

### روش ۲ — اجرای آفلاین روی لپ‌تاپ باشگاه
1. همین مخزن رو دانلود کن (Code → Download ZIP)
2. روی سیستم مربی از حالت فشرده خارج کن
3. `start.bat` (ویندوز) یا `start.sh` (لینوکس/مک) رو دبل‌کلیک کن
4. مرورگر خودکار باز میشه

> **exe هم می‌خوای؟**
> ```bash
> npm install -g pkg
> pkg server.js --targets node18-win-x64 --output Ardalan-GYM-Manager.exe
> ```
> بعد `database.sqlite` و `pic.jpg` رو کنار `exe` بذار.

---

## 📂 ساختار پروژه

```
Ardalan-GYM-Manager/
├── server.js          # بک‌اند Express + SQLite (better-sqlite3)
├── index.html         # فرانت اصلی (فارسی)
├── script.js          # منطق کلاینت (1738+ خط)
├── style.css          # استایل مدرن (Vazirmatn)
├── pic.jpg            # عکس باشگاه (پس‌زمینه لاگین)
├── database.sqlite    # دیتابیس (auto-created)
├── backups/           # بک‌آپ‌های خودکار
├── start.bat / start.sh
└── package.json
```

### دیتابیس
- **members**: `id, name, phone, gender, height, weight, sessions, debt, expire_at, last_checkin, createdAt`
- **transactions**: `id, member_id, type, amount, count, itemName, date, status`
- **rates**: قیمت پکیج‌ها و بوفه
- **settings**: رمز هش‌شده `bcrypt`

---

## ⚙️ تنظیمات مهم

| تنظیم | کجا | توضیح |
| :--- | :--- | :--- |
| تغییر رمز | تنظیمات → تغییر رمز عبور | هش `bcrypt(12)` |
| نرخ‌ها | نرخ‌ها → یک دکمه "ذخیره همه" | از منفی جلوگیری می‌شود |
| بک‌آپ | تنظیمات → دانلود فایل پشتیبان | `backup-ardalan-YYYY-MM-DD.sqlite` |
| پاکسازی | تنظیمات → پاکسازی خودکار | پیش‌نمایش → حذف |
| آپدیت | تنظیمات → بررسی آپدیت | اتصال به `api.github.com` |

---

## 🔒 امنیت

- رمز با `bcrypt` (salt 12) هش می‌شود
- `rate-limit` روی لاگین (10 تلاش / 15 دقیقه)
- `SQL Injection` غیرممکن (همه کوئری‌ها `Prepared Statement`)
- `WAL` + `2MB Cache` + ایندکس‌های ترکیبی برای سرعت

> **نکته آفلاین:** چون برنامه فقط روی `localhost` اجرا می‌شود، نیازی به احراز هویت پیچیده نیست. برای آنلاین کردن، `CORS` و `helmet` را فعال کنید.

---

## 🛠️ توسعه

```bash
# اجرای dev
node server.js

# تست API
curl http://localhost:3000/api/members
curl http://localhost:3000/api/stats

# ساخت 500 عضو تستی (در کنسول کروم، وقتی برنامه بازه F12)
# کدش داخل Issues هست
```

### API اصلی
```
POST   /api/login
GET    /api/members
POST   /api/members
PUT    /api/members/:id
DELETE /api/members/:id
POST   /api/transactions
PUT    /api/transactions/:id/confirm
DELETE /api/transactions/:id
GET    /api/stats
GET    /api/reports/monthly
GET    /api/rates
POST   /api/rates/bulk
GET    /api/update/check
POST   /api/members/cleanup/inactive
```

---

## 🤝 مشارکت

اوپن‌سورسه! باگ دیدی یا ایده داری؟

1. **Fork** کن
2. یه **Branch** جدید بساز (`git checkout -b feature/amazing`)
3. کامیت کن (`git commit -m 'Add amazing feature'`)
4. **Push** کن و **Pull Request** بده

یا تو [Discussions](https://github.com/nzbozorg/Ardalan-GYM-Manager/discussions) بگو.

---

## ☕ حمایت مالی

اگر این پروژه به کارت اومد، یه قهوه مهمونم کن:

**[coffeebede.com/Amir_NoZohour](https://coffeebede.com/Amir_NoZohour)**

حمایتت باعث میشه نسخه‌های بعدی (QR حضور، پیامک، نمودار درآمد) زودتر بیاد.

---

## 📜 لایسنس

MIT © [Amir NoZohour](https://github.com/nzbozorg) — آزاد برای استفاده شخصی و تجاری، فقط اسم نویسنده بمونه.

---

## 🙏 تشکر

- فونت زیبای [وزیرمتن](https://github.com/rastikerdar/vazirmatn)
- باشگاه اردلان برای تست واقعی
- همه کسایی که ستاره می‌دن ⭐

<div align="center">

**نسخه فعلی: 1.3.0** | آخرین آپدیت: مهر 1405

⭐ اگه خوشت اومد ستاره بده!

</div>
