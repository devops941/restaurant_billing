const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { getDb, getSetting } = require('./db');
const { saveBill, nextBillNo, getDetailedReport } = require('./billing');

async function importMenuFromFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Empty workbook');

  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell((cell, col) => {
    headers[String(cell.value || '').trim()] = col;
  });

  const required = ['Code', 'Category_EN', 'Item_EN', 'Price'];
  for (const h of required) {
    if (!headers[h]) throw new Error(`Missing required column: ${h}`);
  }

  const db = getDb();
  const errors = [];
  const preview = [];

  const getProfileId = (taxProfileCell) => {
    const val = taxProfileCell != null ? String(taxProfileCell).trim() : '';
    if (!val) {
      const def = db.prepare('SELECT id FROM tax_profiles WHERE is_default = 1').get();
      return def?.id || null;
    }
    const byName = db.prepare('SELECT id FROM tax_profiles WHERE name = ?').get(val);
    if (byName) return byName.id;
    const num = parseFloat(val);
    if (!Number.isNaN(num)) {
      const profiles = db.prepare('SELECT id FROM tax_profiles').all();
      for (const p of profiles) {
        const rates = db
          .prepare(
            `SELECT SUM(tr.percent) as total FROM tax_profile_rates tpr
             JOIN tax_rates tr ON tr.id = tpr.tax_rate_id WHERE tpr.profile_id = ?`
          )
          .get(p.id);
        if (rates && Math.abs(rates.total - num) < 0.01) return p.id;
      }
    }
    return null;
  };

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = String(row.getCell(headers.Code).value || '').trim();
    if (!code) return;

    const categoryEn = String(row.getCell(headers.Category_EN).value || '').trim();
    const categoryTa = headers.Category_TA
      ? String(row.getCell(headers.Category_TA).value || '').trim()
      : '';
    const itemEn = String(row.getCell(headers.Item_EN).value || '').trim();
    const itemTa = headers.Item_TA ? String(row.getCell(headers.Item_TA).value || '').trim() : '';
    const price = parseFloat(row.getCell(headers.Price).value) || 0;
    const unit = headers.Unit ? String(row.getCell(headers.Unit).value || 'Plate').trim() : 'Plate';
    const taxCell = headers.Tax_Profile ? row.getCell(headers.Tax_Profile).value : null;
    const profileId = getProfileId(taxCell);

    const rowErr = [];
    if (!itemEn) rowErr.push('Item name required (பொருள் பெயர் தேவை)');
    if (price <= 0) rowErr.push('Invalid price (விலை தவறானது)');
    if (profileId === null && taxCell) rowErr.push(`Unknown tax profile: ${taxCell}`);

    preview.push({ row: rowNumber, code, itemEn, price, unit, errors: rowErr });
    if (rowErr.length) {
      errors.push({ row: rowNumber, code, messages: rowErr });
      return;
    }

    let cat = db.prepare('SELECT id FROM categories WHERE name_en = ?').get(categoryEn);
    if (!cat && categoryEn) {
      const info = db
        .prepare('INSERT INTO categories (name_en, name_ta) VALUES (?, ?)')
        .run(categoryEn, categoryTa || categoryEn);
      cat = { id: info.lastInsertRowid };
    }

    const existing = db.prepare('SELECT id FROM items WHERE code = ?').get(code);
    if (existing) {
      db.prepare(
        `UPDATE items SET name_en=?, name_ta=?, category_id=?, price=?, tax_profile_id=?, unit=?, is_active=1 WHERE code=?`
      ).run(itemEn, itemTa, cat?.id || null, price, profileId, unit, code);
    } else {
      db.prepare(
        `INSERT INTO items (code, name_en, name_ta, category_id, price, tax_profile_id, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(code, itemEn, itemTa, cat?.id || null, price, profileId, unit);
    }
  });

  return { imported: preview.length - errors.length, errors, preview };
}

async function validateBillsFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Empty workbook');

  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell((cell, col) => {
    headers[String(cell.value || '').trim()] = col;
  });

  const required = ['Bill_No', 'Item_Code', 'Qty'];
  for (const h of required) {
    if (!headers[h]) throw new Error(`Missing required column: ${h}`);
  }

  const groups = new Map();
  const errors = [];
  const db = getDb();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const billNo = String(row.getCell(headers.Bill_No).value || '').trim();
    const itemCode = String(row.getCell(headers.Item_Code).value || '').trim();
    if (!billNo && !itemCode) return;

    const rowErrors = [];
    if (!billNo) rowErrors.push('Missing Bill_No');
    if (!itemCode) rowErrors.push('Missing Item_Code');

    const dateVal = headers.Date ? row.getCell(headers.Date).value : new Date();
    const qty = parseFloat(row.getCell(headers.Qty).value) || 0;
    const rateOpt = headers['Rate (optional)'] ? parseFloat(row.getCell(headers['Rate (optional)']).value) : 0;
    const discount = headers.Discount ? parseFloat(row.getCell(headers.Discount).value) || 0 : 0;
    const payment = headers.Payment_Mode ? String(row.getCell(headers.Payment_Mode).value || 'Cash').trim() : 'Cash';
    const tableType = headers['Table/Type'] ? String(row.getCell(headers['Table/Type']).value || 'Dine-in').trim() : 'Dine-in';

    if (qty <= 0) rowErrors.push('Qty must be greater than 0');

    const item = db.prepare('SELECT * FROM items WHERE code = ?').get(itemCode);
    if (!item) {
      rowErrors.push(`Unknown item code: ${itemCode}`);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, billNo, itemCode, messages: rowErrors });
      return;
    }

    const isoDate = normalizeDate(dateVal);
    const dateKey = isoDate.slice(0, 10);
    const key = `${billNo}|${dateKey}`;

    if (!groups.has(key)) {
      // Check if duplicate in database
      const existingInDb = db
        .prepare("SELECT id FROM bills WHERE bill_no = ? AND substr(date_time, 1, 10) = ? AND status != 'cancelled'")
        .get(billNo, dateKey);

      groups.set(key, {
        bill_no: billNo,
        date_time: isoDate,
        order_type: tableType,
        payment_mode: payment,
        discount,
        is_duplicate: !!existingInDb,
        existing_id: existingInDb?.id || null,
        lines: [],
      });
    }

    groups.get(key).lines.push({
      item_id: item.id,
      name_snapshot: item.name_en,
      category_name: '',
      qty,
      rate: rateOpt > 0 ? rateOpt : item.price,
      unit: item.unit,
    });
  });

  let duplicateCount = 0;
  for (const [, bill] of groups) {
    if (bill.is_duplicate) duplicateCount++;
  }

  return {
    totalBills: groups.size,
    duplicateCount,
    errorCount: errors.length,
    errors,
    bills: Array.from(groups.values()),
  };
}

async function importBillsFromFile(filePath, userId, duplicateMode = 'skip') {
  const validation = await validateBillsFile(filePath);
  if (validation.errorCount > 0 && validation.totalBills === 0) {
    return { ...validation, saved: 0 };
  }

  const db = getDb();
  let saved = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const bill of validation.bills) {
      let finalBillNo = bill.bill_no;

      if (bill.is_duplicate) {
        if (duplicateMode === 'skip') {
          skipped++;
          continue;
        } else if (duplicateMode === 'overwrite') {
          // Delete old bill and its items
          db.prepare('DELETE FROM bills WHERE id = ?').run(bill.existing_id);
        } else if (duplicateMode === 'renumber') {
          finalBillNo = nextBillNo(new Date(bill.date_time));
        }
      }

      bill.bill_no = finalBillNo;
      saveBill(bill, userId);
      saved++;
    }
  });

  tx();
  return {
    totalBills: validation.totalBills,
    saved,
    skipped,
    errorCount: validation.errorCount,
    errors: validation.errors,
  };
}

function normalizeDate(val) {
  if (val instanceof Date) return val.toISOString();
  const s = String(val || '').trim();
  const parts = s.split('-');
  if (parts.length === 3) {
    // Check if DD-MM-YYYY
    if (parts[2].length === 4) {
      const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    // Check if YYYY-MM-DD
    if (parts[0].length === 4) {
      const d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  const parsed = new Date(val);
  return !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

async function exportDailySales(filePath, dateStr, lang = 'en') {
  const db = getDb();
  const start = `${dateStr}T00:00:00.000Z`;
  const end = `${dateStr}T23:59:59.999Z`;
  const bills = db
    .prepare(
      `SELECT bill_no, date_time, order_type, customer_name, subtotal, discount, tax_total, round_off, total, payment_mode, cashier_name, status
       FROM bills WHERE date_time >= ? AND date_time <= ? ORDER BY id DESC`
    )
    .all(start, end);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(lang === 'ta' ? 'நாள் விற்பனை' : 'Daily Sales');

  const headers =
    lang === 'ta'
      ? ['பில் எண்', 'தேதி', 'ஆர்டர் வகை', 'வாடிக்கையாளர்', 'கூட்டுத்தொகை', 'தள்ளுபடி', 'வரி', 'முழுமையாக்கல்', 'மொத்தம்', 'பணம் செலுத்துதல்', 'பயனர்', 'நிலை']
      : ['Bill No', 'Date', 'Order Type', 'Customer', 'Subtotal', 'Discount', 'Tax', 'Round Off', 'Total', 'Payment', 'Cashier', 'Status'];

  ws.addRow(headers);
  bills.forEach((b) => {
    ws.addRow([
      b.bill_no,
      b.date_time,
      b.order_type,
      b.customer_name || '-',
      b.subtotal,
      b.discount,
      b.tax_total,
      b.round_off,
      b.total,
      b.payment_mode,
      b.cashier_name || '',
      b.status,
    ]);
  });

  await wb.xlsx.writeFile(filePath);
  return { count: bills.length };
}

async function exportDetailedReport(filePath, fromDate, toDate, lang = 'en') {
  const data = getDetailedReport(fromDate, toDate);
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Summary & Sales
  const wsBills = wb.addWorksheet('Bills');
  wsBills.addRow([
    'Bill No',
    'Date',
    'Order Type',
    'Customer',
    'Subtotal',
    'Discount',
    'Tax',
    'Round Off',
    'Total',
    'Payment',
    'Cashier',
    'Status',
  ]);
  data.bills.forEach((b) => {
    wsBills.addRow([
      b.bill_no,
      b.date_time,
      b.order_type,
      b.customer_name || '-',
      b.subtotal,
      b.discount,
      b.tax_total,
      b.round_off,
      b.total,
      b.payment_mode,
      b.cashier_name || '',
      b.status,
    ]);
  });

  // Sheet 2: Item-wise
  const wsItems = wb.addWorksheet('Item-Wise Sales');
  wsItems.addRow(['Item Name', 'Unit', 'Total Quantity', 'Total Amount']);
  data.byItem.forEach((it) => {
    wsItems.addRow([it.item_name, it.unit, it.total_qty, it.total_amount]);
  });

  // Sheet 3: Category-wise
  const wsCats = wb.addWorksheet('Category-Wise Sales');
  wsCats.addRow(['Category', 'Total Quantity', 'Total Amount']);
  data.byCategory.forEach((c) => {
    wsCats.addRow([c.category_name, c.total_qty, c.total_amount]);
  });

  // Sheet 4: Payment Summary
  const wsPay = wb.addWorksheet('Payment Summary');
  wsPay.addRow(['Payment Mode', 'Bill Count', 'Total Amount']);
  data.byPayment.forEach((p) => {
    wsPay.addRow([p.payment_mode, p.count, p.amount]);
  });

  // Sheet 5: GST Summary
  const wsGst = wb.addWorksheet('GST Summary');
  wsGst.addRow(['Component', 'Percent', 'Taxable Amount', 'Tax Amount']);
  data.byGst.forEach((g) => {
    wsGst.addRow([g.component_name, g.percent, g.taxable_amount, g.tax_amount]);
  });

  await wb.xlsx.writeFile(filePath);
  return { ok: true, billsCount: data.bills.length };
}

async function exportGstSummary(filePath, fromDate, toDate) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT bt.component_name, bt.percent,
              SUM(bt.taxable_amount) as taxable, SUM(bt.tax_amount) as tax
       FROM bill_taxes bt
       JOIN bills b ON b.id = bt.bill_id
       WHERE b.status = 'paid' AND b.date_time >= ? AND b.date_time <= ?
       GROUP BY bt.component_name, bt.percent`
    )
    .all(`${fromDate}T00:00:00.000Z`, `${toDate}T23:59:59.999Z`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GST Summary');
  ws.addRow(['Component', 'Percent', 'Taxable Amount', 'Tax Amount']);
  rows.forEach((r) => ws.addRow([r.component_name, r.percent, r.taxable, r.tax]));
  await wb.xlsx.writeFile(filePath);
  return { count: rows.length };
}

async function ensureTemplates(templatesDir) {
  if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });

  const menuPath = path.join(templatesDir, 'Menu_Template.xlsx');
  if (!fs.existsSync(menuPath)) {
    const menuWb = new ExcelJS.Workbook();
    const ms = menuWb.addWorksheet('Menu');
    ms.addRow(['Code', 'Category_EN', 'Category_TA', 'Item_EN', 'Item_TA', 'Price', 'Tax_Profile', 'Unit']);
    ms.addRow(['101', 'Biriyani', 'பிரியாணி', 'Chicken Biriyani', 'சிக்கன் பிரியாணி', 180, 'Restaurant 5%', 'Plate']);
    ms.addRow(['102', 'Biriyani', 'பிரியாணி', 'Mutton Biriyani', 'மட்டன் பிரியாணி', 260, 'Restaurant 5%', 'Plate']);
    ms.addRow(['201', 'Fish', 'மீன்', 'Fish Fry', 'மீன் வறுவல்', 220, 'Restaurant 5%', 'Plate']);
    await menuWb.xlsx.writeFile(menuPath);
  }

  const billsPath = path.join(templatesDir, 'Bill_Entry_Template.xlsx');
  if (!fs.existsSync(billsPath)) {
    const billsWb = new ExcelJS.Workbook();
    const bs = billsWb.addWorksheet('Bills');
    bs.addRow(['Date', 'Bill_No', 'Table/Type', 'Item_Code', 'Qty', 'Rate (optional)', 'Discount', 'Payment_Mode']);
    bs.addRow(['14-10-2026', '1', 'Dine-in T3', '101', 2, 180, 0, 'Cash']);
    bs.addRow(['14-10-2026', '1', 'Dine-in T3', '201', 1, 220, 0, 'Cash']);
    bs.addRow(['14-10-2026', '2', 'Parcel', '102', 1, 260, 10, 'UPI']);
    await billsWb.xlsx.writeFile(billsPath);
  }
}

module.exports = {
  importMenuFromFile,
  validateBillsFile,
  importBillsFromFile,
  exportDailySales,
  exportDetailedReport,
  exportGstSummary,
  ensureTemplates,
};
