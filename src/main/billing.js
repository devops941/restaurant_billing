const { getDb, getSetting, audit } = require('./db');
const { computeBillTotals, round2 } = require('./tax');

function getFinancialYearKey(date = new Date()) {
  const fyStartMonth = (Number(getSetting('fy_start_month', 4)) || 4) - 1;
  const d = new Date(date);
  let startYear = d.getFullYear();
  if (d.getMonth() < fyStartMonth) startYear -= 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, '0')}`;
}

function nextBillNo(date = new Date()) {
  const db = getDb();
  const reset = getSetting('bill_reset', 'yearly');
  const prefix = getSetting('bill_prefix', '') || '';
  const digits = Number(getSetting('bill_digits', 6)) || 6;

  let seqKey = 'global';
  if (reset === 'yearly') seqKey = getFinancialYearKey(date);
  else if (reset === 'daily') seqKey = date.toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    const row = db.prepare('SELECT last_number FROM bill_sequence WHERE fy_key = ?').get(seqKey);
    const next = (row?.last_number || 0) + 1;
    db.prepare(
      'INSERT INTO bill_sequence (fy_key, last_number) VALUES (?, ?) ON CONFLICT(fy_key) DO UPDATE SET last_number = excluded.last_number'
    ).run(seqKey, next);

    const num = String(next).padStart(digits, '0');
    if (reset === 'yearly') return `${prefix}${getFinancialYearKey(date)}/${num}`;
    if (reset === 'daily') return `${prefix}${seqKey.replace(/-/g, '')}/${num}`;
    return `${prefix}${num}`;
  });

  return tx();
}

function searchItems(query, limit = 20, categoryId = null) {
  const q = (query || '').trim();
  const db = getDb();

  let sql = `SELECT i.*, c.name_en as category_en, c.name_ta as category_ta
             FROM items i LEFT JOIN categories c ON c.id = i.category_id
             WHERE i.is_active = 1`;
  const params = [];

  if (categoryId) {
    sql += ` AND i.category_id = ?`;
    params.push(categoryId);
  }

  if (q) {
    sql += ` AND (i.code LIKE ? OR i.name_en LIKE ? OR i.name_ta LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  sql += ` ORDER BY i.code LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

function saveBill(payload, userId) {
  const db = getDb();
  const lines = (payload.lines || []).filter((l) => l.item_id && Number(l.qty) > 0);
  if (lines.length === 0) throw new Error('Bill has no items');

  const totals = computeBillTotals(lines, {
    discount_percent: payload.discount_percent,
    discount: payload.discount,
    use_discount_percent: payload.use_discount_percent,
    price_mode: payload.price_mode,
    extra_charges: payload.extra_charges || [],
    round_off: payload.round_off,
    bill_date: payload.date_time || new Date().toISOString(),
  });

  const billNo = payload.bill_no || nextBillNo(new Date(payload.date_time || Date.now()));
  const dateTime = payload.date_time || new Date().toISOString();

  // Find cashier name
  let cashierName = 'Cashier';
  if (userId) {
    const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    if (userRow) cashierName = userRow.name;
  }

  const tx = db.transaction(() => {
    // Save customer if phone provided
    let customerId = payload.customer_id || null;
    if (payload.customer_phone || payload.customer_name) {
      const existingCust = payload.customer_phone
        ? db.prepare('SELECT id FROM customers WHERE phone = ?').get(payload.customer_phone)
        : null;
      if (existingCust) {
        customerId = existingCust.id;
        db.prepare('UPDATE customers SET name = ?, address = ? WHERE id = ?').run(
          payload.customer_name || '',
          payload.customer_address || '',
          customerId
        );
      } else {
        const insCust = db
          .prepare('INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, ?)')
          .run(
            payload.customer_name || '',
            payload.customer_phone || '',
            payload.customer_address || '',
            new Date().toISOString()
          );
        customerId = insCust.lastInsertRowid;
      }
    }

    const info = db
      .prepare(
        `INSERT INTO bills (
          bill_no, date_time, table_id, waiter_id, order_type,
          customer_id, customer_name, customer_address, customer_phone,
          subtotal, discount_percent, discount, tax_total, price_mode, round_off,
          total, payment_mode, user_id, cashier_name, remark, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')`
      )
      .run(
        billNo,
        dateTime,
        payload.table_id || null,
        payload.waiter_id || null,
        payload.order_type || 'Dine-in',
        customerId,
        payload.customer_name || '',
        payload.customer_address || '',
        payload.customer_phone || '',
        totals.subtotal,
        totals.discount_percent,
        totals.discount,
        totals.tax_total,
        totals.price_mode,
        totals.round_off,
        totals.total,
        payload.payment_mode || 'Cash',
        userId,
        cashierName,
        payload.remark || ''
      );

    const billId = info.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO bill_items (bill_id, item_id, category_name, name_snapshot, qty, unit, rate, tax_snapshot, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const line of totals.lines) {
      insItem.run(
        billId,
        line.item_id,
        line.category_name || '',
        line.name_snapshot,
        line.qty,
        line.unit || 'Plate',
        line.rate,
        line.tax_snapshot || '{}',
        line.amount
      );
    }

    const insTax = db.prepare(
      `INSERT INTO bill_taxes (bill_id, component_name, percent, taxable_amount, tax_amount) VALUES (?, ?, ?, ?, ?)`
    );
    for (const t of totals.billTaxes) {
      insTax.run(billId, t.component_name, t.percent, t.taxable_amount, t.tax_amount);
    }

    // Save payment modes (single or split)
    const insPay = db.prepare('INSERT INTO payments (bill_id, mode, amount) VALUES (?, ?, ?)');
    if (Array.isArray(payload.payments) && payload.payments.length > 0) {
      for (const p of payload.payments) {
        if (Number(p.amount) > 0) {
          insPay.run(billId, p.mode || 'Cash', Number(p.amount) || 0);
        }
      }
    } else {
      insPay.run(billId, payload.payment_mode || 'Cash', totals.total);
    }

    // Update table status
    if (payload.table_id) {
      db.prepare("UPDATE tables SET status = 'billed', current_bill_id = ? WHERE id = ?").run(billId, payload.table_id);
    }

    audit(userId, 'bill_save', JSON.stringify({ billId, billNo, total: totals.total, cashier: cashierName }));
    return { billId, billNo, cashierName, ...totals };
  });

  return tx();
}

