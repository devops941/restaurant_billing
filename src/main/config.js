const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const APP_CONFIG_NAME = 'config.json';

function getUserDataPath() {
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData');
  }
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, 'restaurant-billing')
    : path.join(process.cwd(), 'data');
}

function getAppConfigPath() {
  return path.join(getUserDataPath(), APP_CONFIG_NAME);
}

function loadAppConfig() {
  const configPath = getAppConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveAppConfig(config) {
  const configPath = getAppConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function getDefaultDataFolder() {
  const dDrive = 'D:\\RestaurantBilling\\Data';
  if (process.platform === 'win32' && fs.existsSync('D:\\')) {
    return dDrive;
  }
  return path.join(process.env.ProgramData || getUserDataPath(), 'RestaurantBilling', 'Data');
}

function resolveDataFolder() {
  const appConfig = loadAppConfig();
  if (appConfig.dataFolder && fs.existsSync(appConfig.dataFolder)) {
    return appConfig.dataFolder;
  }
  return getDefaultDataFolder();
}

module.exports = {
  getAppConfigPath,
  loadAppConfig,
  saveAppConfig,
  getDefaultDataFolder,
  resolveDataFolder,
};
