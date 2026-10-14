const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDb, getSetting } = require('./db');
const { registerIpc, setMainWindow } = require('./ipc');
const { createBackup } = require('./backup');
const { ensureTemplates } = require('./excel');
const { loadAppConfig, getDefaultDataFolder, saveAppConfig } = require('./config');

let mainWindow = null;
let autoBackupTimer = null;

function loadDefaults() {
  const p = path.join(app.getAppPath(), 'defaults.json');
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'Restaurant Billing | உணவக பில்லிங்',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setMainWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Bill (F2)', accelerator: 'F2', click: () => mainWindow?.webContents.send('action', 'newBill') },
        { label: 'Save Bill (Ctrl+Enter)', accelerator: 'CmdOrCtrl+Enter', click: () => mainWindow?.webContents.send('action', 'saveBill') },
        { label: 'Excel Centre (Ctrl+E)', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('action', 'excel') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Delete Selected Line (Ctrl+D)', accelerator: 'CmdOrCtrl+D', click: () => mainWindow?.webContents.send('action', 'deleteLine') },
        { label: 'Undo Item (Ctrl+Z)', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('action', 'undoItem') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Billing Screen (F2)', click: () => mainWindow?.webContents.send('action', 'newBill') },
        { label: 'Tables (F4)', accelerator: 'F4', click: () => mainWindow?.webContents.send('action', 'selectTable') },
        { label: 'Menu Manager (Ctrl+M)', accelerator: 'CmdOrCtrl+M', click: () => mainWindow?.webContents.send('action', 'menuManager') },
        { label: 'Reports (F12)', accelerator: 'F12', click: () => mainWindow?.webContents.send('action', 'reports') },
        { label: 'Settings (Ctrl+S)', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('action', 'settings') },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Switch Tamil / English (Ctrl+L)', accelerator: 'CmdOrCtrl+L', click: () => mainWindow?.webContents.send('action', 'toggleLang') },
        { label: 'Backup Now (Ctrl+B)', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('action', 'backup') },
        { label: 'Test Thermal Print (Ctrl+T)', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.send('action', 'testPrint') },
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Shortcuts (F1)', accelerator: 'F1', click: () => mainWindow?.webContents.send('action', 'help') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function startAutoBackupScheduler() {
  // Check every 30 minutes if current time matches auto_backup_time (default: 23:00)
  autoBackupTimer = setInterval(() => {
    try {
      const targetTime = getSetting('auto_backup_time', '23:00');
      const now = new Date();
      const currentHhMm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (currentHhMm === targetTime) {
        createBackup(null, 'daily_auto');
      }
    } catch (e) {
      console.warn('Auto backup check failed:', e);
    }
  }, 30 * 60 * 1000);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const cfg = loadAppConfig();
    if (!cfg.dataFolder) {
      cfg.dataFolder = getDefaultDataFolder();
      saveAppConfig(cfg);
    }

    const defaults = loadDefaults();
    initDb(defaults);

    try {
      ensureTemplates(path.join(app.getAppPath(), 'templates'));
    } catch (err) {
      console.warn('Template generation warning:', err);
    }

    registerIpc();
    buildAppMenu();
    createWindow();
    startAutoBackupScheduler();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  try {
    createBackup(null, 'exit');
  } catch {
    /* ignore backup errors on exit */
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