function cancelBill(billId, reason, userId) {
  const db = getDb();
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) throw new Error('Bill not found');
  if (bill.status === 'cancelled') throw new Error('Bill is already cancelled');

  db.prepare("UPDATE bills SET status = 'cancelled', cancel_reason = ? WHERE id = ?").run(reason || 'Cancelled by admin', billId);
  if (bill.table_id) {
    db.prepare("UPDATE tables SET status = 'free', current_bill_id = NULL WHERE id = ?").run(bill.table_id);
  }
  audit(userId, 'bill_cancel', JSON.stringify({ billId, billNo: bill.bill_no, reason }));
  return { ok: true };
}

function holdBill(label, payload, userId) {
  const db = getDb();
  const info = db
    .prepare('INSERT INTO held_bills (label, payload, created_at, user_id) VALUES (?, ?, ?, ?)')
    .run(label || 'Held Bill', JSON.stringify(payload), new Date().toISOString(), userId);
  return { id: info.lastInsertRowid };
}

function listHeldBills() {
  return getDb()
    .prepare('SELECT id, label, created_at FROM held_bills ORDER BY id DESC')
    .all();
}

function recallHeldBill(id) {
  const row = getDb().prepare('SELECT payload FROM held_bills WHERE id = ?').get(id);
  if (!row) throw new Error('Held bill not found');
  getDb().prepare('DELETE FROM held_bills WHERE id = ?').run(id);
  return JSON.parse(row.payload);
}

function getBill(billId) {
  const db = getDb();
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) return null;
  bill.items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(billId);
  bill.taxes = db.prepare('SELECT * FROM bill_taxes WHERE bill_id = ?').all(billId);
  bill.payments = db.prepare('SELECT * FROM payments WHERE bill_id = ?').all(billId);
  return bill;
}

