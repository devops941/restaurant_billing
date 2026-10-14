const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth & Users
  login: (pin) => ipcRenderer.invoke('auth:login', pin),
  logout: () => ipcRenderer.invoke('auth:logout'),
  currentUser: () => ipcRenderer.invoke('auth:currentUser'),
  getUsers: () => ipcRenderer.invoke('users:list'),
  saveUser: (user) => ipcRenderer.invoke('users:save', user),
  deleteUser: (id) => ipcRenderer.invoke('users:delete', id),

  // Settings
  getSettings: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  setSettings: (obj) => ipcRenderer.invoke('settings:setMany', obj),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  exportSettingsBackup: () => ipcRenderer.invoke('settings:exportBackup'),
  importSettingsBackup: (path) => ipcRenderer.invoke('settings:importBackup', path),

  // Shortcuts
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  setShortcut: (actionId, combo) => ipcRenderer.invoke('shortcuts:set', actionId, combo),
  resetShortcuts: () => ipcRenderer.invoke('shortcuts:resetAll'),

  // Menu & Masters
  getCategories: () => ipcRenderer.invoke('menu:categories'),
  getItems: () => ipcRenderer.invoke('menu:items'),
  saveItem: (item) => ipcRenderer.invoke('menu:saveItem', item),
  deleteItem: (id) => ipcRenderer.invoke('menu:deleteItem', id),
  searchItems: (q, limit, catId) => ipcRenderer.invoke('menu:search', q, limit, catId),

  // Tables & Waiters
  getTables: () => ipcRenderer.invoke('tables:list'),
  createTable: (name, section) => ipcRenderer.invoke('tables:create', name, section),
  setTableStatus: (id, status) => ipcRenderer.invoke('tables:setStatus', id, status),
  releaseTable: (id) => ipcRenderer.invoke('tables:release', id),
  getWaiters: () => ipcRenderer.invoke('waiters:list'),
  createWaiter: (name) => ipcRenderer.invoke('waiters:create', name),

  // Billing
  nextBillNo: () => ipcRenderer.invoke('billing:nextBillNo'),
  previewBill: (payload) => ipcRenderer.invoke('billing:preview', payload),
  saveBill: (payload) => ipcRenderer.invoke('billing:save', payload),
  getBill: (id) => ipcRenderer.invoke('billing:get', id),
  cancelBill: (id, reason) => ipcRenderer.invoke('billing:cancel', id, reason),
  reprintBill: (id) => ipcRenderer.invoke('billing:reprint', id),
  holdBill: (label, payload) => ipcRenderer.invoke('billing:hold', label, payload),
  listHeldBills: () => ipcRenderer.invoke('billing:heldList'),
  recallHeldBill: (id) => ipcRenderer.invoke('billing:recall', id),

  // Drafts (Crash recovery)
  saveDraft: (tabId, name, payload) => ipcRenderer.invoke('drafts:save', tabId, name, payload),
  removeDraft: (tabId) => ipcRenderer.invoke('drafts:remove', tabId),
  getDrafts: () => ipcRenderer.invoke('drafts:get'),
  clearDrafts: () => ipcRenderer.invoke('drafts:clear'),

  // Tax Setup
  getTaxRates: () => ipcRenderer.invoke('tax:rates'),
  saveTaxRate: (rate) => ipcRenderer.invoke('tax:saveRate', rate),
  deleteTaxRate: (id) => ipcRenderer.invoke('tax:deleteRate', id),
  getTaxProfiles: () => ipcRenderer.invoke('tax:profiles'),
  saveTaxProfile: (profile) => ipcRenderer.invoke('tax:saveProfile', profile),
  exportTaxSettings: () => ipcRenderer.invoke('tax:exportSettings'),
  importTaxSettings: (path) => ipcRenderer.invoke('tax:importSettings', path),

  // Reports
  detailedReport: (from, to) => ipcRenderer.invoke('reports:detailed', from, to),
  exportDetailedReport: (from, to) => ipcRenderer.invoke('excel:exportDetailed', from, to),

  // File Dialogs
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),

  // Excel
  importMenu: (path) => ipcRenderer.invoke('excel:importMenu', path),
  validateBills: (path) => ipcRenderer.invoke('excel:validateBills', path),
  importBills: (path, mode) => ipcRenderer.invoke('excel:importBills', path, mode),
  exportDaily: (date) => ipcRenderer.invoke('excel:exportDaily', date),
  exportGst: (from, to) => ipcRenderer.invoke('excel:exportGst', from, to),

  // Backup
  backupNow: () => ipcRenderer.invoke('backup:now'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (path) => ipcRenderer.invoke('backup:restore', path),
  getPaths: () => ipcRenderer.invoke('paths:get'),
  setDataFolder: (folder) => ipcRenderer.invoke('paths:setDataFolder', folder),

  // Printing
  printBill: (id) => ipcRenderer.invoke('print:bill', id),
  printKot: (payload) => ipcRenderer.invoke('print:kot', payload),
  testPrint: () => ipcRenderer.invoke('print:test'),
  getPrinters: () => ipcRenderer.invoke('printer:list'),

  // Menu Action Events
  onAction: (cb) => {
    ipcRenderer.on('action', (_, action) => cb(action));
  },
});
