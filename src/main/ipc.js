const { ipcMain, dialog, BrowserWindow } = require('electron');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const {
  getDb,
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
} = require('./db');
const billing = require('./billing');
const tax = require('./tax');
const excel = require('./excel');
const backup = require('./backup');
const print = require('./print');
const { loadAppConfig, getDefaultDataFolder } = require('./config');

let currentUser = null;
let mainWindow = null;

function setMainWindow(win) {
  mainWindow = win;
}

function registerIpc() {
  // Authentication
  ipcMain.handle('auth:login', (_, pin) => {
    const users = getDb().prepare('SELECT * FROM users WHERE is_active = 1').all();
    for (const u of users) {
      if (bcrypt.compareSync(String(pin), u.pin_hash)) {
        currentUser = { id: u.id, name: u.name, role: u.role };
        audit(u.id, 'login', u.name);
        return { ok: true, user: currentUser };
      }
    }
    return { ok: false, error: 'Invalid PIN' };
  });

  ipcMain.handle('auth:logout', () => {
    if (currentUser) audit(currentUser.id, 'logout', '');
    currentUser = null;
    return { ok: true };
  });

  ipcMain.handle('auth:currentUser', () => currentUser);

  // User management (Admin only)
  ipcMain.handle('users:list', () => getUsers());
  ipcMain.handle('users:save', (_, userObj) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const res = saveUser(userObj);
    audit(currentUser.id, 'user_save', JSON.stringify({ name: userObj.name, role: userObj.role }));
    return res;
  });
  ipcMain.handle('users:delete', (_, userId) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const res = deleteUser(userId);
    audit(currentUser.id, 'user_delete', String(userId));
    return res;
  });

  // Settings
  ipcMain.handle('settings:get', (_, key) => {
    if (key) return getSetting(key);
    return getAllSettings();
  });

  ipcMain.handle('settings:set', (_, key, value) => {
    if (currentUser?.role !== 'admin' && ['gst_enabled', 'data_folder', 'price_mode'].includes(key)) {
      throw new Error('Admin only');
    }
    const old = getSetting(key);
    setSetting(key, value);
    audit(currentUser?.id, 'setting_change', JSON.stringify({ key, old, value }));
    return { ok: true };
  });

  ipcMain.handle('settings:setMany', (_, obj) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    for (const [k, v] of Object.entries(obj || {})) {
      setSetting(k, v);
    }
    audit(currentUser?.id, 'settings_bulk', JSON.stringify(Object.keys(obj || {})));
    return { ok: true };
  });

  ipcMain.handle('settings:reset', () => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const defPath = path.join(__dirname, '../../defaults.json');
    if (fs.existsSync(defPath)) {
      const defs = JSON.parse(fs.readFileSync(defPath, 'utf8'));
      resetSettingsToDefault(defs);
      audit(currentUser?.id, 'settings_reset', 'Reset to defaults');
      return { ok: true };
    }
    return { ok: false, error: 'defaults.json not found' };
  });

  ipcMain.handle('settings:exportBackup', async () => {
    const folder = getSetting('export_folder') || getDefaultDataFolder();
    const fp = path.join(folder, 'Settings_Backup.json');
    const all = getAllSettings();
    fs.writeFileSync(fp, JSON.stringify(all, null, 2), 'utf8');
    audit(currentUser?.id, 'settings_export', fp);
    return { ok: true, path: fp };
  });

  ipcMain.handle('settings:importBackup', async (_, filePath) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const fp = filePath || (await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }).then((x) => x.filePaths[0]));
    if (!fp) return { cancelled: true };

    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const [k, v] of Object.entries(data)) {
      setSetting(k, v);
    }
    audit(currentUser?.id, 'settings_import', fp);
    return { ok: true, count: Object.keys(data).length };
  });

  // Shortcuts
  ipcMain.handle('shortcuts:get', () => {
    return getDb().prepare('SELECT action_id, key_combo FROM shortcuts ORDER BY action_id').all();
  });

  ipcMain.handle('shortcuts:set', (_, actionId, combo) => {
    getDb()
      .prepare(
        'INSERT INTO shortcuts (action_id, key_combo) VALUES (?, ?) ON CONFLICT(action_id) DO UPDATE SET key_combo = excluded.key_combo'
      )
      .run(actionId, combo);
    return { ok: true };
  });

  ipcMain.handle('shortcuts:resetAll', () => {
    const db = getDb();
    db.prepare('DELETE FROM shortcuts').run();
    // Re-seed defaults without creating a new DB connection
    const defaults = [
      ['help', 'F1'], ['newBill', 'F2'], ['searchItem', 'F3'], ['selectTable', 'F4'],
      ['holdBill', 'F5'], ['recallBill', 'F6'], ['customer', 'F7'], ['discount', 'F8'],
      ['payment', 'F9'], ['printBill', 'F10'], ['printKOT', 'F11'], ['reports', 'F12'],
      ['toggleLang', 'Control+L'], ['menuManager', 'Control+M'], ['excel', 'Control+E'],
      ['settings', 'Control+S'], ['backup', 'Control+B'], ['deleteLine', 'Control+D'],
      ['undoItem', 'Control+Z'], ['lock', 'Control+Q'], ['saveBill', 'Control+Enter'],
      ['deleteBill', 'Control+Shift+Delete'], ['closeBill', 'Control+W'],
      ['reprintBill', 'Control+P'], ['testPrint', 'Control+T'],
      ['nextTab', 'Control+Tab'], ['prevTab', 'Control+Shift+Tab'],
    ];
    const ins = db.prepare('INSERT INTO shortcuts (action_id, key_combo) VALUES (?, ?)');
    defaults.forEach(([a, k]) => ins.run(a, k));
    return { ok: true };
  });

  // Menu items & Categories
  ipcMain.handle('menu:categories', () => {
    return getDb().prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name_en').all();
  });

  ipcMain.handle('menu:items', () => {
    return getDb()
      .prepare(
        `SELECT i.*, c.name_en as category_en, c.name_ta as category_ta, tp.name as tax_profile_name
         FROM items i
         LEFT JOIN categories c ON c.id = i.category_id
         LEFT JOIN tax_profiles tp ON tp.id = i.tax_profile_id
         WHERE i.is_active = 1 ORDER BY i.code`
      )
      .all();
  });

  ipcMain.handle('menu:saveItem', (_, item) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const db = getDb();
    if (item.id) {
      db.prepare(
        `UPDATE items SET code=?, name_en=?, name_ta=?, category_id=?, price=?, tax_profile_id=?, unit=?, hsn_code=?, is_active=? WHERE id=?`
      ).run(
        item.code,
        item.name_en,
        item.name_ta || '',
        item.category_id || null,
        Number(item.price) || 0,
        item.tax_profile_id || null,
        item.unit || 'Plate',
        item.hsn_code || '',
        item.is_active !== false ? 1 : 0,
        item.id
      );
      audit(currentUser?.id, 'item_update', item.code);
      return { id: item.id };
    }
    const info = db
      .prepare(
        `INSERT INTO items (code, name_en, name_ta, category_id, price, tax_profile_id, unit, hsn_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.code,
        item.name_en,
        item.name_ta || '',
        item.category_id || null,
        Number(item.price) || 0,
        item.tax_profile_id || null,
        item.unit || 'Plate',
        item.hsn_code || ''
      );
    audit(currentUser?.id, 'item_create', item.code);
    return { id: info.lastInsertRowid };
  });

  ipcMain.handle('menu:deleteItem', (_, id) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    getDb().prepare('UPDATE items SET is_active = 0 WHERE id = ?').run(id);
    audit(currentUser?.id, 'item_deactivate', String(id));
    return { ok: true };
  });

  ipcMain.handle('menu:search', (_, q, limit, categoryId) => billing.searchItems(q, limit, categoryId));

  // Tables & Waiters
  ipcMain.handle('tables:list', () => getDb().prepare('SELECT * FROM tables ORDER BY name').all());
  ipcMain.handle('tables:create', (_, name, section) => {
    const res = billing.createTable(name, section);
    audit(currentUser?.id, 'table_create', name);
    return res;
  });
  ipcMain.handle('tables:setStatus', (_, id, status) => {
    getDb().prepare('UPDATE tables SET status = ? WHERE id = ?').run(status, id);
    return { ok: true };
  });
  ipcMain.handle('tables:release', (_, tableId) => {
    getDb().prepare("UPDATE tables SET status = 'free', current_bill_id = NULL WHERE id = ?").run(tableId);
    return { ok: true };
  });

  ipcMain.handle('waiters:list', () => getDb().prepare('SELECT * FROM waiters WHERE is_active = 1 ORDER BY name').all());
  ipcMain.handle('waiters:create', (_, name) => {
    const res = billing.createWaiter(name);
    audit(currentUser?.id, 'waiter_create', name);
    return res;
  });

  // Billing
  ipcMain.handle('billing:nextBillNo', () => billing.nextBillNo());
  ipcMain.handle('billing:preview', (_, payload) => billing.previewTotals(payload));
  ipcMain.handle('billing:save', (_, payload) => {
    if (!currentUser) throw new Error('Not logged in');
    return billing.saveBill(payload, currentUser.id);
  });
  ipcMain.handle('billing:get', (_, id) => billing.getBill(id));
  ipcMain.handle('billing:cancel', (_, id, reason) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only (Only admin can cancel bills)');
    return billing.cancelBill(id, reason, currentUser.id);
  });
  ipcMain.handle('billing:reprint', (_, id) => {
    audit(currentUser?.id, 'bill_reprint', String(id));
    return { ok: true };
  });

  ipcMain.handle('billing:hold', (_, label, payload) => {
    if (!currentUser) throw new Error('Not logged in');
    return billing.holdBill(label, payload, currentUser.id);
  });
  ipcMain.handle('billing:heldList', () => billing.listHeldBills());
  ipcMain.handle('billing:recall', (_, id) => billing.recallHeldBill(id));

  // Drafts (Crash recovery)
  ipcMain.handle('drafts:save', (_, tabId, tabName, payload) => {
    saveActiveDraft(tabId, tabName, payload);
    return { ok: true };
  });
  ipcMain.handle('drafts:remove', (_, tabId) => {
    removeActiveDraft(tabId);
    return { ok: true };
  });
  ipcMain.handle('drafts:get', () => getActiveDrafts());
  ipcMain.handle('drafts:clear', () => {
    clearAllActiveDrafts();
    return { ok: true };
  });

  // Dynamic Tax Setup
  ipcMain.handle('tax:rates', () => tax.getAllTaxRates());
  ipcMain.handle('tax:saveRate', (_, rate) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const res = tax.saveTaxRate(rate);
    audit(currentUser.id, 'tax_rate_save', rate.name);
    return res;
  });
  ipcMain.handle('tax:deleteRate', (_, rateId) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const res = tax.deleteTaxRate(rateId);
    audit(currentUser.id, 'tax_rate_delete', String(rateId));
    return res;
  });

  ipcMain.handle('tax:profiles', () => tax.getAllTaxProfiles());
  ipcMain.handle('tax:saveProfile', (_, profile) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const res = tax.saveTaxProfile(profile);
    audit(currentUser.id, 'tax_profile_save', profile.name);
    return res;
  });
  ipcMain.handle('tax:exportSettings', async () => {
    const folder = getSetting('export_folder') || getDefaultDataFolder();
    const fp = path.join(folder, 'Tax_Settings.xlsx');
    return tax.exportTaxSettings(fp);
  });
  ipcMain.handle('tax:importSettings', async (_, filePath) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    const fp = filePath || (await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    }).then((x) => x.filePaths[0]));
    if (!fp) return { cancelled: true };
    return tax.importTaxSettings(fp);
  });

  // Reports
  ipcMain.handle('reports:detailed', (_, fromDate, toDate) => billing.getDetailedReport(fromDate, toDate));
  ipcMain.handle('excel:exportDetailed', async (_, fromDate, toDate) => {
    const folder = getSetting('export_folder') || getDefaultDataFolder();
    const fp = path.join(folder, `Report_${fromDate}_to_${toDate}.xlsx`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    return excel.exportDetailedReport(fp, fromDate, toDate, getSetting('default_language', 'en'));
  });

  // File Dialogs
  ipcMain.handle('dialog:openFile', async (_, filters) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_, defaultName) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'export.xlsx',
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // Excel Menu and Bills Import
  ipcMain.handle('excel:importMenu', async (_, filePath) => {
    const fp = filePath || (await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] }).then((x) => x.filePaths[0]));
    if (!fp) return { cancelled: true };
    return excel.importMenuFromFile(fp);
  });

  ipcMain.handle('excel:validateBills', async (_, filePath) => {
    const fp = filePath || (await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] }).then((x) => x.filePaths[0]));
    if (!fp) return { cancelled: true };
    const res = await excel.validateBillsFile(fp);
    return { filePath: fp, ...res };
  });

  ipcMain.handle('excel:importBills', async (_, filePath, duplicateMode) => {
    if (!filePath) return { cancelled: true };
    return excel.importBillsFromFile(filePath, currentUser?.id, duplicateMode || 'skip');
  });

  ipcMain.handle('excel:exportDaily', async (_, dateStr) => {
    const folder = getSetting('export_folder') || getDefaultDataFolder();
    const fp = path.join(folder, `Daily_Sales_${dateStr}.xlsx`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    return excel.exportDailySales(fp, dateStr, getSetting('default_language', 'en'));
  });

  ipcMain.handle('excel:exportGst', async (_, from, to) => {
    const folder = getSetting('export_folder') || getDefaultDataFolder();
    const fp = path.join(folder, `GST_${from}_${to}.xlsx`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    return excel.exportGstSummary(fp, from, to);
  });

  // Backup & Restore
  ipcMain.handle('backup:now', () => {
    if (!currentUser) throw new Error('Not logged in');
    return backup.createBackup(currentUser.id);
  });

  ipcMain.handle('backup:list', () => backup.listBackups());

  ipcMain.handle('backup:restore', async (_, backupPath) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    return backup.restoreBackup(backupPath, currentUser.id);
  });

  ipcMain.handle('paths:get', () => {
    const appCfg = loadAppConfig();
    return {
      dataFolder: appCfg.dataFolder || getDefaultDataFolder(),
      defaultDataFolder: getDefaultDataFolder(),
      backupFolder: backup.getBackupFolder(),
      exportFolder: getSetting('export_folder') || getDefaultDataFolder(),
      usbFolder: getSetting('usb_backup_folder', ''),
    };
  });

  ipcMain.handle('paths:setDataFolder', (_, folder) => {
    if (currentUser?.role !== 'admin') throw new Error('Admin only');
    return backup.setDataFolder(folder, currentUser.id);
  });

  // Printer
  ipcMain.handle('printer:list', async () => {
    if (mainWindow) {
      return mainWindow.webContents.getPrintersAsync();
    }
    return [];
  });

  async function doPrint(html, silent) {
    const w = new BrowserWindow({
      show: false,
      width: 400,
      height: 800,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      // Small delay to allow page render to complete before printing
      await new Promise((res) => setTimeout(res, 300));
      return await print.printHtml(w, html, silent);
    } finally {
      w.close();
    }
  }

  ipcMain.handle('print:bill', async (_, billId) => {
    try {
      const bill = billing.getBill(billId);
      if (!bill) return { ok: false, error: 'Bill not found' };
      const settings = getAllSettings();
      const html = print.buildBillHtml(bill, settings, getSetting('bill_language', 'both'));
      const res = await doPrint(html, true);
      audit(currentUser?.id, 'print_bill', bill.bill_no);
      return res;
    } catch (err) {
      console.warn('Print bill error:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('print:kot', async (_, kotPayload) => {
    try {
      const html = print.buildKotHtml(kotPayload);
      const res = await doPrint(html, true);
      audit(currentUser?.id, 'print_kot', JSON.stringify(kotPayload.table || ''));
      return res;
    } catch (err) {
      console.warn('Print KOT error:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('print:test', async () => {
    const settings = getAllSettings();
    const html = print.buildBillHtml(
      {
        bill_no: 'TEST-000001',
        date_time: new Date().toISOString(),
        order_type: 'Dine-in (Test)',
        cashier_name: currentUser?.name || 'Admin',
        items: [
          { name_snapshot: 'Chicken Biriyani / சிக்கன் பிரியாணி', qty: 2, unit: 'Plate', rate: 180, amount: 360 },
          { name_snapshot: 'Fish Fry / மீன் வறுவல்', qty: 1, unit: 'Plate', rate: 220, amount: 220 },
        ],
        subtotal: 580,
        discount: 0,
        discount_percent: 0,
        taxes: [
          { component_name: 'CGST', percent: 2.5, tax_amount: 14.5 },
          { component_name: 'SGST', percent: 2.5, tax_amount: 14.5 },
        ],
        round_off: 0,
        total: 609,
        payment_mode: 'Cash',
      },
      settings,
      settings.bill_language || 'both'
    );
    const res = await doPrint(html, false);
    return res;
  });
}

module.exports = { registerIpc, setMainWindow };
