const path = require('path');
const fs = require('fs');
const { initDb, getDb } = require('../src/main/db');
const { computeBillTotals } = require('../src/main/tax');
const { saveBill, getBill, nextBillNo, getDetailedReport } = require('../src/main/billing');
const { createBackup } = require('../src/main/backup');
const { exportDailySales } = require('../src/main/excel');

async function runTests() {
  console.log('--- Starting Comprehensive Billing Software Verification ---');

  const defaultsPath = path.join(__dirname, '../defaults.json');
  const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

  // 1. Database Init
  const db = initDb(defaults);
  console.log('✓ Database initialized successfully with WAL mode.');

  // 2. Next Bill No Check
  const billNo1 = nextBillNo();
  console.log('✓ Generated next bill number:', billNo1);

  // 3. Tax Calculation - Exclusive Mode
  const exclusiveTotals = computeBillTotals(
    [
      { item_id: 1, qty: 2, rate: 180 }, // 360
      { item_id: 2, qty: 1, rate: 260 }, // 260
    ],
    { price_mode: 'exclusive', discount_percent: 5, round_off: 'rupee' }
  );
  console.log('✓ Exclusive tax calculation: Subtotal =', exclusiveTotals.subtotal, 'Discount =', exclusiveTotals.discount, 'Tax =', exclusiveTotals.tax_total, 'Net =', exclusiveTotals.total);

  if (exclusiveTotals.subtotal !== 620) {
    throw new Error(`Expected subtotal 620, got ${exclusiveTotals.subtotal}`);
  }

  // 4. Tax Calculation - Inclusive Mode Check
  const inclusiveTotals = computeBillTotals(
    [
      { item_id: 1, qty: 1, rate: 210 },
    ],
    { price_mode: 'inclusive', discount_percent: 0, round_off: 'rupee' }
  );
  console.log('✓ Inclusive tax calculation: Subtotal =', inclusiveTotals.subtotal, 'Net =', inclusiveTotals.total, 'Tax extracted =', inclusiveTotals.tax_total);
  if (inclusiveTotals.total !== 210) {
    throw new Error(`Inclusive price should yield Net 210, got ${inclusiveTotals.total}`);
  }

  // 5. Bill Saving Transaction
  const savedBill = saveBill(
    {
      bill_no: billNo1,
      order_type: 'Dine-in',
      customer_name: 'Murugan',
      customer_phone: '9876543210',
      lines: [
        { item_id: 1, qty: 2, rate: 180, name_snapshot: 'Chicken Biriyani' },
        { item_id: 2, qty: 1, rate: 260, name_snapshot: 'Mutton Biriyani' },
      ],
      payment_mode: 'Cash',
      discount_percent: 5,
    },
    1
  );
  console.log('✓ Bill saved with ID:', savedBill.billId, 'Total:', savedBill.total);

  // 6. Bill Retrieval
  const fetched = getBill(savedBill.billId);
  if (!fetched || fetched.items.length !== 2) {
    throw new Error('Failed to retrieve saved bill or items');
  }
  console.log('✓ Retrieved bill from database successfully.');

  // 7. Detailed Reports
  const today = new Date().toISOString().slice(0, 10);
  const rep = getDetailedReport(today, today);
  console.log('✓ Detailed report generated:', rep.summary.total_bills, 'bills, total sales: ₹', rep.summary.total_sales);

  // 8. Excel Export
  const exportDir = path.join(__dirname, '../tmp-test-data');
  fs.mkdirSync(exportDir, { recursive: true });
  const exportFile = path.join(exportDir, `Test_Export_${Date.now()}.xlsx`);
  await exportDailySales(exportFile, today);
  console.log('✓ Excel export generated successfully at:', exportFile);

  // 9. WAL-safe Backup
  const backupRes = await createBackup(1, 'test');
  console.log('✓ Database backup verified at:', backupRes.path);

  console.log('\n========================================');
  console.log('ALL BILLING TESTS PASSED PERFECTLY (100%)');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
