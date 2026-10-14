const { getSetting } = require('./db');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmt(n) {
  return Number(n || 0).toFixed(2);
}

function buildBillHtml(bill, shop = {}, lang = 'both') {
  const paper = getSetting('printer_paper', '80');
  const widthMm = paper === '58' ? '54mm' : '72mm';
  const fontSize = paper === '58' ? '11px' : '12px';

  let nameDisplay = '';
  if (lang === 'ta') {
    nameDisplay = escapeHtml(shop.shop_name_ta || shop.shop_name_en || 'அசைவ உணவகம்');
  } else if (lang === 'en') {
    nameDisplay = escapeHtml(shop.shop_name_en || shop.shop_name_ta || 'Non-Veg Restaurant');
  } else {
    // Both
    nameDisplay = `<div style="font-size:16px;font-weight:bold">${escapeHtml(shop.shop_name_en || '')}</div>
                   <div style="font-size:14px">${escapeHtml(shop.shop_name_ta || '')}</div>`;
  }

  let addressDisplay = '';
  if (lang === 'ta') {
    addressDisplay = escapeHtml(shop.shop_address_ta || shop.shop_address_en || '');
  } else if (lang === 'en') {
    addressDisplay = escapeHtml(shop.shop_address_en || shop.shop_address_ta || '');
  } else {
    addressDisplay = `<div>${escapeHtml(shop.shop_address_en || '')}</div><div>${escapeHtml(shop.shop_address_ta || '')}</div>`;
  }

  const itemsHtml = (bill.items || [])
    .map(
      (it, idx) =>
        `<tr>
          <td style="padding: 2px 0;">${idx + 1}. ${escapeHtml(it.name_snapshot)}</td>
          <td align="right" style="padding: 2px 0;">${it.qty} ${escapeHtml(it.unit || '')}</td>
          <td align="right" style="padding: 2px 0;">${fmt(it.rate)}</td>
          <td align="right" style="padding: 2px 0; font-weight: 500;">${fmt(it.amount)}</td>
        </tr>`
    )
    .join('');

  const gstEnabled = getSetting('gst_enabled', true);
  const taxHtml = (bill.taxes || [])
    .map(
      (t) =>
        `<tr>
          <td colspan="3">${escapeHtml(t.component_name)} (${t.percent}%)</td>
          <td align="right">${fmt(t.tax_amount)}</td>
        </tr>`
    )
    .join('');

  const dateStr = new Date(bill.date_time || Date.now()).toLocaleString();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Bill ${escapeHtml(bill.bill_no)}</title>
  <style>
    @font-face {
      font-family: 'Noto Sans Tamil';
      src: local('Noto Sans Tamil'), local('Latha'), local('Vijaya'), local('Segoe UI');
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Noto Sans Tamil', 'Segoe UI', Tahoma, sans-serif;
      font-size: ${fontSize};
      width: ${widthMm};
      margin: 0 auto;
      padding: 6px;
      color: #000;
      background: #fff;
      line-height: 1.3;
    }
    .center { text-align: center; }
    .header { text-align: center; margin-bottom: 6px; }
    .title { font-weight: bold; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { border-bottom: 1px dashed #000; padding: 4px 0; font-size: 11px; text-align: left; }
    td { vertical-align: top; }
    hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
    .total-row { font-weight: bold; font-size: 14px; border-top: 1px solid #000; border-bottom: 1px solid #000; }
    .info-table { font-size: 11px; margin-bottom: 4px; }
    .footer { text-align: center; margin-top: 8px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${nameDisplay}</div>
    <div>${addressDisplay}</div>
    ${shop.shop_phone ? `<div>Phone: ${escapeHtml(shop.shop_phone)}</div>` : ''}
    ${shop.gstin && gstEnabled ? `<div>GSTIN: ${escapeHtml(shop.gstin)}</div>` : ''}
    ${shop.fssai ? `<div>FSSAI: ${escapeHtml(shop.fssai)}</div>` : ''}
  </div>

  <hr/>

  <table class="info-table">
    <tr>
      <td><strong>Bill:</strong> ${escapeHtml(bill.bill_no)}</td>
      <td align="right">${escapeHtml(dateStr)}</td>
    </tr>
    <tr>
      <td><strong>Type:</strong> ${escapeHtml(bill.order_type || 'Dine-in')}</td>
      <td align="right"><strong>Cashier:</strong> ${escapeHtml(bill.cashier_name || 'Admin')}</td>
    </tr>
    ${bill.customer_name ? `<tr><td colspan="2"><strong>Customer:</strong> ${escapeHtml(bill.customer_name)} ${bill.customer_phone ? `(${escapeHtml(bill.customer_phone)})` : ''}</td></tr>` : ''}
  </table>

  <hr/>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th align="right">Qty</th>
        <th align="right">Rate</th>
        <th align="right">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <hr/>

  <table>
    <tr>
      <td colspan="3">Subtotal</td>
      <td align="right">${fmt(bill.subtotal)}</td>
    </tr>
    ${bill.discount ? `<tr><td colspan="3">Discount (${bill.discount_percent || 0}%)</td><td align="right">-${fmt(bill.discount)}</td></tr>` : ''}
    ${gstEnabled && taxHtml ? taxHtml : ''}
    ${bill.round_off ? `<tr><td colspan="3">Round Off</td><td align="right">${fmt(bill.round_off)}</td></tr>` : ''}
    <tr class="total-row">
      <td colspan="3" style="padding: 4px 0;">NET TOTAL</td>
      <td align="right" style="padding: 4px 0;">₹${fmt(bill.total)}</td>
    </tr>
  </table>

  <div style="margin-top: 4px; font-size: 11px;">
    <strong>Payment:</strong> ${escapeHtml(bill.payment_mode || 'Cash')}
  </div>

  <hr/>

  <div class="footer">
    <div>${escapeHtml(shop.footer_message || 'Thank you! Visit again | நன்றி! மீண்டும் வருக')}</div>
  </div>
</body>
</html>`;
}

function buildKotHtml(kot) {
  const paper = getSetting('printer_paper', '80');
  const widthMm = paper === '58' ? '54mm' : '72mm';

  const items = (kot.items || [])
    .map(
      (it) => `
      <div style="display:flex; justify-content:space-between; margin: 4px 0; font-size: 16px; font-weight: bold;">
        <span>${escapeHtml(it.name)}</span>
        <span>x ${it.qty}</span>
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KOT</title>
  <style>
    body { font-family: sans-serif; width: ${widthMm}; margin: 0 auto; padding: 6px; }
    h2 { text-align: center; margin: 0 0 4px; font-size: 18px; border-bottom: 2px solid #000; padding-bottom: 4px; }
    .meta { font-size: 13px; margin-bottom: 6px; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    .notes { font-style: italic; margin-top: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <h2>KITCHEN ORDER TICKET (KOT)</h2>
  <div class="meta">
    <div><strong>Table:</strong> ${escapeHtml(kot.table || 'Takeaway')}</div>
    <div><strong>Time:</strong> ${new Date().toLocaleTimeString()}</div>
    ${kot.waiter ? `<div><strong>Waiter:</strong> ${escapeHtml(kot.waiter)}</div>` : ''}
  </div>
  <hr/>
  ${items}
  <hr/>
  ${kot.note ? `<div class="notes"><strong>Note:</strong> ${escapeHtml(kot.note)}</div>` : ''}
</body>
</html>`;
}

async function printHtml(win, html, silent = true) {
  const paper = getSetting('printer_paper', '80');
  const widthMicrons = paper === '58' ? 58000 : 80000;
  const printerName = getSetting('printer_name', '');
  const copies = Number(getSetting('print_copies', 1)) || 1;

  return new Promise((resolve) => {
    const printWin = win || require('electron').BrowserWindow.getFocusedWindow();
    if (!printWin) return resolve({ ok: false, error: 'No print window' });

    const printOptions = {
      silent: silent,
      printBackground: true,
      margins: { marginType: 'none' },
      pageSize: { width: widthMicrons, height: 300000 },
      copies,
    };

    if (printerName) {
      printOptions.deviceName = printerName;
    }

    printWin.webContents.print(printOptions, (success, failureReason) => {
      if (success) {
        resolve({ ok: true });
      } else {
        // Printer offline, no printer attached, or cancelled by user
        resolve({ ok: false, error: failureReason || 'Print job canceled' });
      }
    });
  });
}

module.exports = {
  buildBillHtml,
  buildKotHtml,
  printHtml,
};
