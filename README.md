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

## 2. Internetga chiqarish (bepul variantlar)

Men saytni siz uchun to'g'ridan-to'g'ri joylay olmayman (domen/hosting hisoblarimga kirish imkoniyatim yo'q), lekin bu loyiha istalgan Node.js hostingiga **darhol** joylashga tayyor. Eng oson bepul variantlar:

### Render.com (tavsiya etiladi — eng oson)
1. Ushbu papkani GitHub'ga repo sifatida yuklang
2. [render.com](https://render.com) da ro'yxatdan o'ting → **New +** → **Web Service**
3. GitHub repongizni ulang
4. Build Command: `npm install`, Start Command: `npm start`
5. **Environment** bo'limida `JWT_SECRET` deb nomlangan maxfiy kalit qo'shing (istalgan uzun tasodifiy matn)
6. Deploy tugmasini bosing — bir necha daqiqada `https://sizning-nom.onrender.com` manzili tayyor bo'ladi

### Railway.app
Xuddi shunday — GitHub repo ulanadi, `JWT_SECRET` environment variable qo'shiladi, avtomatik deploy bo'ladi.

⚠️ **Muhim eslatma:** Render/Railway bepul tarifida disk vaqti-vaqti bilan tozalanishi mumkin, ya'ni `data.sqlite` fayli (barcha vakansiya va foydalanuvchilar) qayta o'rnatilganda yo'qolishi mumkin. Agar ma'lumotlar doim saqlanib qolishini xohlasangiz:
- Railway yoki Render'da **persistent disk/volume** yoqing, YOKI
- Keyinchalik haqiqiy bulutli baza (masalan Postgres — Supabase, Neon, yoki Railway Postgres) ga o'tkazish kerak bo'ladi. Xohlasangiz, buni ham keyingi bosqichda qilib beraman.

### Domen ulash
Hosting tayyor bo'lgach, `work.uz` yoki boshqa domeningizni shu hosting manziliga (masalan Render bergan URL'ga) CNAME/A yozuvi orqali ulashingiz mumkin — bu domen provayderingiz (masalan Cloudflare) paneli orqali qilinadi.

## 3. Emailga tasdiqlash kodi yuborish (SMTP sozlash)

Endi ro'yxatdan o'tishda foydalanuvchiga **6 xonali tasdiqlash kodi** emailga yuboriladi va shu kod kiritilmaguncha hisob faollashmaydi.

**SMTP sozlanmagan bo'lsa** (`.env` yoki hosting environment variables'da), kod haqiqiy emailga yuborilmaydi — server konsoliga chiqadi va sahifada dev-rejim xabari (toast) sifatida ko'rsatiladi. Bu faqat lokal test uchun qulay, lekin production uchun yaramaydi.

**Haqiqiy emailga yuborish uchun** quyidagi environment variable'larni sozlang:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sizning-email@gmail.com
SMTP_PASS=16-xonali-app-parol
SMTP_FROM=sizning-email@gmail.com
```

### Gmail bilan sozlash (eng oson, bepul)
1. Google hisobingizda **2 bosqichli tasdiqlash**ni yoqing (agar yoqilmagan bo'lsa)
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) ga kiring
3. Yangi "App password" yarating (nomini "Work.uz" deb qo'yishingiz mumkin)
4. Google bergan 16 xonali parolni `SMTP_PASS` sifatida ishlating (oddiy Gmail parolingiz emas!)

### Lokalda sinash uchun
1. `.env.example` faylini nusxalab, nomini **`.env`** deb o'zgartiring (bu fayl `.gitignore`da — GitHub'ga hech qachon yuklanmaydi)
2. Ichidagi `SMTP_USER`, `SMTP_PASS` va `JWT_SECRET` qiymatlarini o'zingiznikiga almashtiring
3. `npm start` — server avtomatik ravishda `.env` faylini o'qiydi (`dotenv` paketi allaqachon o'rnatilgan)

### Render/Railow'da sozlash
Hosting panelida **Environment Variables** bo'limiga yuqoridagi `SMTP_*` qiymatlarni qo'shsangiz bo'ldi — kod avtomatik qayta ishga tushadi va shundan keyin haqiqiy emaillar yuboriladi.

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

## 8. Rezyume (CV) yuklash

Nomzodlar ariza yuborishda ixtiyoriy ravishda PDF yoki Word (.doc/.docx, 5MB gacha) fayl biriktirishi mumkin. Fayllar `uploads/` papkasida saqlanadi — bu papka `.gitignore`da, GitHub'ga yuklanmaydi. Hosting'da fayllar doimiy saqlanishi uchun 2-bo'limdagi "ma'lumotlar bazasi tozalanishi mumkin" eslatmasi shu papkaga ham tegishli.

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

## 13. Muhim xavfsizlik eslatmasi

`server.js` faylida `JWT_SECRET` standart holatda oddiy matn — **productionga chiqarishdan oldin** buni albatta maxfiy, uzun, tasodifiy qiymatga almashtiring (hosting platformangizning "Environment Variables" bo'limida `JWT_SECRET` nomi bilan qo'shing). Aks holda foydalanuvchilarning sessiyalari xavfsiz bo'lmaydi.

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
| POST | /api/auth/reset-password | Yangi parol o'rnatish |
| GET | /api/vacancies | Ochiq vakansiyalar ro'yxati (?cat= bilan filtrlash mumkin) |
| GET | /api/vacancies/:id | Bitta vakansiyaning to'liq ma'lumoti |
| POST | /api/vacancies | Yangi vakansiya (kirish talab qilinadi) |
| PATCH | /api/vacancies/:id/fill | Lavozimni yopish, ixtiyoriy `hiredUserId` bilan nomzodga xabar yuborish (faqat egasi) |
| DELETE | /api/vacancies/:id | O'chirish (faqat egasi) |
| POST | /api/vacancies/:id/apply | Arizaga yozilish (ixtiyoriy `resume` fayli bilan) |
| GET | /api/vacancies/:id/applicants | Arizachilar ro'yxati (faqat egasi) |
| GET | /api/stats | Real vaqtdagi statistika |
| GET | /api/admin/* | Admin endpointlari (faqat ADMIN_EMAILS) |
