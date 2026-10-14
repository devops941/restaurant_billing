const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { resolveDataFolder } = require('./config');

let db = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  component_type TEXT NOT NULL,
  percent REAL NOT NULL DEFAULT 0,
  effective_from TEXT,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tax_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  price_mode TEXT NOT NULL DEFAULT 'exclusive',
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tax_profile_rates (
  profile_id INTEGER NOT NULL,
  tax_rate_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, tax_rate_id),
  FOREIGN KEY (profile_id) REFERENCES tax_profiles(id),
  FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ta TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  price REAL NOT NULL DEFAULT 0,
  tax_profile_id INTEGER,
  hsn_code TEXT DEFAULT '',
  unit TEXT DEFAULT 'Plate',
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (tax_profile_id) REFERENCES tax_profiles(id)
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  section TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'free',
  current_bill_id INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS waiters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL,
  date_time TEXT NOT NULL,
  table_id INTEGER,
  waiter_id INTEGER,
  order_type TEXT NOT NULL DEFAULT 'Dine-in',
  customer_id INTEGER,
  customer_name TEXT DEFAULT '',
  customer_address TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  discount_percent REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  price_mode TEXT DEFAULT 'exclusive',
  round_off REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_mode TEXT DEFAULT 'Cash',
  user_id INTEGER,
  cashier_name TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'paid',
  cancel_reason TEXT DEFAULT '',
  FOREIGN KEY (table_id) REFERENCES tables(id),
  FOREIGN KEY (waiter_id) REFERENCES waiters(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  item_id INTEGER,
  category_name TEXT DEFAULT '',
  name_snapshot TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'Plate',
  rate REAL NOT NULL DEFAULT 0,
  tax_snapshot TEXT DEFAULT '{}',
  amount REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bill_taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  component_name TEXT NOT NULL,
  percent REAL NOT NULL DEFAULT 0,
  taxable_amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS held_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_id INTEGER
);

