require('dotenv').config({ quiet: true });
const dns = require('dns');
// Render kabi ba'zi hostinglarda IPv6 orqali tashqi xizmatlarga (Gmail va h.k.)
// ulanish ENETUNREACH xatosi bilan yiqiladi — shuning uchun IPv4'ni ustuvor qilamiz.
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) { /* eski Node versiyasida mavjud emas */ }
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@libsql/client');

const app = express();
// Render/Railway kabi hostinglar proksi orqasida ishlaydi — bu sozlama
// bo'lmasa express-rate-limit foydalanuvchi IP'sini aniqlay olmay xato beradi.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-CHANGE-ME-in-production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const CODE_TTL_MIN = 15;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (JWT_SECRET === 'dev-secret-CHANGE-ME-in-production') {
  console.warn("⚠️  DIQQAT: JWT_SECRET standart qiymatda qolgan. Productionda albatta o'zgartiring (env var sifatida).");
}

// ----- Ma'lumotlar bazasi (Turso sozlangan bo'lsa bulutda, aks holda lokal fayl) -----
const usingTurso = !!(process.env.TURSO_DATABASE_URL);
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${DB_PATH}`,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});
if (usingTurso) {
  console.log('☁️  Turso (bulutli, doimiy) ma\'lumotlar bazasiga ulanildi.');
} else {
  console.warn("⚠️  DIQQAT: Turso sozlanmagan — lokal fayl (data.sqlite) ishlatilmoqda. Bepul hostingda (Render Free) bu fayl xizmat uxlaganda o'chib ketishi mumkin. README.md dagi 'Ma'lumotlar bazasi doimiyligi' bo'limini ko'ring.");
}

// db.prepare(sql).get/all/run(...) — eski sinxron uslubdagi chaqiruvlarni saqlab qolish uchun yupqa astar (shim)
function normalizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}
const db = {
  exec: async (sql) => { await client.executeMultiple(sql); },
  prepare: (sql) => ({
    get: async (...args) => {
      const res = await client.execute({ sql, args });
      return normalizeRow(res.rows[0]);
    },
    all: async (...args) => {
      const res = await client.execute({ sql, args });
      return res.rows.map(normalizeRow);
    },
    run: async (...args) => {
      const res = await client.execute({ sql, args });
      return { lastInsertRowid: Number(res.lastInsertRowid || 0), changes: Number(res.rowsAffected || 0) };
    },
  }),
};

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verify_code TEXT,
      verify_expires TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vacancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cat TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      city TEXT NOT NULL,
      salary TEXT,
      type TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      owner_id INTEGER,
      is_sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      vacancy_id INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      UNIQUE(user_id, vacancy_id)
    );
  `);

  // Yengil migratsiya: eski bazada yo'q bo'lgan ustunlarni qo'shib qo'yamiz
  const migrations = [
    "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN verify_code TEXT",
    "ALTER TABLE users ADD COLUMN verify_expires TEXT",
    "ALTER TABLE users ADD COLUMN reset_code TEXT",
    "ALTER TABLE users ADD COLUMN reset_expires TEXT",
    "ALTER TABLE applications ADD COLUMN resume_path TEXT",
  ];
  for (const m of migrations) {
    try { await client.execute(m); } catch (e) { /* ustun allaqachon mavjud */ }
  }
}

// ----- Email transport (real SMTP if configured, otherwise dev fallback) -----
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let mailer = null;
if (smtpConfigured) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Render kabi ba'zi hostinglarda Gmail'ga IPv6 orqali ulanish "ENETUNREACH"
    // xatosi bilan yiqiladi — shuning uchun ulanishni IPv4'ga majburlaymiz.
    family: 4,
    connectionTimeout: 15000,
  });
  console.log('✉️  SMTP sozlangan — tasdiqlash kodlari haqiqiy emailga yuboriladi.');
} else {
  console.warn('✉️  DIQQAT: SMTP sozlanmagan — tasdiqlash kodlari HAQIQIY emailga YUBORILMAYDI.');
  console.warn('   Buning o\'rniga kod server konsoliga chiqariladi (faqat lokal test uchun).');
  console.warn('   Haqiqiy emailga yuborish uchun README.md dagi SMTP sozlash bo\'limini ko\'ring.');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 xonali kod
}