function previewTotals(payload) {
  const lines = (payload.lines || []).filter((l) => l.item_id && Number(l.qty) > 0);
  return computeBillTotals(lines, {
    discount_percent: payload.discount_percent,
    discount: payload.discount,
    use_discount_percent: payload.use_discount_percent,
    price_mode: payload.price_mode,
    extra_charges: payload.extra_charges || [],
    round_off: payload.round_off,
  });
}

function getDetailedReport(fromDate, toDate) {
  const db = getDb();
  const start = `${fromDate}T00:00:00.000Z`;
  const end = `${toDate}T23:59:59.999Z`;

  // Summary counts
  const summary = db
    .prepare(
      `SELECT COUNT(*) as total_bills,
              COALESCE(SUM(subtotal), 0) as total_subtotal,
              COALESCE(SUM(discount), 0) as total_discount,
              COALESCE(SUM(tax_total), 0) as total_tax,
              COALESCE(SUM(round_off), 0) as total_round_off,
              COALESCE(SUM(total), 0) as total_sales
       FROM bills WHERE status = 'paid' AND date_time >= ? AND date_time <= ?`
    )
    .get(start, end);

  // Payment Breakdown
  const byPayment = db
    .prepare(
      `SELECT p.mode as payment_mode, COUNT(DISTINCT b.id) as count, COALESCE(SUM(p.amount), 0) as amount
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       WHERE b.status = 'paid' AND b.date_time >= ? AND b.date_time <= ?
       GROUP BY p.mode`
    )
    .all(start, end);

  // Item-wise Breakdown
  const byItem = db
    .prepare(
      `SELECT bi.name_snapshot as item_name, bi.unit, SUM(bi.qty) as total_qty, SUM(bi.amount) as total_amount
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       WHERE b.status = 'paid' AND b.date_time >= ? AND b.date_time <= ?
       GROUP BY bi.name_snapshot, bi.unit
       ORDER BY total_amount DESC`
    )
    .all(start, end);

  // Category-wise Breakdown
  const byCategory = db
    .prepare(
      `SELECT COALESCE(NULLIF(bi.category_name, ''), 'Other') as category_name,
              SUM(bi.qty) as total_qty,
              SUM(bi.amount) as total_amount
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       WHERE b.status = 'paid' AND b.date_time >= ? AND b.date_time <= ?
       GROUP BY category_name
       ORDER BY total_amount DESC`
    )
    .all(start, end);

  // GST Summary
  const byGst = db
    .prepare(
      `SELECT bt.component_name, bt.percent,
              SUM(bt.taxable_amount) as taxable_amount,
              SUM(bt.tax_amount) as tax_amount
       FROM bill_taxes bt
       JOIN bills b ON b.id = bt.bill_id
       WHERE b.status = 'paid' AND b.date_time >= ? AND b.date_time <= ?
       GROUP BY bt.component_name, bt.percent`
    )
    .all(start, end);

  // Bills list
  const bills = db
    .prepare(
      `SELECT id, bill_no, date_time, order_type, customer_name, subtotal, discount, tax_total, round_off, total, payment_mode, cashier_name, status
       FROM bills WHERE date_time >= ? AND date_time <= ?
       ORDER BY id DESC`
    )
    .all(start, end);

  return {
    fromDate,
    toDate,
    summary,
    byPayment,
    byItem,
    byCategory,
    byGst,
    bills,
  };
}

function createTable(name, section = 'General') {
  const db = getDb();
  const info = db.prepare('INSERT INTO tables (name, section, status) VALUES (?, ?, ?)').run(name, section, 'free');
  return { id: info.lastInsertRowid, name, section, status: 'free' };
}

function createWaiter(name) {
  const db = getDb();
  const info = db.prepare('INSERT INTO waiters (name, is_active) VALUES (?, ?)').run(name, 1);
  return { id: info.lastInsertRowid, name, is_active: 1 };
}

module.exports = {
  nextBillNo,
  searchItems,
  saveBill,
  cancelBill,
  holdBill,
  listHeldBills,
  recallHeldBill,
  getBill,
  previewTotals,
  getDetailedReport,
  createTable,
  createWaiter,
};
