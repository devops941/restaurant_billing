# Restaurant Billing (Electron)

Offline-first, keyboard-driven billing desktop app for non-veg restaurants (Tamil + English), as specified in the project plan PDF.

## Quick start

```bash
cd d:\restaurant_billing
npm install
npm start
```

**Default login:** Admin PIN `1234`, Cashier PIN `0000`

## Features implemented

- Electron shell (contextIsolation, preload API)
- SQLite (`better-sqlite3`) with WAL, full schema, seed menu/tax/tables
- Excel-style billing grid with item search (code / English / Tamil)
- Dynamic GST profiles and bill totals
- Hold / recall bills, tables view, KOT and bill print (HTML → thermal)
- Excel menu import, bill import, daily sales & GST export
- Settings (shop, tax view, paths, shortcuts list)
- Backup on exit + manual backup (`Ctrl+B`)
- Tamil/English UI (`locales/`, `Ctrl+L`)
- NSIS installer config (`electron-builder.yml`)

## Data location

Default: `D:\RestaurantBilling\Data` (falls back to ProgramData if `D:` is missing). Config: `%APPDATA%\restaurant-billing\config.json`.

## Build installer

```bash
npm run build
```

## Excel templates

See `templates/` for column layouts matching the plan (Menu_Template, Bill_Entry_Template).