function escapeHtmlServer(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendVerificationEmail(to, name, code) {
  const subject = 'Work.uz — tasdiqlash kodi';
  const text = `Salom, ${name}!\n\nWork.uz platformasida ro'yxatdan o'tishni yakunlash uchun quyidagi kodni kiriting:\n\n${code}\n\nKod ${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring.`;
  const html = `<p>Salom, <b>${name}</b>!</p><p>Work.uz platformasida ro'yxatdan o'tishni yakunlash uchun quyidagi kodni kiriting:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>Kod ${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring.</p>`;
  if (mailer) {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
  } else {
    console.log(`\n📧 [DEV MODE — email yuborilmadi] ${to} uchun tasdiqlash kodi: ${code}\n`);
  }
}

async function sendResetEmail(to, name, code) {
  const subject = 'Work.uz — parolni tiklash kodi';
  const text = `Salom, ${name}!\n\nParolingizni tiklash uchun quyidagi kodni kiriting:\n\n${code}\n\nKod ${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring — parolingiz o'zgarmaydi.`;
  const html = `<p>Salom, <b>${name}</b>!</p><p>Parolingizni tiklash uchun quyidagi kodni kiriting:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>Kod ${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring — parolingiz o'zgarmaydi.</p>`;
  if (mailer) {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
  } else {
    console.log(`\n📧 [DEV MODE — email yuborilmadi] ${to} uchun parolni tiklash kodi: ${code}\n`);
  }
}

async function sendApplicationNotification(ownerEmail, ownerName, applicantName, applicantEmail, jobTitle) {
  const subject = `Work.uz — "${jobTitle}" vakansiyasiga yangi ariza`;
  const text = `Salom, ${ownerName}!\n\n"${jobTitle}" lavozimingizga yangi ariza tushdi.\n\nNomzod: ${applicantName}\nEmail: ${applicantEmail}\n\nNomzod bilan bog'lanish uchun shu emailga to'g'ridan-to'g'ri yozishingiz mumkin. Barcha arizachilarni Work.uz saytidagi vakansiyangiz ostida ham ko'rishingiz mumkin.`;
  const html = `<p>Salom, <b>${ownerName}</b>!</p><p><b>${escapeHtmlServer(jobTitle)}</b> lavozimingizga yangi ariza tushdi.</p><p><b>Nomzod:</b> ${escapeHtmlServer(applicantName)}<br><b>Email:</b> ${escapeHtmlServer(applicantEmail)}</p><p>Nomzod bilan bog'lanish uchun shu emailga to'g'ridan-to'g'ri yozishingiz mumkin. Barcha arizachilarni Work.uz saytidagi vakansiyangiz ostida ham ko'rishingiz mumkin.</p>`;
  if (mailer) {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: ownerEmail, subject, text, html });
  } else {
    console.log(`\n📧 [DEV MODE — email yuborilmadi] ${ownerEmail} uchun xabar: ${applicantName} (${applicantEmail}) "${jobTitle}" ga ariza yubordi\n`);
  }
}

async function sendHiredEmail(candidateEmail, candidateName, jobTitle, companyName) {
  const subject = `Work.uz — Tabriklaymiz! "${jobTitle}" lavozimiga qabul qilindingiz`;
  const text = `Salom, ${candidateName}!\n\nTabriklaymiz! Siz "${jobTitle}" (${companyName}) lavozimiga ishga qabul qilindingiz.\n\nKompaniya sizga tez orada bog'lanadi. Muvaffaqiyatlar tilaymiz!`;
  const html = `<p>Salom, <b>${candidateName}</b>!</p><p>🎉 Tabriklaymiz! Siz <b>${escapeHtmlServer(jobTitle)}</b> (${escapeHtmlServer(companyName)}) lavozimiga ishga qabul qilindingiz.</p><p>Kompaniya sizga tez orada bog'lanadi. Muvaffaqiyatlar tilaymiz!</p>`;
  if (mailer) {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: candidateEmail, subject, text, html });
  } else {
    console.log(`\n📧 [DEV MODE — email yuborilmadi] ${candidateEmail} uchun xabar: "${jobTitle}" lavozimiga qabul qilindingiz\n`);
  }
}

