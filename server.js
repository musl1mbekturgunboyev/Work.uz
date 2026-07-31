require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-CHANGE-ME-in-production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const CODE_TTL_MIN = 15;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (JWT_SECRET === 'dev-secret-CHANGE-ME-in-production') {
  console.warn("⚠️  DIQQAT: JWT_SECRET standart qiymatda qolgan. Productionda albatta o'zgartiring (env var sifatida).");
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

function escapeHtmlServer(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

const db = new DatabaseSync(DB_PATH);

db.exec(`
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

// Lightweight migration: add verification columns if an older database is missing them
try { db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN verify_code TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN verify_expires TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN reset_code TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN reset_expires TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE applications ADD COLUMN resume_path TEXT"); } catch (e) {}

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

// ----- Resume (CV) upload -----
const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
      const rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      cb(null, `resume-${rnd}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_RESUME_TYPES.has(file.mimetype)) {
      return cb(new Error('Faqat PDF yoki Word (.doc/.docx) fayllar qabul qilinadi'));
    }
    cb(null, true);
  },
});

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
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: "Ism, email va kamida 6 belgili parol kiriting" });
  }
  const cleanEmail = String(email).toLowerCase().trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
  if (!emailOk) return res.status(400).json({ error: "Email manzili noto'g'ri ko'rinishda (masalan: ism@domen.com)" });

  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(cleanEmail);
  if (existing && existing.email_verified) {
    return res.status(409).json({ error: "Bu email bilan hisob allaqachon mavjud. Kirish orqali davom eting." });
  }

  const hash = bcrypt.hashSync(password, 10);
  const code = generateCode();
  const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();

  if (existing) {
    // Ro'yxatdan o'tishni tugatmagan eski yozuvni yangilaymiz (email hali tasdiqlanmagan)
    db.prepare('UPDATE users SET name=?, password_hash=?, verify_code=?, verify_expires=? WHERE id=?')
      .run(name.trim(), hash, code, expires, existing.id);
  } else {
    db.prepare(`INSERT INTO users (name,email,password_hash,email_verified,verify_code,verify_expires,created_at)
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
  if (!smtpConfigured) payload.devCode = code; // faqat SMTP sozlanmagan lokal testda
  res.json(payload);
});

app.post('/api/auth/verify', (req, res) => {
  const { email, code } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!row) return res.status(404).json({ error: "Bunday hisob topilmadi" });
  if (row.email_verified) return res.status(400).json({ error: "Bu hisob allaqachon tasdiqlangan" });
  if (!row.verify_code || row.verify_code !== String(code || '').trim()) {
    return res.status(400).json({ error: "Kod noto'g'ri" });
  }
  if (new Date(row.verify_expires).getTime() < Date.now()) {
    return res.status(400).json({ error: "Kod muddati tugagan. Yangi kod so'rang." });
  }
  db.prepare("UPDATE users SET email_verified=1, verify_code=NULL, verify_expires=NULL WHERE id=?").run(row.id);
  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: sign(user), user });
});

app.post('/api/auth/resend', async (req, res) => {
  const { email } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!row) return res.status(404).json({ error: "Bunday hisob topilmadi" });
  if (row.email_verified) return res.status(400).json({ error: "Bu hisob allaqachon tasdiqlangan" });

  const code = generateCode();
  const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();
  db.prepare("UPDATE users SET verify_code=?, verify_expires=? WHERE id=?").run(code, expires, row.id);

  try {
    await sendVerificationEmail(cleanEmail, row.name, code);
  } catch (err) {
    return res.status(502).json({ error: "Kodni qayta yuborib bo'lmadi" });
  }
  const payload = { ok: true };
  if (!smtpConfigured) payload.devCode = code;
  res.json(payload);
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
  }
  if (!row.email_verified) {
    return res.status(403).json({ error: "Avval emailingizni tasdiqlang", needsVerification: true, email: row.email });
  }
  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: sign(user), user });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  // Xavfsizlik uchun: hisob mavjud/yo'qligini oshkor qilmaymiz, doim "ok" qaytaramiz
  if (!row) return res.json({ ok: true });

  const code = generateCode();
  const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();
  db.prepare("UPDATE users SET reset_code=?, reset_expires=? WHERE id=?").run(code, expires, row.id);

  try {
    await sendResetEmail(cleanEmail, row.name, code);
  } catch (err) {
    console.error('Reset email yuborishda xatolik:', err.message);
    return res.status(502).json({ error: "Kodni yuborib bo'lmadi. SMTP sozlamalarini tekshiring." });
  }
  const payload = { ok: true };
  if (!smtpConfigured) payload.devCode = code;
  res.json(payload);
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Yangi parol kamida 6 belgidan iborat bo'lishi kerak" });
  }
  const cleanEmail = String(email || '').toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!row || !row.reset_code || row.reset_code !== String(code || '').trim()) {
    return res.status(400).json({ error: "Kod noto'g'ri" });
  }
  if (new Date(row.reset_expires).getTime() < Date.now()) {
    return res.status(400).json({ error: "Kod muddati tugagan. Yangi kod so'rang." });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash=?, reset_code=NULL, reset_expires=NULL WHERE id=?").run(hash, row.id);
  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: sign(user), user });
});

// ================= VACANCIES =================
app.get('/api/vacancies', (req, res) => {
  const cat = req.query.cat;
  const base = `
    SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applicant_count
    FROM vacancies v WHERE v.status='open'
  `;
  const rows = (cat && cat !== 'all')
    ? db.prepare(base + " AND v.cat=? ORDER BY v.created_at DESC").all(cat)
    : db.prepare(base + " ORDER BY v.created_at DESC").all();
  res.json({ vacancies: rows });
});

// Bitta vakansiyaning to'liq ma'lumoti (masalan /vakansiya/12 sahifasi uchun)
app.get('/api/vacancies/:id', (req, res) => {
  const row = db.prepare(`
    SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applicant_count
    FROM vacancies v WHERE v.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
  res.json({ vacancy: row });
});

