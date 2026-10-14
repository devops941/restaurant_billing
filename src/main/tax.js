const { getDb, getSetting } = require('./db');
const ExcelJS = require('exceljs');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function getTaxProfile(profileId) {
  const db = getDb();
  let profile = null;
  if (profileId) {
    profile = db.prepare('SELECT * FROM tax_profiles WHERE id = ? AND is_active = 1').get(profileId);
  }
  if (!profile) {
    profile = db.prepare('SELECT * FROM tax_profiles WHERE is_default = 1 AND is_active = 1').get();
  }
  if (!profile) {
    profile = db.prepare('SELECT * FROM tax_profiles WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  }
  if (!profile) {
    return { id: 0, name: 'None', rates: [], price_mode: getSetting('price_mode', 'exclusive') };
  }

  const rates = db
    .prepare(
      `SELECT tr.*, tpr.sort_order FROM tax_rates tr
       JOIN tax_profile_rates tpr ON tpr.tax_rate_id = tr.id
       WHERE tpr.profile_id = ? AND tr.is_active = 1
       ORDER BY tpr.sort_order, tr.id`
    )
    .all(profile.id);

  return { ...profile, rates };
}

function warnIfMixedTax(taxRows) {
  const types = new Set((taxRows || []).map((r) => r.component_type || r.component_name));
  const hasIgst = types.has('IGST') || [...types].some((t) => String(t).toUpperCase().includes('IGST'));
  const hasCgstSgst =
    types.has('CGST') ||
    types.has('SGST') ||
    [...types].some((t) => String(t).toUpperCase().includes('CGST') || String(t).toUpperCase().includes('SGST'));
  return hasIgst && hasCgstSgst;
}

function computeLineTax(lineAmount, profile, billDate, globalPriceMode) {
  const priceMode = globalPriceMode || profile?.price_mode || 'exclusive';
  const rates = (profile?.rates || []).filter((r) => {
    if (!r.is_active && r.is_active !== undefined) return false;
    if (billDate && r.effective_from && billDate < r.effective_from) return false;
    if (billDate && r.effective_to && billDate > r.effective_to) return false;
    return true;
  });

  const totalPercent = rates.reduce((s, r) => s + (Number(r.percent) || 0), 0);

  let taxableBase = lineAmount;
  const taxComponents = [];

  if (priceMode === 'inclusive' && totalPercent > 0) {
    taxableBase = round2(lineAmount / (1 + totalPercent / 100));
  }

  for (const rate of rates) {
    const taxAmount = round2(taxableBase * ((Number(rate.percent) || 0) / 100));
    taxComponents.push({
      component_name: rate.name,
      component_type: rate.component_type || 'GST',
      percent: Number(rate.percent) || 0,
      taxable_amount: taxableBase,
      tax_amount: taxAmount,
    });
  }

  const taxTotal = round2(taxComponents.reduce((s, t) => s + t.tax_amount, 0));
  const lineTotal = priceMode === 'inclusive' ? lineAmount : round2(taxableBase + taxTotal);

  return {
    priceMode,
    taxableBase,
    taxComponents,
    taxTotal,
    lineTotal,
    taxSnapshot: JSON.stringify({ profile: profile.name, rates: taxComponents, priceMode }),
  };
}

function computeBillTotals(lines, options = {}) {
  const gstEnabled = getSetting('gst_enabled', true);
  const globalPriceMode = options.price_mode || getSetting('price_mode', 'exclusive');
  const discountPercent = Number(options.discount_percent) || 0;
  const discountAmount = Number(options.discount) || 0;
  const useDiscountPercent = options.use_discount_percent !== false && discountPercent > 0;

  let subtotal = 0;
  const allTaxComponents = [];
  const processedLines = [];

  let isAnyInclusive = false;
  let isAnyExclusive = false;

  for (const line of lines) {
    const qty = Number(line.qty) || 0;
    const rate = Number(line.rate) || 0;
    const amount = round2(qty * rate);
    subtotal += amount;

    let lineTax = { taxTotal: 0, taxComponents: [], taxSnapshot: '{}', priceMode: globalPriceMode };
    if (gstEnabled) {
      let profile = null;
      if (line.item_id) {
        const item = getDb().prepare('SELECT tax_profile_id FROM items WHERE id = ?').get(line.item_id);
        profile = getTaxProfile(item?.tax_profile_id);
      } else if (line.tax_profile_id) {
        profile = getTaxProfile(line.tax_profile_id);
      } else {
        profile = getTaxProfile();
      }

      lineTax = computeLineTax(amount, profile, options.bill_date, globalPriceMode);
      if (lineTax.priceMode === 'inclusive') isAnyInclusive = true;
      else isAnyExclusive = true;
    }

    processedLines.push({
      ...line,
      amount,
      tax_snapshot: lineTax.taxSnapshot,
      tax_total: lineTax.taxTotal,
      tax_components: lineTax.taxComponents,
      price_mode: lineTax.priceMode,
    });

    if (gstEnabled) {
      allTaxComponents.push(...lineTax.taxComponents);
    }
  }

  subtotal = round2(subtotal);
  let discount = useDiscountPercent ? round2((subtotal * discountPercent) / 100) : round2(discountAmount);
  if (discount > subtotal) discount = subtotal;

  const afterDiscount = round2(subtotal - discount);
  const discountRatio = subtotal > 0 ? afterDiscount / subtotal : 1;

  // Aggregate taxes adjusted for discount
  const taxSummaryMap = new Map();
  for (const comp of allTaxComponents) {
    const adjustedTaxable = round2(comp.taxable_amount * discountRatio);
    const adjustedTax = round2(comp.tax_amount * discountRatio);
    const key = `${comp.component_name}|${comp.percent}`;
    const existing = taxSummaryMap.get(key) || {
      component_name: comp.component_name,
      component_type: comp.component_type,
      percent: comp.percent,
      taxable_amount: 0,
      tax_amount: 0,
    };
    existing.taxable_amount = round2(existing.taxable_amount + adjustedTaxable);
    existing.tax_amount = round2(existing.tax_amount + adjustedTax);
    taxSummaryMap.set(key, existing);
  }

  const billTaxes = [...taxSummaryMap.values()];
  const taxTotal = round2(billTaxes.reduce((s, t) => s + t.tax_amount, 0));

  // Determine net total:
  // If price mode is inclusive: subtotal already had tax inside it, so afterDiscount includes tax!
  // If exclusive: taxTotal is added to afterDiscount.
  // If mixed: only exclusive portion of taxes gets added.
  let net = afterDiscount;
  if (gstEnabled) {
    if (globalPriceMode === 'inclusive') {
      net = afterDiscount;
    } else if (globalPriceMode === 'exclusive' || (isAnyExclusive && !isAnyInclusive)) {
      net = round2(afterDiscount + taxTotal);
    } else if (isAnyExclusive && isAnyInclusive) {
      // Mixed lines: add only taxes for exclusive lines
      let exclusiveTax = 0;
      for (const line of processedLines) {
        if (line.price_mode === 'exclusive') {
          exclusiveTax += line.tax_total * discountRatio;
        }
      }
      net = round2(afterDiscount + round2(exclusiveTax));
    } else {
      net = afterDiscount;
    }
  }

  // Extra charges (Service charge, Packing charge, Delivery charge)
  const extraCharges = options.extra_charges || [];
  let extraChargesTotal = 0;
  for (const ec of extraCharges) {
    const chargeAmt = Number(ec.amount) || 0;
    extraChargesTotal += chargeAmt;
  }
  net = round2(net + extraChargesTotal);

  // Round-off calculation
  const roundMode = options.round_off || getSetting('round_off', 'none');
  let roundOff = 0;
  if (roundMode === 'rupee') {
    const rounded = Math.round(net);
    roundOff = round2(rounded - net);
    net = rounded;
  } else if (roundMode === 'paise50') {
    const rounded = Math.round(net * 2) / 2;
    roundOff = round2(rounded - net);
    net = rounded;
  }

  const mixedWarning = warnIfMixedTax(billTaxes);

  return {
    subtotal,
    discount,
    discount_percent: useDiscountPercent ? discountPercent : 0,
    afterDiscount,
    billTaxes,
    tax_total: taxTotal,
    extra_charges_total: extraChargesTotal,
    round_off: roundOff,
    total: net,
    lines: processedLines,
    mixedTaxWarning: mixedWarning,
    price_mode: globalPriceMode,
  };
}

function getAllTaxRates() {
  return getDb().prepare('SELECT * FROM tax_rates ORDER BY component_type, percent, id').all();
}

function saveTaxRate(rate) {
  const db = getDb();
  if (rate.id) {
    db.prepare(
      `UPDATE tax_rates SET name = ?, component_type = ?, percent = ?, effective_from = ?, effective_to = ?, is_active = ?
       WHERE id = ?`
    ).run(
      rate.name,
      rate.component_type || 'CGST',
      Number(rate.percent) || 0,
      rate.effective_from || null,
      rate.effective_to || null,
      rate.is_active !== false ? 1 : 0,
      rate.id
    );
    return { id: rate.id };
  }
  const info = db
    .prepare(
      `INSERT INTO tax_rates (name, component_type, percent, effective_from, effective_to, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      rate.name,
      rate.component_type || 'CGST',
      Number(rate.percent) || 0,
      rate.effective_from || null,
      rate.effective_to || null,
      rate.is_active !== false ? 1 : 0
    );
  return { id: info.lastInsertRowid };
}

function deleteTaxRate(rateId) {
  const db = getDb();
  // Check if used in bill_taxes
  const rate = db.prepare('SELECT name FROM tax_rates WHERE id = ?').get(rateId);
  if (!rate) return { ok: true };

  const used = db.prepare('SELECT COUNT(*) as c FROM bill_taxes WHERE component_name = ?').get(rate.name);
  if (used && used.c > 0) {
    // Cannot hard delete, deactivate
    db.prepare('UPDATE tax_rates SET is_active = 0 WHERE id = ?').run(rateId);
    return { ok: true, deactivated: true, message: 'Rate used in existing bills. Deactivated instead of deleted.' };
  }

  // Remove associations
  db.prepare('DELETE FROM tax_profile_rates WHERE tax_rate_id = ?').run(rateId);
  db.prepare('DELETE FROM tax_rates WHERE id = ?').run(rateId);
  return { ok: true, deleted: true };
}

function getAllTaxProfiles() {
  const db = getDb();
  const profiles = db.prepare('SELECT * FROM tax_profiles ORDER BY id').all();
  return profiles.map((p) => {
    const rates = db
      .prepare(
        `SELECT tr.*, tpr.sort_order FROM tax_rates tr
         JOIN tax_profile_rates tpr ON tpr.tax_rate_id = tr.id
         WHERE tpr.profile_id = ? ORDER BY tpr.sort_order, tr.id`
      )
      .all(p.id);
    return { ...p, rates };
  });
}

function saveTaxProfile(profile) {
  const db = getDb();
  let profileId = profile.id;

  const tx = db.transaction(() => {
    if (profile.is_default) {
      db.prepare('UPDATE tax_profiles SET is_default = 0').run();
    }

    if (profileId) {
      db.prepare(
        `UPDATE tax_profiles SET name = ?, is_default = ?, price_mode = ?, is_active = ? WHERE id = ?`
      ).run(
        profile.name,
        profile.is_default ? 1 : 0,
        profile.price_mode || 'exclusive',
        profile.is_active !== false ? 1 : 0,
        profileId
      );
    } else {
      const info = db
        .prepare(
          `INSERT INTO tax_profiles (name, is_default, price_mode, is_active) VALUES (?, ?, ?, ?)`
        )
        .run(
          profile.name,
          profile.is_default ? 1 : 0,
          profile.price_mode || 'exclusive',
          profile.is_active !== false ? 1 : 0
        );
      profileId = info.lastInsertRowid;
    }

    // Update rates mapping
    if (Array.isArray(profile.rate_ids)) {
      db.prepare('DELETE FROM tax_profile_rates WHERE profile_id = ?').run(profileId);
      const ins = db.prepare('INSERT INTO tax_profile_rates (profile_id, tax_rate_id, sort_order) VALUES (?, ?, ?)');
      profile.rate_ids.forEach((rateId, idx) => {
        ins.run(profileId, rateId, idx);
      });
    }

    return { id: profileId };
  });

  return tx();
}

async function exportTaxSettings(filePath) {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Rates
  const wsRates = wb.addWorksheet('Tax Rates');
  wsRates.addRow(['ID', 'Name', 'Type', 'Percent', 'Effective From', 'Effective To', 'Active']);
  const rates = getAllTaxRates();
  rates.forEach((r) => {
    wsRates.addRow([r.id, r.name, r.component_type, r.percent, r.effective_from || '', r.effective_to || '', r.is_active ? 'Yes' : 'No']);
  });

  // Sheet 2: Profiles
  const wsProfiles = wb.addWorksheet('Tax Profiles');
  wsProfiles.addRow(['ID', 'Profile Name', 'Default', 'Price Mode', 'Active', 'Rate IDs (comma-separated)']);
  const profiles = getAllTaxProfiles();
  profiles.forEach((p) => {
    const rateIds = (p.rates || []).map((r) => r.id).join(',');
    wsProfiles.addRow([p.id, p.name, p.is_default ? 'Yes' : 'No', p.price_mode, p.is_active ? 'Yes' : 'No', rateIds]);
  });

  await wb.xlsx.writeFile(filePath);
  return { ok: true, ratesCount: rates.length, profilesCount: profiles.length };
}

async function importTaxSettings(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const wsRates = wb.getWorksheet('Tax Rates');
  const wsProfiles = wb.getWorksheet('Tax Profiles');

  const db = getDb();
  let ratesImported = 0;
  let profilesImported = 0;

  const tx = db.transaction(() => {
    if (wsRates) {
      wsRates.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const name = String(row.getCell(2).value || '').trim();
        const type = String(row.getCell(3).value || 'CGST').trim();
        const percent = parseFloat(row.getCell(4).value) || 0;
        const from = row.getCell(5).value ? String(row.getCell(5).value).trim() : null;
        const to = row.getCell(6).value ? String(row.getCell(6).value).trim() : null;
        const active = String(row.getCell(7).value || 'Yes').toLowerCase() === 'yes' ? 1 : 0;

        if (name) {
          const existing = db.prepare('SELECT id FROM tax_rates WHERE name = ?').get(name);
          if (existing) {
            db.prepare(
              'UPDATE tax_rates SET component_type = ?, percent = ?, effective_from = ?, effective_to = ?, is_active = ? WHERE id = ?'
            ).run(type, percent, from, to, active, existing.id);
          } else {
            db.prepare(
              'INSERT INTO tax_rates (name, component_type, percent, effective_from, effective_to, is_active) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(name, type, percent, from, to, active);
          }
          ratesImported++;
        }
      });
    }

    if (wsProfiles) {
      wsProfiles.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const name = String(row.getCell(2).value || '').trim();
        const isDef = String(row.getCell(3).value || '').toLowerCase() === 'yes' ? 1 : 0;
        const priceMode = String(row.getCell(4).value || 'exclusive').toLowerCase();
        const active = String(row.getCell(5).value || 'Yes').toLowerCase() === 'yes' ? 1 : 0;
        const rateIdsStr = String(row.getCell(6).value || '').trim();

        if (name) {
          let profId;
          const existing = db.prepare('SELECT id FROM tax_profiles WHERE name = ?').get(name);
          if (existing) {
            db.prepare(
              'UPDATE tax_profiles SET is_default = ?, price_mode = ?, is_active = ? WHERE id = ?'
            ).run(isDef, priceMode, active, existing.id);
            profId = existing.id;
          } else {
            const ins = db.prepare(
              'INSERT INTO tax_profiles (name, is_default, price_mode, is_active) VALUES (?, ?, ?, ?)'
            ).run(name, isDef, priceMode, active);
            profId = ins.lastInsertRowid;
          }

          if (rateIdsStr) {
            db.prepare('DELETE FROM tax_profile_rates WHERE profile_id = ?').run(profId);
            const rateIds = rateIdsStr.split(',').map((x) => parseInt(x.trim(), 10)).filter(Boolean);
            const insLink = db.prepare('INSERT INTO tax_profile_rates (profile_id, tax_rate_id, sort_order) VALUES (?, ?, ?)');
            rateIds.forEach((rid, idx) => {
              insLink.run(profId, rid, idx);
            });
          }
          profilesImported++;
        }
      });
    }
  });

  tx();
  return { ok: true, ratesImported, profilesImported };
}

module.exports = {
  computeBillTotals,
  computeLineTax,
  getTaxProfile,
  getAllTaxRates,
  saveTaxRate,
  deleteTaxRate,
  getAllTaxProfiles,
  saveTaxProfile,
  exportTaxSettings,
  importTaxSettings,
  round2,
};