async function sendContactEmail(name, fromEmail, message) {
  const to = ADMIN_EMAILS[0] || process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!to) { console.log(`\n📧 [DEV MODE — qabul qiluvchi yo'q] Aloqa xabari: ${name} <${fromEmail}>: ${message}\n`); return; }
  const subject = `Work.uz — Aloqa formasidan yangi xabar (${name})`;
  const text = `Ism: ${name}\nEmail: ${fromEmail}\n\nXabar:\n${message}`;
  const html = `<p><b>Ism:</b> ${escapeHtmlServer(name)}<br><b>Email:</b> ${escapeHtmlServer(fromEmail)}</p><p><b>Xabar:</b></p><p>${escapeHtmlServer(message).replace(/\n/g, '<br>')}</p>`;
  if (mailer) {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, replyTo: fromEmail, subject, text, html });
  } else {
    console.log(`\n📧 [DEV MODE — email yuborilmadi] ${to} uchun aloqa xabari: ${name} <${fromEmail}>: ${message}\n`);
  }
}

// ----- Admin (email manzillari orqali belgilanadi, ADMIN_EMAILS env var, vergul bilan ajratilgan) -----
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  console.warn("⚠️  DIQQAT: ADMIN_EMAILS sozlanmagan — admin panelga hech kim kira olmaydi. README.md dagi 'Admin panel' bo'limini ko'ring.");
} else {
  console.log(`🛡️  Admin sifatida belgilangan: ${ADMIN_EMAILS.join(', ')}`);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ----- Rate limiting (spam/abuse himoyasi) -----
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring." },
});
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Soatiga faqat 30 ta harakat qilishingiz mumkin. Keyinroq urinib ko'ring." },
});

// ----- Resume (CV) upload — Cloudinary sozlangan bo'lsa bulutda doimiy, aks holda lokal diskda -----
const cloudinaryConfigured = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
let cloudinary = null;
if (cloudinaryConfigured) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('☁️  Cloudinary sozlangan — rezyumelar bulutda doimiy saqlanadi.');
} else {
  console.warn("⚠️  DIQQAT: Cloudinary sozlanmagan — rezyumelar serverning lokal diskida saqlanadi (bepul hostingda vaqti-vaqti bilan o'chib ketishi mumkin). README.md dagi 'Rezyume fayllarini doimiy saqlash' bo'limini ko'ring.");
}

const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_RESUME_TYPES.has(file.mimetype)) {
      return cb(new Error('Faqat PDF yoki Word (.doc/.docx) fayllar qabul qilinadi'));
    }
    cb(null, true);
  },
});

function makeResumeFilename(originalname) {
  const ext = path.extname(originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
  const rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `resume-${rnd}${ext}`;
}

// Faylni saqlaydi (Cloudinary yoki lokal disk) va foydalanuvchiga ko'rsatiladigan yo'lni/URL'ni qaytaradi
async function saveResumeFile(file) {
  if (!file) return null;
  const filename = makeResumeFilename(file.originalname);

  if (cloudinaryConfigured) {
    return await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'raw', public_id: `work-uz-resumes/${filename}`, overwrite: false },
        (err, result) => (err ? reject(err) : resolve(result.secure_url))
      );
      stream.end(file.buffer);
    });
  }

  fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
  return `/uploads/${filename}`;
}

function sign(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Tizimga kiring' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Sessiya muddati tugagan, qayta kiring" });
  }
}

