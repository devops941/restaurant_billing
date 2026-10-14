const fs = require('fs');
const path = require('path');
const { getDb, getDbPath, getSetting, audit, initDb } = require('./db');
const { resolveDataFolder, loadAppConfig, saveAppConfig } = require('./config');

function getBackupFolder() {
  const fromSettings = getSetting('backup_folder', '');
  if (fromSettings && fs.existsSync(fromSettings)) return fromSettings;
  return path.join(resolveDataFolder(), 'Backups');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function createBackup(userId, label = 'manual') {
  const db = getDb();
  const destDir = getBackupFolder();
  ensureDir(destDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(destDir, `restaurant_${label}_${stamp}.db`);

  // Use better-sqlite3 native backup to ensure WAL writes are cleanly flushed
  if (typeof db.backup === 'function') {
    await db.backup(dest);
  } else {
    // Fallback if backup API unavailable
    db.pragma('wal_checkpoint(TRUNCATE)');
    const src = getDbPath();
    fs.copyFileSync(src, dest);
  }

  // Also check if USB backup is configured
  const usbPath = getSetting('usb_backup_folder', '');
  if (usbPath && fs.existsSync(usbPath)) {
    try {
      const usbDest = path.join(usbPath, `restaurant_${label}_${stamp}.db`);
      fs.copyFileSync(dest, usbDest);
    } catch (err) {
      console.warn('USB backup failed:', err);
    }
  }

  pruneOldBackups(destDir);
  audit(userId, 'backup', dest);
  return { path: dest };
}

function pruneOldBackups(dir) {
  const keep = getSetting('backup_keep_count', 30);
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  files.slice(keep).forEach((f) => {
    try {
      fs.unlinkSync(path.join(dir, f.name));
    } catch {
      /* ignore */
    }
  });
}

async function restoreBackup(backupPath, userId) {
  if (!fs.existsSync(backupPath)) throw new Error('Backup file not found');

  const dest = getDbPath();
  const db = getDb();

  // Checkpoint active db
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }

  const safety = `${dest}.before_restore_${Date.now()}`;
  if (fs.existsSync(dest)) fs.copyFileSync(dest, safety);

  // Copy backup over destination
  fs.copyFileSync(backupPath, dest);

  // Clean up any stale wal/shm files so restored db opens cleanly
  const wal = `${dest}-wal`;
  const shm = `${dest}-shm`;
  if (fs.existsSync(wal)) {
    try {
      fs.unlinkSync(wal);
    } catch {}
  }
  if (fs.existsSync(shm)) {
    try {
      fs.unlinkSync(shm);
    } catch {}
  }

  audit(userId, 'restore', backupPath);
  return { ok: true, safetyCopy: safety, requiresRestart: true };
}

function listBackups() {
  const dir = getBackupFolder();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = path.join(dir, f);
      return { name: f, path: full, size: fs.statSync(full).size, mtime: fs.statSync(full).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function setDataFolder(newFolder, userId) {
  if (!fs.existsSync(newFolder)) throw new Error('Folder does not exist');
  const testFile = path.join(newFolder, '.write_test');
  fs.writeFileSync(testFile, 'ok');
  fs.unlinkSync(testFile);

  const oldPath = getDbPath();
  const newDb = path.join(newFolder, 'restaurant.db');
  if (oldPath !== newDb && fs.existsSync(oldPath)) {
    ensureDir(newFolder);
    const db = getDb();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {}
    fs.copyFileSync(oldPath, newDb);
  }

  const cfg = loadAppConfig();
  cfg.dataFolder = newFolder;
  saveAppConfig(cfg);

  try {
    const { setSetting } = require('./db');
    setSetting('data_folder', newFolder);
  } catch {}

  audit(userId, 'data_folder_change', newFolder);
  return { ok: true, requiresRestart: true };
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  getBackupFolder,
  setDataFolder,
};