app.post('/api/vacancies', auth, postLimiter, (req, res) => {
  const { cat, title, company, city, salary, type, description } = req.body || {};
  if (!title || !company) return res.status(400).json({ error: "Lavozim va kompaniya nomini kiriting" });
  const info = db.prepare(`
    INSERT INTO vacancies (cat,title,company,city,salary,type,description,status,owner_id,is_sample,created_at)
    VALUES (?,?,?,?,?,?,?, 'open', ?, 0, ?)
  `).run(cat || 'boshqa', title.trim(), company.trim(), city || 'Toshkent', salary || '', type || "To'liq stavka", description || '', req.user.id, new Date().toISOString());
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(info.lastInsertRowid);
  res.json({ vacancy: row });
});

app.patch('/api/vacancies/:id/fill', auth, async (req, res) => {
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: "Faqat e'lon egasi bu lavozimni yopa oladi" });
  db.prepare("UPDATE vacancies SET status='filled' WHERE id=?").run(req.params.id);

  const hiredUserId = req.body && req.body.hiredUserId;
  if (hiredUserId) {
    const candidate = db.prepare('SELECT * FROM users WHERE id=?').get(hiredUserId);
    if (candidate) {
      try {
        await sendHiredEmail(candidate.email, candidate.name, row.title, row.company);
      } catch (err) {
        console.error("Qabul qilindi xabarini yuborishda xatolik:", err.message);
      }
    }
  }
  res.json({ ok: true });
});

app.delete('/api/vacancies/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: "Faqat e'lon egasi o'chira oladi" });
  db.prepare('DELETE FROM vacancies WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/vacancies/:id/apply', auth, (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });

  const resumePath = req.file ? `/uploads/${req.file.filename}` : null;
  let isNewApplication = false;
  try {
    db.prepare('INSERT INTO applications (user_id,vacancy_id,applied_at,resume_path) VALUES (?,?,?,?)')
      .run(req.user.id, req.params.id, new Date().toISOString(), resumePath);
    isNewApplication = true;
  } catch (e) {
    // already applied — unique constraint. Agar endi rezyume biriktirilgan bo'lsa, yangilaymiz.
    if (resumePath) {
      db.prepare('UPDATE applications SET resume_path=? WHERE user_id=? AND vacancy_id=?')
        .run(resumePath, req.user.id, req.params.id);
    }
  }

  if (isNewApplication && row.owner_id) {
    const owner = db.prepare('SELECT * FROM users WHERE id=?').get(row.owner_id);
    if (owner) {
      try {
        await sendApplicationNotification(owner.email, owner.name, req.user.name, req.user.email, row.title);
      } catch (err) {
        console.error('Ariza xabarnomasini yuborishda xatolik:', err.message);
        // Ariza baribir saqlangan — email yuborilmasa ham foydalanuvchiga xatolik ko'rsatmaymiz
      }
    }
  }
  res.json({ ok: true, resumePath });
});