CREATE TABLE IF NOT EXISTS active_drafts (
  tab_id TEXT PRIMARY KEY,
  tab_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  date_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shortcuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL UNIQUE,
  key_combo TEXT NOT NULL,
  user_id INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS bill_sequence (
  fy_key TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
`;

function getDbPath() {
  const dataFolder = resolveDataFolder();
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
  }
  return path.join(dataFolder, 'restaurant.db');
}

function initDb(defaultsJson) {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  seedDefaults(defaultsJson);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function seedDefaults(defaultsJson) {
  const countUsers = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (countUsers.c === 0) {
    const hash = bcrypt.hashSync('1234', 10);
    db.prepare('INSERT INTO users (name, pin_hash, role) VALUES (?, ?, ?)').run('Admin', hash, 'admin');
    db.prepare('INSERT INTO users (name, pin_hash, role) VALUES (?, ?, ?)').run('Cashier', bcrypt.hashSync('0000', 10), 'cashier');
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM settings').get();
  if (settingsCount.c === 0 && defaultsJson) {
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaultsJson)) {
      insert.run(key, JSON.stringify(value));
    }
  }

  seedTaxIfEmpty();
  seedMenuIfEmpty();
  seedTablesIfEmpty();
  seedWaitersIfEmpty();
  seedUnitsIfEmpty();
  seedShortcutsIfEmpty();
}

function seedTaxIfEmpty() {
  const c = db.prepare('SELECT COUNT(*) as n FROM tax_rates').get().n;
  if (c === 0) {
    db.prepare(`INSERT INTO tax_rates (name, component_type, percent) VALUES ('CGST 2.5%', 'CGST', 2.5)`).run();
    db.prepare(`INSERT INTO tax_rates (name, component_type, percent) VALUES ('SGST 2.5%', 'SGST', 2.5)`).run();
    db.prepare(`INSERT INTO tax_rates (name, component_type, percent) VALUES ('IGST 5%', 'IGST', 5)`).run();
    db.prepare(`INSERT INTO tax_rates (name, component_type, percent) VALUES ('CGST 9%', 'CGST', 9)`).run();
    db.prepare(`INSERT INTO tax_rates (name, component_type, percent) VALUES ('SGST 9%', 'SGST', 9)`).run();
    db.prepare(`INSERT INTO tax_rates (name, component_type, percent) VALUES ('IGST 18%', 'IGST', 18)`).run();
  }

  const pCount = db.prepare('SELECT COUNT(*) as n FROM tax_profiles').get().n;
  if (pCount === 0) {
    db.prepare(`INSERT INTO tax_profiles (name, is_default, price_mode) VALUES ('Restaurant 5%', 1, 'exclusive')`).run();
    db.prepare(`INSERT INTO tax_profiles (name, is_default, price_mode) VALUES ('AC Restaurant 18%', 0, 'exclusive')`).run();
    db.prepare(`INSERT INTO tax_profiles (name, is_default, price_mode) VALUES ('Exempt 0%', 0, 'exclusive')`).run();

    const p5 = db.prepare('SELECT id FROM tax_profiles WHERE name = ?').get('Restaurant 5%')?.id;
    const cgst25 = db.prepare("SELECT id FROM tax_rates WHERE name = 'CGST 2.5%'").get()?.id;
    const sgst25 = db.prepare("SELECT id FROM tax_rates WHERE name = 'SGST 2.5%'").get()?.id;
    if (p5 && cgst25 && sgst25) {
      db.prepare('INSERT INTO tax_profile_rates (profile_id, tax_rate_id, sort_order) VALUES (?, ?, 0)').run(p5, cgst25);
      db.prepare('INSERT INTO tax_profile_rates (profile_id, tax_rate_id, sort_order) VALUES (?, ?, 1)').run(p5, sgst25);
    }
  }
}

function seedUnitsIfEmpty() {
  if (db.prepare('SELECT COUNT(*) as n FROM units').get().n > 0) return;
  const units = [
    ['Plate', 'தட்டு'],
    ['Portion', 'பங்கு'],
    ['Kg', 'கிலோ'],
    ['Nos', 'எண்'],
    ['Cup', 'கோப்பை'],
  ];
  const ins = db.prepare('INSERT INTO units (name_en, name_ta) VALUES (?, ?)');
  units.forEach((u) => ins.run(u[0], u[1]));
}

function seedMenuIfEmpty() {
  if (db.prepare('SELECT COUNT(*) as n FROM items').get().n > 0) return;

  const cats = [
    ['Biriyani', 'பிரியாணி', 1],
    ['Chicken', 'சிக்கன்', 2],
    ['Mutton', 'மட்டன்', 3],
    ['Fish & Sea Food', 'மீன் & கடல் உணவு', 4],
    ['Parotta & Breads', 'பரோட்டா & ரொட்டி', 5],
    ['Rice & Meals', 'சாதம் & சாப்பாடு', 6],
    ['Drinks & Desserts', 'குளிர்பானங்கள்', 7],
  ];
  const catIns = db.prepare('INSERT INTO categories (name_en, name_ta, sort_order) VALUES (?, ?, ?)');
  cats.forEach((c) => catIns.run(c[0], c[1], c[2]));

  const profile = db.prepare('SELECT id FROM tax_profiles WHERE is_default = 1').get();
  const profileId = profile ? profile.id : null;

  const biri = db.prepare("SELECT id FROM categories WHERE name_en = 'Biriyani'").get()?.id;
  const chicken = db.prepare("SELECT id FROM categories WHERE name_en = 'Chicken'").get()?.id;
  const mutton = db.prepare("SELECT id FROM categories WHERE name_en = 'Mutton'").get()?.id;
  const fish = db.prepare("SELECT id FROM categories WHERE name_en = 'Fish & Sea Food'").get()?.id;
  const parotta = db.prepare("SELECT id FROM categories WHERE name_en = 'Parotta & Breads'").get()?.id;
  const drinks = db.prepare("SELECT id FROM categories WHERE name_en = 'Drinks & Desserts'").get()?.id;

  const items = [
    ['101', 'Chicken Biriyani', 'சிக்கன் பிரியாணி', biri, 180, 'Plate'],
    ['102', 'Mutton Biriyani', 'மட்டன் பிரியாணி', biri, 260, 'Plate'],
    ['103', 'Egg Biriyani', 'முட்டை பிரியாணி', biri, 130, 'Plate'],
    ['104', 'Kushka / Plain Biriyani', 'குஷ்கா / சாதா பிரியாணி', biri, 110, 'Plate'],
    ['201', 'Chicken 65', 'சிக்கன் 65', chicken, 160, 'Plate'],
    ['202', 'Chicken Chukka', 'சிக்கன் சுக்கா', chicken, 180, 'Plate'],
    ['203', 'Pepper Chicken', 'பெப்பர் சிக்கன்', chicken, 190, 'Plate'],
    ['204', 'Butter Chicken Masala', 'பட்டர் சிக்கன் மசாலா', chicken, 210, 'Portion'],
    ['301', 'Mutton Chukka', 'மட்டன் சுக்கா', mutton, 250, 'Plate'],
    ['302', 'Mutton Pepper Fry', 'மட்டன் பெப்பர் வறுவல்', mutton, 260, 'Plate'],
    ['401', 'Fish Fry (Vanjaram)', 'மீன் வறுவல் (வஞ்சரம்)', fish, 220, 'Plate'],
    ['402', 'Prawn Pepper Fry', 'இறால் மிளகு வறுவல்', fish, 240, 'Plate'],
    ['501', 'Parotta (2 Nos)', 'பரோட்டா (2 எண்)', parotta, 50, 'Nos'],
    ['502', 'Bun Parotta', 'பன் பரோட்டா', parotta, 40, 'Nos'],
    ['503', 'Kothu Parotta (Chicken)', 'கொத்து பரோட்டா (சிக்கன்)', parotta, 170, 'Plate'],
    ['504', 'Egg Veechu Parotta', 'முட்டை வீச்சு பரோட்டா', parotta, 60, 'Nos'],
    ['601', 'Fresh Lime Soda', 'எலுமிச்சை சோடா', drinks, 40, 'Cup'],
    ['602', 'Rose Milk', 'ரோஸ் மில்க்', drinks, 50, 'Cup'],
  ];

  const itemIns = db.prepare(
    `INSERT INTO items (code, name_en, name_ta, category_id, price, tax_profile_id, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  items.forEach((it) => itemIns.run(it[0], it[1], it[2], it[3], it[4], profileId, it[5]));
}

function seedTablesIfEmpty() {
  if (db.prepare('SELECT COUNT(*) as n FROM tables').get().n > 0) return;
  const ins = db.prepare('INSERT INTO tables (name, section, status) VALUES (?, ?, ?)');
  for (let i = 1; i <= 6; i++) ins.run(`T${i}`, 'AC Hall', 'free');
  for (let i = 7; i <= 14; i++) ins.run(`T${i}`, 'Non-AC Ground', 'free');
  for (let i = 15; i <= 18; i++) ins.run(`T${i}`, 'Roof Garden', 'free');
}

function seedWaitersIfEmpty() {
  if (db.prepare('SELECT COUNT(*) as n FROM waiters').get().n > 0) return;
  const ins = db.prepare('INSERT INTO waiters (name) VALUES (?)');
  ins.run('Suresh (W1)');
  ins.run('Karthik (W2)');
  ins.run('Mani (W3)');
  ins.run('Ramesh (W4)');
}

function seedShortcutsIfEmpty() {
  if (db.prepare('SELECT COUNT(*) as n FROM shortcuts').get().n > 0) return;
  const defaults = [
    ['help', 'F1'],
    ['newBill', 'F2'],
    ['searchItem', 'F3'],
    ['selectTable', 'F4'],
    ['holdBill', 'F5'],
    ['recallBill', 'F6'],
    ['customer', 'F7'],
    ['discount', 'F8'],
    ['payment', 'F9'],
    ['printBill', 'F10'],
    ['printKOT', 'F11'],
    ['reports', 'F12'],
    ['toggleLang', 'Control+L'],
    ['menuManager', 'Control+M'],
    ['excel', 'Control+E'],
    ['settings', 'Control+S'],
    ['backup', 'Control+B'],
    ['deleteLine', 'Control+D'],
    ['undoItem', 'Control+Z'],
    ['lock', 'Control+Q'],
    ['saveBill', 'Control+Enter'],
    ['deleteBill', 'Control+Shift+Delete'],
    ['closeBill', 'Control+W'],
    ['reprintBill', 'Control+P'],
    ['testPrint', 'Control+T'],
    ['nextTab', 'Control+Tab'],
    ['prevTab', 'Control+Shift+Tab'],
  ];
  const ins = db.prepare('INSERT INTO shortcuts (action_id, key_combo) VALUES (?, ?)');
  defaults.forEach(([a, k]) => ins.run(a, k));
}

function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach((r) => {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  });
  return out;
}

function resetSettingsToDefault(defaultsJson) {
  if (!defaultsJson) return;
  const tx = getDb().transaction(() => {
    getDb().prepare('DELETE FROM settings').run();
    const insert = getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaultsJson)) {
      insert.run(k, JSON.stringify(v));
    }
  });
  tx();
}

