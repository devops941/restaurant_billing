const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

exports.default = async function (context) {
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) return;

  const tempExtractDir = path.join(context.appOutDir, 'resources', 'app-extracted-temp');
  if (fs.existsSync(tempExtractDir)) fs.rmSync(tempExtractDir, { recursive: true, force: true });

  asar.extractAll(asarPath, tempExtractDir);

  const srcNodeModules = path.join(__dirname, '../node_modules');
  const targetNodeModules = path.join(tempExtractDir, 'node_modules');
  const excluded = ['electron', 'electron-builder', '@electron', 'app-builder-bin', '7zip-bin'];

  if (fs.existsSync(srcNodeModules)) {
    const pkgs = fs.readdirSync(srcNodeModules);
    for (const pkg of pkgs) {
      if (excluded.includes(pkg)) continue;
      const srcPkg = path.join(srcNodeModules, pkg);
      const targetPkg = path.join(targetNodeModules, pkg);
      if (!fs.existsSync(targetPkg)) {
        try {
          fs.cpSync(srcPkg, targetPkg, { recursive: true });
        } catch (e) {
          console.warn(`Could not copy ${pkg}:`, e.message);
        }
      }
    }
  }

  // Repack asar cleanly
  fs.rmSync(asarPath, { force: true });
  await asar.createPackage(tempExtractDir, asarPath);
  fs.rmSync(tempExtractDir, { recursive: true, force: true });
  console.log('✓ Successfully injected all production node_modules into app.asar');
};