// Faqat vakansiya egasi o'z e'loniga kelgan arizachilarni ko'ra oladi
app.get('/api/vacancies/:id/applicants', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: "Faqat e'lon egasi arizachilarni ko'ra oladi" });

  const applicants = db.prepare(`
    SELECT u.id, u.name, u.email, a.applied_at, a.resume_path
    FROM applications a JOIN users u ON u.id = a.user_id
    WHERE a.vacancy_id = ?
    ORDER BY a.applied_at DESC
  `).all(req.params.id);
  res.json({ applicants });
});

app.get('/api/applications/mine', auth, (req, res) => {
  const rows = db.prepare('SELECT vacancy_id FROM applications WHERE user_id=?').all(req.user.id);
  res.json({ ids: rows.map(r => r.vacancy_id) });
});

// ================= STATS (real, computed from the database) =================
app.get('/api/stats', (req, res) => {
  const open = db.prepare("SELECT COUNT(*) c FROM vacancies WHERE status='open'").get().c;
  const hired = db.prepare("SELECT COUNT(*) c FROM vacancies WHERE status='filled'").get().c;
  const total = db.prepare("SELECT COUNT(*) c FROM vacancies").get().c;
  const companies = db.prepare("SELECT COUNT(DISTINCT company) c FROM vacancies").get().c;
  res.json({ open, hired, total, companies });
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

app.get('/api/admin/vacancies', auth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, u.email AS owner_email, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS applicant_count
    FROM vacancies v LEFT JOIN users u ON u.id = v.owner_id
    ORDER BY v.created_at DESC
  `).all();
  res.json({ vacancies: rows });
});

app.delete('/api/admin/vacancies/:id', auth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
  db.prepare('DELETE FROM vacancies WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM applications WHERE vacancy_id=?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/admin/vacancies/:id/reopen', auth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM vacancies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vakansiya topilmadi' });
  db.prepare("UPDATE vacancies SET status='open' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/users', auth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, email, email_verified, created_at,
      (SELECT COUNT(*) FROM vacancies WHERE owner_id = users.id) AS vacancy_count
    FROM users ORDER BY created_at DESC
  `).all();
  res.json({ users: rows });
});

app.delete('/api/admin/users/:id', auth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  if (ADMIN_EMAILS.includes(row.email.toLowerCase())) {
    return res.status(400).json({ error: "Admin hisobni o'chirib bo'lmaydi" });
  }
  const vacIds = db.prepare('SELECT id FROM vacancies WHERE owner_id=?').all(req.params.id).map(v => v.id);
  for (const vid of vacIds) {
    db.prepare('DELETE FROM applications WHERE vacancy_id=?').run(vid);
  }
  db.prepare('DELETE FROM vacancies WHERE owner_id=?').run(req.params.id);
  db.prepare('DELETE FROM applications WHERE user_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Har bir vakansiya uchun ulashish mumkin bo'lgan sahifa: /vakansiya/12
app.get('/vakansiya/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vakansiya.html'));
});

// ================= CONTACT =================
app.post('/api/contact', authLimiter, async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Ism, email va xabar matnini kiriting" });
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  if (!emailOk) return res.status(400).json({ error: "Email manzili noto'g'ri ko'rinishda" });
  try {
    await sendContactEmail(name.trim(), email.trim(), message.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error('Aloqa xabarini yuborishda xatolik:', err.message);
    res.status(502).json({ error: "Xabarni yuborib bo'lmadi. Birozdan so'ng qayta urinib ko'ring." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Work.uz server http://localhost:${PORT} manzilida ishlamoqda`);
});