function audit(userId, action, detail = '') {
  try {
    getDb()
      .prepare('INSERT INTO audit_log (user_id, action, detail, date_time) VALUES (?, ?, ?, ?)')
      .run(userId || null, action, String(detail), new Date().toISOString());
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

// User CRUD
function getUsers() {
  return getDb().prepare('SELECT id, name, role, is_active FROM users ORDER BY id').all();
}

function saveUser(user) {
  const db = getDb();
  if (user.id) {
    if (user.pin) {
      const hash = bcrypt.hashSync(String(user.pin), 10);
      db.prepare('UPDATE users SET name = ?, pin_hash = ?, role = ?, is_active = ? WHERE id = ?').run(
        user.name,
        hash,
        user.role || 'cashier',
        user.is_active !== false ? 1 : 0,
        user.id
      );
    } else {
      db.prepare('UPDATE users SET name = ?, role = ?, is_active = ? WHERE id = ?').run(
        user.name,
        user.role || 'cashier',
        user.is_active !== false ? 1 : 0,
        user.id
      );
    }
    return { id: user.id };
  }

  const hash = bcrypt.hashSync(String(user.pin || '1234'), 10);
  const info = db
    .prepare('INSERT INTO users (name, pin_hash, role, is_active) VALUES (?, ?, ?, ?)')
    .run(user.name, hash, user.role || 'cashier', 1);
  return { id: info.lastInsertRowid };
}

function deleteUser(userId) {
  const users = getUsers();
  if (users.length <= 1) throw new Error('Cannot delete last user');
  getDb().prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  return { ok: true };
}

// Draft storage for crash recovery
function saveActiveDraft(tabId, tabName, payload) {
  getDb()
    .prepare(
      `INSERT INTO active_drafts (tab_id, tab_name, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tab_id) DO UPDATE SET tab_name = excluded.tab_name, payload = excluded.payload, updated_at = excluded.updated_at`
    )
    .run(tabId, tabName, JSON.stringify(payload), new Date().toISOString());
}

function removeActiveDraft(tabId) {
  getDb().prepare('DELETE FROM active_drafts WHERE tab_id = ?').run(tabId);
}

function getActiveDrafts() {
  const rows = getDb().prepare('SELECT * FROM active_drafts ORDER BY updated_at DESC').all();
  return rows.map((r) => {
    try {
      return { tabId: r.tab_id, tabName: r.tab_name, payload: JSON.parse(r.payload), updatedAt: r.updated_at };
    } catch {
      return { tabId: r.tab_id, tabName: r.tab_name, payload: null, updatedAt: r.updated_at };
    }
  });
}

function clearAllActiveDrafts() {
  getDb().prepare('DELETE FROM active_drafts').run();
}

module.exports = {
  initDb,
  getDb,
  getDbPath,
  getSetting,
  setSetting,
  getAllSettings,
  resetSettingsToDefault,
  audit,
  getUsers,
  saveUser,
  deleteUser,
  saveActiveDraft,
  removeActiveDraft,
  getActiveDrafts,
  clearAllActiveDrafts,
};