// ================= AUTH =================
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({ error: "Ism, email va kamida 6 belgili parol kiriting" });
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
    if (!emailOk) return res.status(400).json({ error: "Email manzili noto'g'ri ko'rinishda (masalan: ism@domen.com)" });

    const existing = await db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(cleanEmail);
    if (existing && existing.email_verified) {
      return res.status(409).json({ error: "Bu email bilan hisob allaqachon mavjud. Kirish orqali davom eting." });
    }

    const hash = bcrypt.hashSync(password, 10);
    const code = generateCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();

    if (existing) {
      await db.prepare('UPDATE users SET name=?, password_hash=?, verify_code=?, verify_expires=? WHERE id=?')
        .run(name.trim(), hash, code, expires, existing.id);
    } else {
      await db.prepare(`INSERT INTO users (name,email,password_hash,email_verified,verify_code,verify_expires,created_at)
        VALUES (?,?,?,0,?,?,?)`)
        .run(name.trim(), cleanEmail, hash, code, expires, new Date().toISOString());
    }

    try {
      await sendVerificationEmail(cleanEmail, name.trim(), code);
    } catch (err) {
      console.error('Email yuborishda xatolik:', err.message);
      return res.status(502).json({ error: "Tasdiqlash xatini yuborib bo'lmadi. SMTP sozlamalarini tekshiring." });
    }

    const payload = { pending: true, email: cleanEmail, message: "Tasdiqlash kodi emailingizga yuborildi" };
    if (!smtpConfigured) payload.devCode = code;
    res.json(payload);
  } catch (err) {
    console.error('Register xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    const cleanEmail = String(email || '').toLowerCase().trim();
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!row) return res.status(404).json({ error: "Bunday hisob topilmadi" });
    if (row.email_verified) return res.status(400).json({ error: "Bu hisob allaqachon tasdiqlangan" });
    if (!row.verify_code || row.verify_code !== String(code || '').trim()) {
      return res.status(400).json({ error: "Kod noto'g'ri" });
    }
    if (new Date(row.verify_expires).getTime() < Date.now()) {
      return res.status(400).json({ error: "Kod muddati tugagan. Yangi kod so'rang." });
    }
    await db.prepare("UPDATE users SET email_verified=1, verify_code=NULL, verify_expires=NULL WHERE id=?").run(row.id);
    const user = { id: row.id, name: row.name, email: row.email };
    res.json({ token: sign(user), user });
  } catch (err) {
    console.error('Verify xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.post('/api/auth/resend', async (req, res) => {
  try {
    const { email } = req.body || {};
    const cleanEmail = String(email || '').toLowerCase().trim();
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!row) return res.status(404).json({ error: "Bunday hisob topilmadi" });
    if (row.email_verified) return res.status(400).json({ error: "Bu hisob allaqachon tasdiqlangan" });

    const code = generateCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();
    await db.prepare("UPDATE users SET verify_code=?, verify_expires=? WHERE id=?").run(code, expires, row.id);

    try {
      await sendVerificationEmail(cleanEmail, row.name, code);
    } catch (err) {
      return res.status(502).json({ error: "Kodni qayta yuborib bo'lmadi" });
    }
    const payload = { ok: true };
    if (!smtpConfigured) payload.devCode = code;
    res.json(payload);
  } catch (err) {
    console.error('Resend xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').toLowerCase().trim();
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
    }
    if (!row.email_verified) {
      return res.status(403).json({ error: "Avval emailingizni tasdiqlang", needsVerification: true, email: row.email });
    }
    const user = { id: row.id, name: row.name, email: row.email };
    res.json({ token: sign(user), user });
  } catch (err) {
    console.error('Login xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const cleanEmail = String(email || '').toLowerCase().trim();
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!row) return res.json({ ok: true }); // xavfsizlik: hisob bor/yo'qligini oshkor qilmaymiz

    const code = generateCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();
    await db.prepare("UPDATE users SET reset_code=?, reset_expires=? WHERE id=?").run(code, expires, row.id);

    try {
      await sendResetEmail(cleanEmail, row.name, code);
    } catch (err) {
      console.error('Reset email yuborishda xatolik:', err.message);
      return res.status(502).json({ error: "Kodni yuborib bo'lmadi. SMTP sozlamalarini tekshiring." });
    }
    const payload = { ok: true };
    if (!smtpConfigured) payload.devCode = code;
    res.json(payload);
  } catch (err) {
    console.error('Forgot-password xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Yangi parol kamida 6 belgidan iborat bo'lishi kerak" });
    }
    const cleanEmail = String(email || '').toLowerCase().trim();
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!row || !row.reset_code || row.reset_code !== String(code || '').trim()) {
      return res.status(400).json({ error: "Kod noto'g'ri" });
    }
    if (new Date(row.reset_expires).getTime() < Date.now()) {
      return res.status(400).json({ error: "Kod muddati tugagan. Yangi kod so'rang." });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await db.prepare("UPDATE users SET password_hash=?, reset_code=NULL, reset_expires=NULL WHERE id=?").run(hash, row.id);
    const user = { id: row.id, name: row.name, email: row.email };
    res.json({ token: sign(user), user });
  } catch (err) {
    console.error('Reset-password xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

// ================= VACANCIES =================
app.get('/api/vacancies', async (req, res) => {
  try {
    const cat = req.query.cat;
    const base = `
      SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applicant_count
      FROM vacancies v WHERE v.status='open'
    `;
    const rows = (cat && cat !== 'all')
      ? await db.prepare(base + " AND v.cat=? ORDER BY v.created_at DESC").all(cat)
      : await db.prepare(base + " ORDER BY v.created_at DESC").all();
    res.json({ vacancies: rows });
  } catch (err) {
    console.error('Vacancies list xatolik:', err);
    res.status(500).json({ error: "Vakansiyalarni yuklab bo'lmadi" });
  }
});

app.get('/api/vacancies/:id', async (req, res) => {
  try {
    const row = await db.prepare(`
      SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applicant_count
      FROM vacancies v WHERE v.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    res.json({ vacancy: row });
  } catch (err) {
    console.error('Vacancy detail xatolik:', err);
    res.status(500).json({ error: "Ma'lumotni yuklab bo'lmadi" });
  }
});

app.post('/api/vacancies', auth, postLimiter, async (req, res) => {
  try {
    const { cat, title, company, city, salary, type, description } = req.body || {};
    if (!title || !company) return res.status(400).json({ error: "Lavozim va kompaniya nomini kiriting" });
    const info = await db.prepare(`
      INSERT INTO vacancies (cat,title,company,city,salary,type,description,status,owner_id,is_sample,created_at)
      VALUES (?,?,?,?,?,?,?, 'open', ?, 0, ?)
    `).run(cat || 'boshqa', title.trim(), company.trim(), city || 'Toshkent', salary || '', type || "To'liq stavka", description || '', req.user.id, new Date().toISOString());
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(info.lastInsertRowid);
    res.json({ vacancy: row });
  } catch (err) {
    console.error('Vacancy create xatolik:', err);
    res.status(500).json({ error: "Vakansiya joylashda xatolik yuz berdi" });
  }
});

app.patch('/api/vacancies/:id/fill', auth, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    if (row.owner_id !== req.user.id) return res.status(403).json({ error: "Faqat e'lon egasi bu lavozimni yopa oladi" });
    await db.prepare("UPDATE vacancies SET status='filled' WHERE id=?").run(req.params.id);

    const hiredUserId = req.body && req.body.hiredUserId;
    if (hiredUserId) {
      const candidate = await db.prepare('SELECT * FROM users WHERE id=?').get(hiredUserId);
      if (candidate) {
        try {
          await sendHiredEmail(candidate.email, candidate.name, row.title, row.company);
        } catch (err) {
          console.error("Qabul qilindi xabarini yuborishda xatolik:", err.message);
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Fill xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.delete('/api/vacancies/:id', auth, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    if (row.owner_id !== req.user.id) return res.status(403).json({ error: "Faqat e'lon egasi o'chira oladi" });
    await db.prepare('DELETE FROM vacancies WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.post('/api/vacancies/:id/apply', auth, (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });

    const resumePath = await saveResumeFile(req.file);
    let isNewApplication = false;
    try {
      await db.prepare('INSERT INTO applications (user_id,vacancy_id,applied_at,resume_path) VALUES (?,?,?,?)')
        .run(req.user.id, req.params.id, new Date().toISOString(), resumePath);
      isNewApplication = true;
    } catch (e) {
      if (resumePath) {
        await db.prepare('UPDATE applications SET resume_path=? WHERE user_id=? AND vacancy_id=?')
          .run(resumePath, req.user.id, req.params.id);
      }
    }

    if (isNewApplication && row.owner_id) {
      const owner = await db.prepare('SELECT * FROM users WHERE id=?').get(row.owner_id);
      if (owner) {
        try {
          await sendApplicationNotification(owner.email, owner.name, req.user.name, req.user.email, row.title);
        } catch (err) {
          console.error('Ariza xabarnomasini yuborishda xatolik:', err.message);
        }
      }
    }
    res.json({ ok: true, resumePath });
  } catch (err) {
    console.error('Apply xatolik:', err);
    res.status(500).json({ error: "Ariza yuborishda xatolik yuz berdi" });
  }
});

app.get('/api/vacancies/:id/applicants', auth, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    if (row.owner_id !== req.user.id) return res.status(403).json({ error: "Faqat e'lon egasi arizachilarni ko'ra oladi" });

    const applicants = await db.prepare(`
      SELECT u.id, u.name, u.email, a.applied_at, a.resume_path
      FROM applications a JOIN users u ON u.id = a.user_id
      WHERE a.vacancy_id = ?
      ORDER BY a.applied_at DESC
    `).all(req.params.id);
    res.json({ applicants });
  } catch (err) {
    console.error('Applicants xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.get('/api/applications/mine', auth, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT vacancy_id FROM applications WHERE user_id=?').all(req.user.id);
    res.json({ ids: rows.map(r => r.vacancy_id) });
  } catch (err) {
    console.error('My applications xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

// ================= STATS (real, computed from the database) =================
app.get('/api/stats', async (req, res) => {
  try {
    const open = (await db.prepare("SELECT COUNT(*) c FROM vacancies WHERE status='open'").get()).c;
    const hired = (await db.prepare("SELECT COUNT(*) c FROM vacancies WHERE status='filled'").get()).c;
    const total = (await db.prepare("SELECT COUNT(*) c FROM vacancies").get()).c;
    const companies = (await db.prepare("SELECT COUNT(DISTINCT company) c FROM vacancies").get()).c;
    res.json({ open, hired, total, companies });
  } catch (err) {
    console.error('Stats xatolik:', err);
    res.status(500).json({ error: "Statistikani yuklab bo'lmadi" });
  }
});

// ================= ADMIN =================
function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_EMAILS.includes(String(req.user.email || '').toLowerCase())) {
    return res.status(403).json({ error: "Sizda admin huquqi yo'q" });
  }
  next();
}

app.get('/api/admin/whoami', auth, (req, res) => {
  res.json({ isAdmin: ADMIN_EMAILS.includes(String(req.user.email || '').toLowerCase()) });
});

app.get('/api/admin/vacancies', auth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT v.*, u.email AS owner_email, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applicant_count
      FROM vacancies v LEFT JOIN users u ON u.id = v.owner_id
      ORDER BY v.created_at DESC
    `).all();
    res.json({ vacancies: rows });
  } catch (err) {
    console.error('Admin vacancies xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.delete('/api/admin/vacancies/:id', auth, requireAdmin, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    await db.prepare('DELETE FROM vacancies WHERE id=?').run(req.params.id);
    await db.prepare('DELETE FROM applications WHERE vacancy_id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete vacancy xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.patch('/api/admin/vacancies/:id/reopen', auth, requireAdmin, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
    await db.prepare("UPDATE vacancies SET status='open' WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin reopen xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.get('/api/admin/users', auth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT id, name, email, email_verified, created_at,
        (SELECT COUNT(*) FROM vacancies WHERE owner_id = users.id) AS vacancy_count
      FROM users ORDER BY created_at DESC
    `).all();
    res.json({ users: rows });
  } catch (err) {
    console.error('Admin users xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

app.delete('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (ADMIN_EMAILS.includes(row.email.toLowerCase())) {
      return res.status(400).json({ error: "Admin hisobni o'chirib bo'lmaydi" });
    }
    const vacIds = (await db.prepare('SELECT id FROM vacancies WHERE owner_id=?').all(req.params.id)).map(v => v.id);
    for (const vid of vacIds) {
      await db.prepare('DELETE FROM applications WHERE vacancy_id=?').run(vid);
    }
    await db.prepare('DELETE FROM vacancies WHERE owner_id=?').run(req.params.id);
    await db.prepare('DELETE FROM applications WHERE user_id=?').run(req.params.id);
    await db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete user xatolik:', err);
    res.status(500).json({ error: "Kutilmagan xatolik yuz berdi" });
  }
});

// Har bir vakansiya uchun ulashish mumkin bo'lgan sahifa: /vakansiya/12
app.get('/vakansiya/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vakansiya.html'));
});

// ================= CONTACT =================
app.post('/api/contact', authLimiter, async (req, res) => {
  try {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Ism, email va xabar matnini kiriting" });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
    if (!emailOk) return res.status(400).json({ error: "Email manzili noto'g'ri ko'rinishda" });
    await sendContactEmail(name.trim(), email.trim(), message.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error('Aloqa xabarini yuborishda xatolik:', err.message);
    res.status(502).json({ error: "Xabarni yuborib bo'lmadi. Birozdan so'ng qayta urinib ko'ring." });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Work.uz server http://localhost:${PORT} manzilida ishlamoqda`);
    });
  })
  .catch((err) => {
    console.error("❌ Ma'lumotlar bazasini ishga tushirishda xatolik:", err);
    process.exit(1);
  });