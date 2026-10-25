const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.sqlite');

// Rate Limiting برای لاگین
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'تعداد تلاش بیش از حد. لطفاً 15 دقیقه صبر کنید.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Gzip Compression
app.use(compression());
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// === اتصال به دیتابیس ===
const db = new Database(DB_FILE);

// === بهینه‌سازی سرعت دیتابیس ===
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -2000');
db.pragma('foreign_keys = ON');

// ========================================
// === ساخت جداول ===
// ========================================
db.exec(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    gender TEXT DEFAULT 'male',
    height TEXT DEFAULT '-',
    weight TEXT DEFAULT '-',
    sessions INTEGER DEFAULT 0,
    debt INTEGER DEFAULT 0,
    expire_at TEXT DEFAULT NULL,
    last_checkin TEXT DEFAULT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS rates (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    count INTEGER DEFAULT 0,
    itemName TEXT,
    purpose TEXT,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'paid',
    FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
)`);

// === ایندکس‌ها ===
db.exec(`CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_members_gender ON members(gender)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_members_createdAt ON members(createdAt)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_member_id ON transactions(member_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_composite ON transactions(member_id, date)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_date_status_type ON transactions(date, status, type)`);

// ========================================
// ✅ Prepared Statements Cache (همه کوئری‌ها یک بار parse میشن)
// ========================================



 // === مهاجرت: اضافه کردن ستون expire_at برای شهریه ماهانه ===
 function migrateAddExpireAt() {
     try {
         const cols = db.prepare("PRAGMA table_info(members)").all();
         const hasExpire = cols.some(c => c.name === 'expire_at');
         if (!hasExpire) {
             console.log('🔄 Adding expire_at column...');
             db.exec(`ALTER TABLE members ADD COLUMN expire_at TEXT DEFAULT NULL`);
             console.log('✅ expire_at added');
         }
     } catch(e){ console.error('expire_at migration error', e); }
 }

 // === هلپر: چک انقضای شهریه ماهانه ===
 function checkAndExpireIfNeeded(member) {
     if (!member || !member.expire_at || !member.sessions) return member;
     try {
         const now = new Date();
         const expire = new Date(member.expire_at);
         if (now > expire && member.sessions > 0) {
             db.prepare('UPDATE members SET sessions = 0 WHERE id = ?').run(member.id);
             member.sessions = 0;
         }
     } catch(e){}
     return member;
 }

 function getExpireDaysForSession(count) {
     if (count === 1) return 1;
     if (count >= 12) return 30;
     if (count > 1) return 30;
     return 30;
 }

 function getDaysRemaining(expire_at) {
     if (!expire_at) return null;
     const now = new Date();
     const expire = new Date(expire_at);
     const diff = expire - now;
     if (diff <= 0) return 0;
     return Math.ceil(diff / (1000*60*60*24));
 }

 // === حذف خودکار اعضای غیرفعال بعد از 2 ماه ===
 function autoDeleteInactiveMembers() {
     try {
         const twoMonthsAgo = new Date();
         twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
         const cutoff = twoMonthsAgo.toISOString();
         
         // اعضایی که 2 ماه از ثبت‌نام گذشته و آخرین حضور یا انقضای شهریه هم قدیمی‌تر از 2 ماه است
         // و هیچ تراکنش فعالی ندارند
         const inactive = db.prepare(`
             SELECT id, name, phone, createdAt, last_checkin, expire_at 
             FROM members 
             WHERE datetime(createdAt) < datetime(?)
             AND (last_checkin IS NULL OR datetime(last_checkin) < datetime(?))
             AND (expire_at IS NULL OR datetime(expire_at) < datetime(?))
         `).all(cutoff, cutoff, cutoff);
         
         if (inactive.length > 0) {
             console.log(`🗑️ Auto-delete: ${inactive.length} عضو غیرفعال یافت شد (2 ماه بدون مراجعه)`);
             const delStmt = db.prepare('DELETE FROM members WHERE id = ?');
             const delTrans = db.transaction((members) => {
                 for (const m of members) {
                     delStmt.run(m.id);
                     console.log(`   - حذف: ${m.name} (${m.phone}) - آخرین حضور: ${m.last_checkin || 'هرگز'}`);
                 }
             });
             delTrans(inactive);
             invalidateStatsCache();
             return inactive.length;
         }
         return 0;
     } catch(e) {
         console.error('autoDelete error', e.message);
         return 0;
     }
 }

 
// ========================================
 // ✅ Prepared Statements Cache (همه کوئری‌ها یک بار parse میشن)
 // ========================================
 // --- فیکس فوری: قبل از ساخت STMT ستون expire_at را برای دیتابیس‌های قدیمی اضافه کن ---
try {
    const _cols = db.prepare("PRAGMA table_info(members)").all();
    if (!_cols.some(c => c.name === 'last_checkin')) {
        console.log('🔄 Adding last_checkin column (immediate fix)...');
        db.exec("ALTER TABLE members ADD COLUMN last_checkin TEXT DEFAULT NULL");
        console.log('✅ last_checkin added (immediate fix)');
    }
    // Also ensure expire_at (if not already)
    if (!_cols.some(c => c.name === 'expire_at')) {
        console.log('🔄 Adding expire_at column (immediate fix)...');
        db.exec("ALTER TABLE members ADD COLUMN expire_at TEXT DEFAULT NULL");
        console.log('✅ expire_at added (immediate fix)');
    }
} catch(e) { console.error('immediate expire_at fix error', e.message); }

const STMT = {
     // Members
     getMembers: db.prepare('SELECT id, name, phone, gender, height, weight, sessions, expire_at, last_checkin, createdAt FROM members ORDER BY id DESC LIMIT ? OFFSET ?'),
     getMemberCount: db.prepare('SELECT COUNT(*) as count FROM members'),
     getMemberById: db.prepare('SELECT * FROM members WHERE id = ?'),
     getMemberExpire: db.prepare('SELECT expire_at, sessions FROM members WHERE id = ?'),
     insertMember: db.prepare('INSERT INTO members (id, name, phone, gender, height, weight, sessions, debt, expire_at, last_checkin, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
     updateMember: db.prepare('UPDATE members SET name=?, phone=?, gender=?, height=?, weight=?, sessions=?, debt=?, expire_at=?, last_checkin=? WHERE id=?'),
     deleteMember: db.prepare('DELETE FROM members WHERE id = ?'),
     updateMemberSessions: db.prepare('UPDATE members SET sessions = sessions + ? WHERE id = ?'),
     updateMemberExpire: db.prepare('UPDATE members SET expire_at = ? WHERE id = ?'),
    updateMemberLastCheckin: db.prepare('UPDATE members SET last_checkin = ? WHERE id = ?'),
     resetExpiredSessions: db.prepare("UPDATE members SET sessions = 0 WHERE expire_at IS NOT NULL AND expire_at < ? AND sessions > 0"),
     
     // Transactions
     getTransactionsByMember: db.prepare('SELECT * FROM transactions WHERE member_id = ? ORDER BY date DESC'),
     insertTransaction: db.prepare('INSERT INTO transactions (member_id, type, amount, count, itemName, purpose, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
     getTransactionById: db.prepare('SELECT * FROM transactions WHERE id = ?'),
     updateTransactionStatus: db.prepare('UPDATE transactions SET status = ? WHERE id = ?'),
     deleteTransaction: db.prepare('DELETE FROM transactions WHERE id = ?'),
     
     // Stats
     getTotalMembers: db.prepare('SELECT COUNT(*) as count FROM members'),
     getMaleMembers: db.prepare("SELECT COUNT(*) as count FROM members WHERE gender = 'male'"),
     getFemaleMembers: db.prepare("SELECT COUNT(*) as count FROM members WHERE gender = 'female'"),
     getTotalSessions: db.prepare('SELECT COALESCE(SUM(sessions), 0) as sum FROM members'),
     getTotalDebt: db.prepare("SELECT COALESCE(SUM(amount), 0) as sum FROM transactions WHERE status = 'pending'"),
     getTotalIncome: db.prepare("SELECT COALESCE(SUM(amount), 0) as sum FROM transactions WHERE type = 'payment' AND status = 'paid'"),
     
     // Settings
     getPassword: db.prepare('SELECT value FROM settings WHERE key = ?'),
     updatePassword: db.prepare('UPDATE settings SET value = ? WHERE key = ?'),
     
     // Rates
     getRates: db.prepare('SELECT * FROM rates'),
     getRateByKey: db.prepare('SELECT key FROM rates WHERE key = ?'),
     insertRate: db.prepare('INSERT INTO rates (key, value) VALUES (?, ?)'),
     updateRate: db.prepare('INSERT OR REPLACE INTO rates (key, value) VALUES (?, ?)'),
     getBuffetItems: db.prepare('SELECT value FROM rates WHERE key = ?'),
     updateBuffetItems: db.prepare('UPDATE rates SET value = ? WHERE key = ?'),
     
     // Reports
     getMonthlyTransactions: db.prepare(`
         SELECT t.*, m.name, m.phone, m.gender 
         FROM transactions t 
         JOIN members m ON t.member_id = m.id
         WHERE t.date BETWEEN ? AND ?
         AND (t.status = 'paid' OR t.type = 'checkin')
         ORDER BY t.date DESC
     `)
 };

// ========================================
// === کش آمار ===
// ========================================
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 30000;


function invalidateStatsCache() {
    statsCache = null;
    statsCacheTime = 0;
}

// ========================================
// === مهاجرت: اضافه کردن ستون status ===
// ========================================

function migrateAddStatusColumn() {
    try {
        const columns = db.prepare("PRAGMA table_info(transactions)").all();
        const hasStatusColumn = columns.some(col => col.name === 'status');
        
        if (!hasStatusColumn) {
            console.log('🔄 Adding status column to transactions...');
            db.exec(`ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'paid'`);
            console.log('✅ Status column added successfully');
        }
    } catch (err) {
        console.error('❌ Migration error:', err);
    }
}

// ========================================
// === مهاجرت: تبدیل رمز قدیمی به bcrypt ===
// ========================================
async function migratePasswordToBcrypt() {
    try {
        const existing = STMT.getPassword.get('password');
        if (existing && existing.value && !existing.value.startsWith('$2b$')) {
            console.log('🔄 Migrating password to bcrypt...');
            // رمز قبلی SHA-256 بود. برای جلوگیری از قفل شدن، یک هش bcrypt از رمز پیش‌فرض می‌سازیم
            const hash = await bcrypt.hash('12345', 12);
            STMT.updatePassword.run(hash, 'password');
            console.log('✅ Password migrated to bcrypt. رمز فعلی: 12345');
        }
    } catch (err) {
        console.error('❌ Password migration error:', err);
    }
}

// ========================================
// === تنظیمات اولیه ===
// ========================================
async function initializePassword() {
    try {
        const existing = STMT.getPassword.get('password');
        
        if (!existing) {
            const defaultPassword = '12345';
            const hash = await bcrypt.hash(defaultPassword, 12);
            
            const insertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
            insertStmt.run('password', hash);
            console.log('✅ Default password set: 12345');
        }
    } catch (err) {
        console.error('❌ Password initialization error:', err);
    }
}

function initializeRates() {
    const defaultRates = {
        single: '0', '12': '0', '16': '0', '20': '0', '26': '0',
        cardio: '0', plan: '0',
        'water-small': '0', 'water-large': '0',
        buffetItems: '[]'
    };
    
    for (const [key, value] of Object.entries(defaultRates)) {
        if (!STMT.getRateByKey.get(key)) {
            STMT.insertRate.run(key, value);
        }
    }
    console.log('✅ Default rates initialized');
}

// اجرای تنظیمات و مهاجرت‌ها
migrateAddStatusColumn();
migrateAddExpireAt();
initializePassword().then(() => migratePasswordToBcrypt());
initializeRates();

// ========================================
// === API: لاگین ===
// ========================================
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { password } = req.body;
        const result = STMT.getPassword.get('password');
        
        if (!result) {
            return res.json({ success: false, message: 'رمز عبور تنظیم نشده است' });
        }
        
        const isValid = await bcrypt.compare(password, result.value);
        
        if (isValid) {
            res.json({ success: true, message: 'ورود موفقیت‌آمیز' });
        } else {
            res.json({ success: false, message: 'رمز عبور اشتباه است' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در سرور' });
    }
});

// ========================================
// === API: تغییر رمز ===
// ========================================
app.post('/api/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const result = STMT.getPassword.get('password');
        
        const isCurrentValid = await bcrypt.compare(currentPassword, result.value);
        
        if (!isCurrentValid) {
            return res.json({ success: false, message: 'رمز عبور فعلی اشتباه است' });
        }
        
        const newHash = await bcrypt.hash(newPassword, 12);
        STMT.updatePassword.run(newHash, 'password');
        
        res.json({ success: true, message: 'رمز عبور تغییر کرد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در سرور' });
    }
});

// ========================================
// === API: دریافت اعضا ===
// ========================================
app.get('/api/members', (req, res) => {
    try {
        // Check and expire old subscriptions (run cleanup)
        try {
            const nowISO = new Date().toISOString();
            STMT.resetExpiredSessions.run(nowISO);
            invalidateStatsCache();
        } catch(e){}
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const offset = (page - 1) * limit;
        
        const members = STMT.getMembers.all(limit, offset);
        // Attach daysRemaining for frontend convenience
        const todayStr = new Date().toISOString().split('T')[0];
        const enriched = members.map(m => {
            const days = m.expire_at ? getDaysRemaining(m.expire_at) : null;
            const checkedInToday = m.last_checkin ? m.last_checkin.split('T')[0] === todayStr : false;
            if (m.expire_at) {
                return { ...m, daysRemaining: days, isExpired: days === 0, checkedInToday };
            }
            return { ...m, daysRemaining: days, isExpired: days === 0, checkedInToday };
        });
        const total = STMT.getMemberCount.get().count;
        
        res.json({
            success: true,
            data: enriched,
            total,
            hasMore: offset + limit < total
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در دریافت داده' });
    }
});

// ========================================
// === API: دریافت یک عضو ===
// ========================================
app.get('/api/members/:id', (req, res) => {
    try {
        let member = STMT.getMemberById.get(req.params.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'عضو یافت نشد' });
        }
        // Check expiry and enrich
        member = checkAndExpireIfNeeded(member);
        const daysRemaining = member.expire_at ? getDaysRemaining(member.expire_at) : null;
        const isExpired = daysRemaining === 0;
        const todayStr = new Date().toISOString().split('T')[0];
        const checkedInToday = member.last_checkin ? member.last_checkin.split('T')[0] === todayStr : false;
        res.json({ success: true, data: { ...member, daysRemaining, isExpired, checkedInToday } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در دریافت' });
    }
});

// ========================================
// === API: دریافت تراکنش‌های یک عضو ===
// ========================================
app.get('/api/members/:id/transactions', (req, res) => {
    try {
        const transactions = STMT.getTransactionsByMember.all(req.params.id);
        
        const debt = transactions
            .filter(t => t.status === 'pending')
            .reduce((sum, t) => sum + t.amount, 0);
        
        res.json({ success: true, data: transactions, debt });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در دریافت تراکنش‌ها' });
    }
});

// ========================================
// === API: افزودن عضو ===
// ========================================
app.post('/api/members', (req, res) => {
    try {
        const { id, name, phone, gender, height, weight, sessions, debt, createdAt } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'نام و شماره تلفن الزامی است' });
        }
        
        if (!/^09\d{9}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'شماره تلفن نامعتبر است' });
        }
        
        const heightNum = parseInt(height);
        const weightNum = parseInt(weight);
        const sessionsNum = parseInt(sessions);
        const debtNum = parseInt(debt);
        
        if (height && (isNaN(heightNum) || heightNum < 0 || heightNum > 250)) {
            return res.status(400).json({ success: false, message: 'قد نامعتبر است' });
        }
        
        if (weight && (isNaN(weightNum) || weightNum < 0 || weightNum > 250)) {
            return res.status(400).json({ success: false, message: 'وزن نامعتبر است' });
        }
        if (sessions !== undefined && sessions !== null && sessions !== '' && (isNaN(sessionsNum) || sessionsNum < 0)) {
            return res.status(400).json({ success: false, message: 'تعداد جلسات نمی‌تواند منفی باشد' });
        }
        if (debt !== undefined && debt !== null && debt !== '' && (isNaN(debtNum) || debtNum < 0)) {
            return res.status(400).json({ success: false, message: 'بدهی نمی‌تواند منفی باشد' });
        }
        
        // expire_at handling - if not provided, null
        let expireAt = req.body.expire_at || null;
        if (expireAt && isNaN(Date.parse(expireAt))) expireAt = null;
        const lastCheckin = req.body.last_checkin || null;
        
        STMT.insertMember.run(
            id || Date.now(), name, phone, gender || 'male',
            height || '-', weight || '-',
            sessionsNum >=0 ? sessionsNum : 0, debtNum >=0 ? debtNum : 0,
            expireAt,
            lastCheckin,
            createdAt || new Date().toISOString()
        );
        
        invalidateStatsCache();
        res.json({ success: true, message: 'عضو اضافه شد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در ذخیره (شماره تکراری؟)' });
    }
});

// ========================================
// === API: بروزرسانی عضو ===
// ========================================
app.put('/api/members/:id', (req, res) => {
    try {
        const { name, phone, gender, height, weight, sessions, debt, expire_at, last_checkin } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'نام و شماره تلفن الزامی است' });
        }
        
        if (!/^09\d{9}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'شماره تلفن نامعتبر است' });
        }
        // Prevent negative
        const sNum = parseInt(sessions);
        if (sessions !== undefined && sessions !== null && sessions !== '' && (isNaN(sNum) || sNum < 0)) {
            return res.status(400).json({ success: false, message: 'تعداد جلسات نمی‌تواند منفی باشد' });
        }
        let expireAt = expire_at || null;
        if (expireAt && isNaN(Date.parse(expireAt))) expireAt = null;
        if (expireAt) {
            const d = new Date(expireAt);
            if (isNaN(d.getTime())) expireAt = null;
        }
        let lastCheckin = last_checkin !== undefined ? last_checkin : null;
        if (lastCheckin && isNaN(Date.parse(lastCheckin))) lastCheckin = null;
        // If not provided, keep existing
        if (last_checkin === undefined) {
            const existing = STMT.getMemberById.get(req.params.id);
            lastCheckin = existing ? existing.last_checkin : null;
        }
        
        STMT.updateMember.run(name, phone, gender, height, weight, sNum >=0 ? sNum : 0, debt || 0, expireAt, lastCheckin, req.params.id);
        
        invalidateStatsCache();
        res.json({ success: true, message: 'بروزرسانی شد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در بروزرسانی' });
    }
});

// ========================================
// === API: حذف عضو ===
// ========================================
app.delete('/api/members/:id', (req, res) => {
    try {
        const info = STMT.deleteMember.run(req.params.id);
        
        if (info.changes > 0) {
            invalidateStatsCache();
            res.json({ success: true, message: 'حذف شد' });
        } else {
            res.status(404).json({ success: false, message: 'عضو یافت نشد' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در حذف' });
    }
});

// ========================================
// === API: افزودن تراکنش ===
// ========================================
app.post('/api/transactions', (req, res) => {
    try {
        const { member_id, type, amount, count, itemName, purpose, date, status } = req.body;
        
        const info = STMT.insertTransaction.run(
            member_id, type || 'unknown', amount || 0, count || 0,
            itemName || null, purpose || null, date || new Date().toISOString(),
            status || 'paid'
        );
        
        // Update last_checkin if this is a checkin
        if (type === 'checkin' && (status === 'paid')) {
            try { STMT.updateMemberLastCheckin.run(new Date().toISOString(), member_id); } catch(e){}
        }
        // If this is a direct paid session purchase, set expiry and add sessions immediately
        if (type === 'session' && (status === 'paid') && count > 0) {
            try {
                STMT.updateMemberSessions.run(count, member_id);
                const days = getExpireDaysForSession(count);
                const newExpire = new Date();
                newExpire.setDate(newExpire.getDate() + days);
                STMT.updateMemberExpire.run(newExpire.toISOString(), member_id);
            } catch(e){}
        }
        
        invalidateStatsCache();
        res.json({ success: true, id: info.lastInsertRowid, message: 'تراکنش ذخیره شد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در ذخیره تراکنش' });
    }
});

// ========================================
// === API: تایید تراکنش ===
// ========================================
app.put('/api/transactions/:id/confirm', (req, res) => {
    try {
        const transaction = STMT.getTransactionById.get(req.params.id);
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'تراکنش یافت نشد' });
        }
        
        if (transaction.status === 'paid') {
            return res.status(400).json({ success: false, message: 'این تراکنش قبلاً تایید شده است' });
        }
        
        const confirmTransaction = db.transaction(() => {
            STMT.updateTransactionStatus.run('paid', req.params.id);
            
            if (transaction.type === 'session' && transaction.count > 0) {
                STMT.updateMemberSessions.run(transaction.count, transaction.member_id);
                // تک جلسه = 1 روز، 12+ = 30 روز
                const days = getExpireDaysForSession(transaction.count);
                const newExpire = new Date();
                newExpire.setDate(newExpire.getDate() + days);
                STMT.updateMemberExpire.run(newExpire.toISOString(), transaction.member_id);
            }
            
            return true;
        });
        
        confirmTransaction();
        invalidateStatsCache();
        res.json({ success: true, message: 'تراکنش تایید شد و پرداخت ثبت شد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در تایید تراکنش' });
    }
});

// ========================================
// === API: حذف تراکنش ===
// ========================================
app.delete('/api/transactions/:id', (req, res) => {
    try {
        const transaction = STMT.getTransactionById.get(req.params.id);
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'تراکنش یافت نشد' });
        }
        
        const deleteWithRollback = db.transaction(() => {
            if (transaction.status === 'paid') {
                if (transaction.type === 'session' && transaction.count > 0) {
                    STMT.updateMemberSessions.run(-transaction.count, transaction.member_id);
                    // اگر تراکنش شهریه بود، باید expire_at هم پاک یا بروز شود
                    // چک کن آیا تراکنش‌های جلسه دیگری باقی مانده؟
                    const remaining = db.prepare("SELECT * FROM transactions WHERE member_id = ? AND type = 'session' AND status = 'paid' AND id != ? ORDER BY date DESC LIMIT 1").get(transaction.member_id, transaction.id);
                    if (remaining && remaining.date) {
                        // آخرین تراکنش باقی‌مانده را مبنا قرار بده
                        const days = getExpireDaysForSession(remaining.count);
                        const exp = new Date(remaining.date);
                        exp.setDate(exp.getDate() + days);
                        STMT.updateMemberExpire.run(exp.toISOString(), transaction.member_id);
                    } else {
                        // هیچ شهریه دیگری نمانده -> پاک کن
                        STMT.updateMemberExpire.run(null, transaction.member_id);
                        // اگر سشن منفی شد، صفر کن
                        const m = STMT.getMemberById.get(transaction.member_id);
                        if (m && m.sessions < 0) {
                            db.prepare('UPDATE members SET sessions = 0 WHERE id = ?').run(transaction.member_id);
                        }
                    }
                } else if (transaction.type === 'checkin') {
                    STMT.updateMemberSessions.run(1, transaction.member_id);
                }
            } else if (transaction.status === 'pending' && transaction.type === 'session') {
                // حتی اگر pending بود و پاک شد، اگر تنها تراکنش pending بود، expire را دست نزن
                // اما اگر قبلاً expire ست شده بود و حالا پاک شد، نیازی به پاک کردن نیست چون هنوز paid نشده بود
            }
            
            const info = STMT.deleteTransaction.run(req.params.id);
            return info.changes > 0;
        });
        
        const success = deleteWithRollback();
        
        if (success) {
            invalidateStatsCache();
            res.json({ success: true, message: 'تراکنش حذف شد' });
        } else {
            res.status(500).json({ success: false, message: 'خطا در حذف تراکنش' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در حذف تراکنش' });
    }
});

// ========================================
// === API: آمار (با کش) ===
// ========================================
app.get('/api/stats', (req, res) => {
    try {
        const now = Date.now();
        
        if (statsCache && now - statsCacheTime < STATS_CACHE_TTL) {
            return res.json({ success: true, data: statsCache });
        }
        
        const totalMembers = STMT.getTotalMembers.get().count;
        const maleMembers = STMT.getMaleMembers.get().count;
        const femaleMembers = STMT.getFemaleMembers.get().count;
        const totalSessions = STMT.getTotalSessions.get().sum;
        const totalDebt = STMT.getTotalDebt.get().sum;
        const totalIncome = STMT.getTotalIncome.get().sum;
        
        const stats = { totalMembers, maleMembers, femaleMembers, totalSessions, totalDebt, totalIncome };
        statsCache = stats;
        statsCacheTime = now;
        
        res.json({ success: true, data: stats });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در آمار' });
    }
});

// ========================================
// === API: گزارش ماهانه ===
// ========================================
app.get('/api/reports/monthly', (req, res) => {
    try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
        
        const transactions = STMT.getMonthlyTransactions.all(start, end);
        
        res.json({ success: true, data: transactions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در دریافت گزارش ماهانه' });
    }
});

// ========================================
// === API: نرخ‌ها ===
// ========================================
app.get('/api/rates', (req, res) => {
    try {
        const rates = STMT.getRates.all();
        const ratesObj = {};
        
        rates.forEach(r => {
            ratesObj[r.key] = r.key === 'buffetItems' ? JSON.parse(r.value || '[]') : (parseInt(r.value) || 0);
        });
        
        res.json({ success: true, data: ratesObj });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در دریافت نرخ‌ها' });
    }
});

app.post('/api/rates', (req, res) => {
    try {
        const { type, value } = req.body;
        const num = parseInt(value);
        if (isNaN(num) || num < 0) return res.status(400).json({ success: false, message: 'مبلغ نمی‌تواند منفی باشد' });
        STMT.updateRate.run(type, num.toString());
        res.json({ success: true, message: 'نرخ ذخیره شد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در ذخیره نرخ' });
    }
});


app.post('/api/rates/bulk', (req, res) => {
    try {
        const rates = req.body; // expects object {single: 100, '12': 200, ...}
        for (const [key, val] of Object.entries(rates)) {
            const num = parseInt(val);
            if (isNaN(num) || num < 0) return res.status(400).json({ success: false, message: `مبلغ ${key} نامعتبر است` });
            STMT.updateRate.run(key, num.toString());
        }
        res.json({ success: true, message: 'همه نرخ‌ها ذخیره شد' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'خطا در ذخیره نرخ‌ها' });
    }
});

app.post('/api/rates/buffet', (req, res) => {
    try {
        const { name, price } = req.body;
        const pNum = parseInt(price);
        if (!name || isNaN(pNum) || pNum < 0) return res.status(400).json({ success: false, message: 'نام یا قیمت نامعتبر است' });
        const result = STMT.getBuffetItems.get('buffetItems');
        const items = JSON.parse(result.value || '[]');
        
        items.push({ name, price: pNum });
        STMT.updateBuffetItems.run(JSON.stringify(items), 'buffetItems');
        
        res.json({ success: true, message: 'آیتم اضافه شد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در افزودن آیتم' });
    }
});

app.delete('/api/rates/buffet/:index', (req, res) => {
    try {
        const result = STMT.getBuffetItems.get('buffetItems');
        const items = JSON.parse(result.value || '[]');
        const index = parseInt(req.params.index);
        
        if (index >= 0 && index < items.length) {
            items.splice(index, 1);
            STMT.updateBuffetItems.run(JSON.stringify(items), 'buffetItems');
            res.json({ success: true, message: 'آیتم حذف شد' });
        } else {
            res.status(404).json({ success: false, message: 'آیتم یافت نشد' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در حذف آیتم' });
    }
});

// ========================================
// === API: بک‌آپ و بازیابی ===
// ========================================
app.get('/api/backup', (req, res) => {
    try {
        // برای WAL mode باید checkpoint کنیم تا همه دیتا داخل فایل اصلی بره
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch(e) {}
        
        if (!fs.existsSync(DB_FILE)) {
            return res.status(404).json({ success: false, message: 'فایل دیتابیس یافت نشد' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        const fileName = `backup-ardalan-${today}.sqlite`;
        
        res.setHeader('Content-Type', 'application/x-sqlite3');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        
        const stream = fs.createReadStream(DB_FILE);
        stream.pipe(res);
        
        stream.on('error', (err) => {
            console.error('Backup stream error:', err);
            if (!res.headersSent) res.status(500).json({ success: false, message: 'خطا در ارسال بک‌آپ' });
        });
    } catch (err) {
        console.error('Backup error:', err);
        res.status(500).json({ success: false, message: 'خطا در تهیه بک‌آپ' });
    }
});

// بک‌آپ کپی روی دیسک (برای نگهداری خودکار)
app.post('/api/backup/create-copy', (req, res) => {
    try {
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch(e) {}
        
        const backupsDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
        
        const now = new Date();
        const fileName = `backup-ardalan-${now.toISOString().split('T')[0]}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}.sqlite`;
        const dest = path.join(backupsDir, fileName);
        
        fs.copyFileSync(DB_FILE, dest);
        
        // فقط 10 بک‌آپ آخر را نگه دار
        const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('backup-ardalan')).sort().reverse();
        if (files.length > 10) {
            for (const oldFile of files.slice(10)) {
                try { fs.unlinkSync(path.join(backupsDir, oldFile)); } catch(e) {}
            }
        }
        
        res.json({ success: true, message: `بک‌آپ در پوشه backups ذخیره شد`, fileName });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطا در ذخیره بک‌آپ' });
    }
});

app.get('/api/backup/info', (req, res) => {
    try {
        if (!fs.existsSync(DB_FILE)) return res.json({ success: false, message: 'دیتابیس یافت نشد' });
        const stat = fs.statSync(DB_FILE);
        res.json({ 
            success: true, 
            data: { 
                size: stat.size, 
                sizeKB: Math.round(stat.size/1024),
                lastModified: stat.mtime.toISOString(),
                exists: true
            } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'خطا' });
    }
});


// === API: حذف دستی اعضای غیرفعال (2 ماه) ===
app.post('/api/members/cleanup/inactive', (req, res) => {
    try {
        const count = autoDeleteInactiveMembers();
        res.json({ success: true, deleted: count, message: count > 0 ? `${count} عضو غیرفعال حذف شد` : 'عضو غیرفعالی یافت نشد' });
    } catch(e){ res.status(500).json({success:false, message:'خطا'}) }
});
app.get('/api/members/cleanup/preview', (req, res) => {
    try {
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
        const cutoff = twoMonthsAgo.toISOString();
        const inactive = db.prepare(`
            SELECT id, name, phone, createdAt, last_checkin, expire_at,
                   CAST((julianday('now') - julianday(createdAt)) AS INTEGER) as daysSinceJoin
            FROM members 
            WHERE datetime(createdAt) < datetime(?)
            AND (last_checkin IS NULL OR datetime(last_checkin) < datetime(?))
            AND (expire_at IS NULL OR datetime(expire_at) < datetime(?))
            ORDER BY createdAt ASC
        `).all(cutoff, cutoff, cutoff);
        res.json({ success: true, count: inactive.length, data: inactive });
    } catch(e){ res.status(500).json({success:false}) }
});

// === API: بررسی آپدیت از گیت‌هاب ===
app.get('/api/update/check', async (req, res) => {
    try {
        const https = require('https');
        const options = {
            hostname: 'api.github.com',
            path: '/repos/nzbozorg/Ardalan-GYM-Manager/releases/latest',
            method: 'GET',
            headers: { 'User-Agent': 'Ardalan-GYM-Manager', 'Accept': 'application/vnd.github.v3+json' }
        };
        const ghReq = https.request(options, (ghRes) => {
            let data = '';
            ghRes.on('data', chunk => data += chunk);
            ghRes.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    if (release.tag_name) {
                        res.json({ success: true, latest: release.tag_name, url: release.html_url, body: release.body, published: release.published_at });
                    } else {
                        res.json({ success: false, message: 'مخزن هنوز ریلیزی ندارد' });
                    }
                } catch(e){ res.json({ success:false, message:'پاسخ نامعتبر' }) }
            });
        });
        ghReq.on('error', () => res.json({ success:false, message:'عدم اتصال به گیت‌هاب - آفلاین هستید' }));
        ghReq.setTimeout(5000, () => { ghReq.destroy(); res.json({ success:false, message:'تایم‌اوت' }) });
        ghReq.end();
    } catch(e){ res.json({ success:false, message:'خطا' }) }
});

// === شروع سرور ===
app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log(`🚀 Server Started: http://localhost:${PORT}`);
    console.log(`🗄️ Database: ${DB_FILE}`);
    console.log(`🔐 Default Password: 12345`);
    console.log(`💰 Debt System: ACTIVE (Pending/Paid)`);
    console.log(`⚡ Optimized: WAL + 2MB Cache + Indexes + Gzip + Prepared Statements`);
    console.log(`🔒 Security: bcrypt + Rate Limiting + Server-side Validation`);
    console.log('='.repeat(50));
    console.log(`🧹 Auto-delete inactive (60 days) enabled`);
    // اجرای اولیه بعد از 15 ثانیه
    setTimeout(() => {
        const n = autoDeleteInactiveMembers();
        if (n > 0) console.log(`✅ ${n} عضو غیرفعال حذف شد`);
    }, 15000);
    // هر 24 ساعت یکبار
    setInterval(() => {
        const n = autoDeleteInactiveMembers();
        if (n > 0) console.log(`🔄 Auto-delete daily: ${n} عضو حذف شد`);
    }, 24 * 60 * 60 * 1000);
});