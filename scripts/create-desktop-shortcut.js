const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Create Launch_Restaurant_Billing.bat
const batContent = `@echo off
cd /d "D:\\restaurant_billing"
start "" "node_modules\\electron\\dist\\electron.exe" .
exit
`;
const batPath = path.join(__dirname, '../Launch_Restaurant_Billing.bat');
fs.writeFileSync(batPath, batContent, 'utf8');

// 2. Create VBS launcher (runs without black console window)
const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\\restaurant_billing"
WshShell.Run """D:\\restaurant_billing\\node_modules\\electron\\dist\\electron.exe"" .", 1, False
`;
const vbsPath = path.join(__dirname, '../Launch_Restaurant_Billing.vbs');
fs.writeFileSync(vbsPath, vbsContent, 'utf8');

// 3. Create Desktop shortcut pointing to the launcher
const userProfile = process.env.USERPROFILE || 'C:\\Users\\user';
const desktopPath = path.join(userProfile, 'Desktop');

const psScript = [
  `$ws = New-Object -ComObject WScript.Shell`,
  `$sc = $ws.CreateShortcut('${path.join(desktopPath, 'Restaurant Billing POS.lnk').replace(/\\/g, '\\\\')}')`,
  `$sc.TargetPath = 'wscript.exe'`,
  `$sc.Arguments = '""${vbsPath.replace(/\\/g, '\\\\')}""'`,
  `$sc.WorkingDirectory = 'D:\\\\restaurant_billing'`,
  `$sc.Description = 'Restaurant Billing POS'`,
  `$sc.Save()`
].join('; ');

try {
  execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: 'inherit' });
  console.log('✓ Desktop Shortcut created successfully at:', path.join(desktopPath, 'Restaurant Billing POS.lnk'));
} catch (e) {
  console.warn('Could not create shortcut:', e.message);
}
