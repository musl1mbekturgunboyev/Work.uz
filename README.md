# Work.uz — real backend bilan

Bu endi to'liq ishlaydigan tizim: **Node.js/Express server + SQLite ma'lumotlar bazasi**.
- Hisoblar haqiqiy (parollar `bcrypt` bilan shifrlangan)
- Kirish sessiyalari `JWT` token orqali
- Vakansiyalar, arizalar va statistika bazada saqlanadi — sahifa yopilsa ham yo'qolmaydi
- Faqat e'lon egasi o'z vakansiyasini yopishi/o'chirishi mumkin (server tomonda tekshiriladi)

## 1. Kompyuteringizda sinab ko'rish

```bash
npm install
npm start
```

Keyin brauzerda **http://localhost:3000** ni oching. Tayyor — ro'yxatdan o'tishingiz, vakansiya joylashingiz, ariza yuborishingiz mumkin.

## 2. Internetga chiqarish (bepul, ma'lumotlar yo'qolmaydigan variant)

Men saytni siz uchun to'g'ridan-to'g'ri joylay olmayman (domen/hosting hisoblarimga kirish imkoniyatim yo'q), lekin bu loyiha istalgan Node.js hostingiga **darhol** joylashga tayyor.

### 2.1. Avval: Turso'da bepul, doimiy ma'lumotlar bazasi yarating

Bu loyiha endi [Turso](https://turso.tech) — SQLite bilan mos, bulutli, **butunlay bepul** (kichik/o'rta loyiha uchun) ma'lumotlar bazasini qo'llab-quvvatlaydi. Bu — Render/Railway'ning bepul tarifida server "uxlab", ma'lumotlar o'chib ketish muammosini butunlay hal qiladi, chunki ma'lumotlar endi hosting'ning o'zida emas, alohida, doimiy Turso serverida saqlanadi.

1. [turso.tech](https://turso.tech) da bepul ro'yxatdan o'ting
2. Terminalda: `curl -sSfL https://get.tur.so/install.sh | bash` (Turso CLI o'rnatish)
3. `turso auth login`
4. `turso db create work-uz` (baza yaratish)
5. `turso db show work-uz --url` — manzilni oling (`TURSO_DATABASE_URL` shu bo'ladi)
6. `turso db tokens create work-uz` — tokenni oling (`TURSO_AUTH_TOKEN` shu bo'ladi)
7. Bu ikkalasini `.env` faylingizga (va keyinroq hosting'ning Environment Variables bo'limiga) qo'shing:
   ```
   TURSO_DATABASE_URL=libsql://work-uz-xxxxx.turso.io
   TURSO_AUTH_TOKEN=eyJhbGci...
   ```

**Agar bularni sozlamasangiz** — sayt baribir ishlayveradi, lekin lokal `data.sqlite` fayli orqali (bepul hostingda vaqti-vaqti bilan tozalanishi mumkin bo'lgan usul). Turso sozlansa, server konsolida `☁️ Turso (bulutli, doimiy) ma'lumotlar bazasiga ulanildi` deb chiqadi — shu xabarni ko'rsangiz, hammasi to'g'ri ishlayapti degani.

### 2.2. Render.com'ga deploy qilish (tavsiya etiladi — eng oson)
1. Ushbu papkani GitHub'ga repo sifatida yuklang
2. [render.com](https://render.com) da ro'yxatdan o'ting → **New +** → **Web Service**
3. GitHub repongizni ulang
4. Build Command: `npm install`, Start Command: `npm start`
5. **Environment** bo'limida quyidagilarni qo'shing: `JWT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (va SMTP/ADMIN_EMAILS — pastga qarang)
6. Deploy tugmasini bosing — bir necha daqiqada `https://sizning-nom.onrender.com` manzili tayyor bo'ladi. Bu safar **Free tarifda ham** ma'lumotlar yo'qolmaydi, chunki ular Turso'da saqlanadi — pullik disk shart emas!

### Railway.app
Xuddi shunday — GitHub repo ulanadi, yuqoridagi environment variable'lar qo'shiladi, avtomatik deploy bo'ladi.

✅ **Rezyume fayllari** ham endi doimiy saqlanadi — 8-bo'limdagi Cloudinary sozlamalarini qo'shsangiz bo'ldi (bepul).

### Domen ulash
Hosting tayyor bo'lgach, `work.uz` yoki boshqa domeningizni shu hosting manziliga (masalan Render bergan URL'ga) CNAME/A yozuvi orqali ulashingiz mumkin — bu domen provayderingiz (masalan Cloudflare) paneli orqali qilinadi.

## 3. Emailga tasdiqlash kodi yuborish

Endi ro'yxatdan o'tishda foydalanuvchiga **6 xonali tasdiqlash kodi** emailga yuboriladi va shu kod kiritilmaguncha hisob faollashmaydi.

**Hech narsa sozlanmagan bo'lsa**, kod haqiqiy emailga yuborilmaydi — server konsoliga chiqadi va sahifada dev-rejim xabari (toast) sifatida ko'rsatiladi. Bu faqat lokal test uchun qulay, lekin production uchun yaramaydi.

### 3.1. Brevo bilan sozlash — TAVSIYA ETILADI (Render/Railway uchun)

⚠️ **Muhim:** Render, Railway kabi ba'zi bepul hostinglarda Gmail SMTP ba'zan **IPv6 tarmoq muammosi** (`ENETUNREACH`) tufayli umuman ishlamaydi — kod hech qachon yetib bormaydi. Bu — mashhur, hujjatlashtirilgan muammo. Shuning uchun bu loyiha [Brevo](https://brevo.com) — oddiy HTTPS so'rovi orqali ishlaydigan (shuning uchun bu muammoga duch kelmaydigan), bepul (kuniga 300 tagacha email) email xizmatini **birlamchi** usul sifatida qo'llab-quvvatlaydi.

1. [brevo.com](https://brevo.com) da bepul ro'yxatdan o'ting
2. **Settings → SMTP & API → API Keys** bo'limiga o'ting, yangi API kalit yarating — bu `BREVO_API_KEY` bo'ladi
3. **Settings → Senders** bo'limida o'z emailingizni (masalan Gmail manzilingizni) "sender" sifatida qo'shing — Brevo shu emailga 6 xonali tasdiqlash kodi yuboradi, uni kiritib tasdiqlang. Domen kerak emas, faqat shu bitta email tasdiqlansa yetarli
4. `.env` faylingizga (va hosting'ning Environment Variables bo'limiga) qo'shing:
   ```
   BREVO_API_KEY=xkeysib-...
   BREVO_SENDER_EMAIL=sizning-tasdiqlangan-email@gmail.com
   ```
5. Serverni qayta ishga tushiring — konsolda `✉️ Brevo sozlangan — tasdiqlash kodlari haqiqiy emailga (HTTP API orqali) yuboriladi` deb chiqsa, tayyor

Brevo sozlansa, u har doim SMTP'dan ustuvor ishlatiladi (ikkalasi ham sozlangan bo'lsa muammo emas).

### 3.2. SMTP (Gmail) bilan sozlash — faqat lokal test uchun tavsiya etiladi

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sizning-email@gmail.com
SMTP_PASS=16-xonali-app-parol
SMTP_FROM=sizning-email@gmail.com
```

1. Google hisobingizda **2 bosqichli tasdiqlash**ni yoqing (agar yoqilmagan bo'lsa)
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) ga kiring
3. Yangi "App password" yarating (nomini "Work.uz" deb qo'yishingiz mumkin)
4. Google bergan 16 xonali parolni `SMTP_PASS` sifatida ishlating (oddiy Gmail parolingiz emas!)

### Lokalda sinash uchun
1. `.env.example` faylini nusxalab, nomini **`.env`** deb o'zgartiring (bu fayl `.gitignore`da — GitHub'ga hech qachon yuklanmaydi)
2. Ichidagi qiymatlarni (Brevo yoki SMTP, `JWT_SECRET`) o'zingiznikiga almashtiring
3. `npm start` — server avtomatik ravishda `.env` faylini o'qiydi (`dotenv` paketi allaqachon o'rnatilgan)

### Render/Railway'da sozlash
Hosting panelida **Environment Variables** bo'limiga yuqoridagi qiymatlarni qo'shsangiz bo'ldi — kod avtomatik qayta ishga tushadi va shundan keyin haqiqiy emaillar yuboriladi. **Render uchun albatta Brevo'ni ishlating**, Gmail SMTP emas.

## 5. Admin panel

`http://localhost:3000/admin.html` (yoki `https://sizning-domen/admin.html`) manzilida — barcha vakansiya va foydalanuvchilarni ko'rish, o'chirish, yopilgan lavozimni qayta ochish mumkin.

Kirish uchun avval `.env` faylingizga qaysi email(lar) admin bo'lishini yozing:
```
ADMIN_EMAILS=sizning-email@gmail.com
```
(bir nechta admin kerak bo'lsa vergul bilan ajrating: `ADMIN_EMAILS=email1@gmail.com,email2@gmail.com`)

Shu emailga oddiy foydalanuvchi sifatida ro'yxatdan o'ting (email tasdiqlash bilan), so'ng `/admin.html`ga o'sha email/parol bilan kiring — tizim sizni avtomatik admin deb taniydi.

## 6. Parolni unutish

Login oynasida "Parolni unutdingizmi?" havolasi orqali foydalanuvchi emailiga kod yuboriladi, kodni kiritib yangi parol o'rnatiladi. Bu ham yuqoridagi SMTP sozlamalaridan foydalanadi.

## 7. Arizachilar va xabarnoma

Kimdir bir vakansiyaga "Ariza yuborish" tugmasini bossa:
- Vakansiya egasining **emailiga avtomatik xabar** boradi (nomzodning ismi va emaili bilan)
- Egasi o'z vakansiyasi ostidagi **"👥 X ta ariza"** tugmasini bosib, barcha arizachilarning ismi, emaili va (agar biriktirilgan bo'lsa) **rezyumesini** ko'radi
- Har bir arizachi yonida **"✓ Ishga oldim"** tugmasi bor — bosilsa, lavozim yopiladi va aynan o'sha nomzodga **"tabriklaymiz"** emaili avtomatik boradi

## 8. Rezyume (CV) yuklash — doimiy bulutli saqlash (Cloudinary)

Nomzodlar ariza yuborishda ixtiyoriy ravishda PDF yoki Word (.doc/.docx, 5MB gacha) fayl biriktirishi mumkin.

Bu loyiha [Cloudinary](https://cloudinary.com) — bepul (25GB gacha) bulutli fayl saqlash xizmatini qo'llab-quvvatlaydi. Sozlansa, rezyumelar **doimiy** saqlanadi (hosting qayta ishga tushsa ham yo'qolmaydi). Sozlanmasa, fayllar serverning lokal `uploads/` papkasida saqlanadi (bepul hostingda vaqti-vaqti bilan tozalanishi mumkin).

### Cloudinary sozlash (bepul, 2 daqiqa)
1. [cloudinary.com](https://cloudinary.com) da bepul ro'yxatdan o'ting
2. Dashboard'ning tepasida **Cloud name**, **API Key**, **API Secret** ko'rinadi — shularni nusxalab oling
3. `.env` faylingizga qo'shing:
   ```
   CLOUDINARY_CLOUD_NAME=sizning-cloud-nomi
   CLOUDINARY_API_KEY=sizning-api-key
   CLOUDINARY_API_SECRET=sizning-api-secret
   ```
4. Serverni qayta ishga tushiring — konsolda `☁️ Cloudinary sozlangan — rezyumelar bulutda doimiy saqlanadi` deb chiqsa, tayyor

Internetga chiqarganda ham shu uchta qiymatni hosting'ning Environment Variables bo'limiga qo'shishni unutmang.

## 9. Har bir vakansiya uchun alohida sahifa

Har bir e'lon `/vakansiya/ID` manzilida (masalan `work.uz/vakansiya/12`) ochiladi — ijtimoiy tarmoqqa ulashish yoki to'g'ridan-to'g'ri havola yuborish uchun qulay. Vakansiyalar ro'yxatidagi "Batafsil →" havolasi orqali ham shu sahifaga o'tiladi.

## 10. Kengaytirilgan qidiruv

Vakansiyalar bo'limida endi kalit so'z (lavozim/kompaniya), shahar va ish turi bo'yicha filtrlash mumkin — bosh sahifadagi qidiruv paneli ham shu filtrlarga ulangan.

## 11. Spamdan himoya (rate limiting)

- Ro'yxatdan o'tish/kirish/parolni tiklash: har bir IP uchun 15 daqiqada 20 tagacha urinish
- Vakansiya joylash: har bir foydalanuvchi uchun soatiga 30 tagacha

Undan ortiq urinishda `429 Too Many Requests` xatoligi qaytariladi.

## 12. Qo'shimcha sahifalar

Footer'dagi barcha havolalar endi ishlaydi:
- `/haqida.html` — Biz haqimizda (real vaqtdagi statistika bilan)
- `/aloqa.html` — Aloqa formasi (ADMIN_EMAILS'ga xabar yuboradi)
- `/blog.html` — Ish qidirish bo'yicha maqolalar
- `/karyera.html` — Work.uz jamoasida ishlash
- `/narxlar.html` — Narxlar (hozircha hammasi bepul)
- `/yordam.html` — Ko'p so'raladigan savollar
- `/rezyume-yaratish.html` — Interaktiv rezyume quruvchi (PDF sifatida yuklab olish, brauzerda avtomatik saqlash)

## 13. Xavfsizlik holati

**Himoyalangan narsalar:**
- Parollar `bcrypt` bilan shifrlanadi (hech qachon ochiq matnda saqlanmaydi yoki API orqali qaytarilmaydi)
- Barcha ma'lumotlar bazasi so'rovlari parametrlashtirilgan — SQL Injection xavfi yo'q
- Har bir amal (o'chirish, yopish, arizachilarni ko'rish) server tomonida egalik huquqi tekshiriladi
- Standart xavfsizlik sarlavhalari (`helmet`) va CORS faqat o'z domeningizga cheklangan
- Ro'yxatdan o'tish/kirish/vakansiya joylashda spam-himoya (rate limiting)
- **Kirish tokenlari bekor qilinishi mumkin** — parol tiklanganda avvalgi barcha tokenlar avtomatik bekor bo'ladi; `/api/auth/logout-all` orqali istalgan payt barcha qurilmalardan chiqib yuborish mumkin
- **Rezyume fayllariga faqat ruxsati borlar kiradi** — havolani bilish yetarli emas, faqat arizani yuborgan nomzodning o'zi yoki tegishli vakansiya egasi yuklab olishi mumkin (server tomonda tekshiriladi, men buni to'liq test qildim)
- **Fayl haqiqiyligi chuqur tekshiriladi** — PDF/DOCX/DOC fayllarning ichki "imzosi" (magic bytes) tekshiriladi, shunchaki nom yoki brauzer aytgan turga ishonilmaydi. Soxta fayl darhol rad etiladi

**Productionga chiqarishdan oldin albatta qiling:**
1. `JWT_SECRET`ni uzun, tasodifiy qiymatga almashtiring (standart holatda oddiy matn turibdi)
2. Agar frontend alohida domenda joylashsa, `ALLOWED_ORIGINS` environment variable qo'shing (masalan `ALLOWED_ORIGINS=https://work.uz`) — aks holda API faqat shu serverning o'zidan ishlaydi

Hozircha ma'lum, hal qilinmagan jiddiy zaiflik yo'q. Xavfsizlik — doimiy jarayon: kelajakda yangi funksiya qo'shilganda ham shu andozada (egalik tekshiruvi, parametrlashtirilgan so'rovlar, fayl tekshiruvi) davom ettirish tavsiya etiladi.

## Loyiha tuzilishi

```
work-uz-backend/
  server.js          — Express API server (auth, vakansiyalar, statistika, admin)
  public/
    index.html       — Asosiy sayt (Work.uz)
    vakansiya.html    — Har bir vakansiya uchun alohida sahifa (/vakansiya/:id)
    admin.html        — Admin panel (/admin.html)
  uploads/            — Yuklangan rezyumelar (avtomatik yaratiladi, gitignore'da)
  package.json
```

## API endpointlari (qisqacha)

| Metod | Yo'l | Tavsif |
|---|---|---|
| POST | /api/auth/register | Ro'yxatdan o'tish |
| POST | /api/auth/login | Kirish |
| POST | /api/auth/forgot-password | Parolni tiklash kodi so'rash |
| POST | /api/auth/reset-password | Yangi parol o'rnatish (avvalgi tokenlarni ham bekor qiladi) |
| POST | /api/auth/logout-all | Barcha qurilmalardagi sessiyalarni bekor qilish |
| GET | /api/vacancies | Ochiq vakansiyalar ro'yxati (?cat= bilan filtrlash mumkin) |
| GET | /api/vacancies/:id | Bitta vakansiyaning to'liq ma'lumoti |
| POST | /api/vacancies | Yangi vakansiya (kirish talab qilinadi) |
| PATCH | /api/vacancies/:id/fill | Lavozimni yopish, ixtiyoriy `hiredUserId` bilan nomzodga xabar yuborish (faqat egasi) |
| DELETE | /api/vacancies/:id | O'chirish (faqat egasi) |
| POST | /api/vacancies/:id/apply | Arizaga yozilish (ixtiyoriy `resume` fayli bilan, haqiqiyligi tekshiriladi) |
| GET | /api/vacancies/:id/applicants | Arizachilar ro'yxati (faqat egasi) |
| GET | /api/applications/:id/resume | Rezyumeni yuklab olish (faqat nomzod yoki egasi) |
| GET | /api/stats | Real vaqtdagi statistika |
| GET | /api/admin/* | Admin endpointlari (faqat ADMIN_EMAILS) |
