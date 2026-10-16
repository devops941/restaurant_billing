import { initI18n, setLanguage, t, getLang, itemDisplayName } from './i18n.js';
import {
  initKeyboardManager,
  loadShortcuts,
  onAction,
  getShortcutList,
  checkConflict,
  resetShortcut,
  resetAllShortcuts,
} from './keyboard.js';
import { BillingGrid } from './grid.js';

let currentUser = null;
let grid = null;
let lastSavedBillId = null;

// Multi-bill tab state
let tabs = [];
let activeTabId = 'tab-1';

const navViews = ['billing', 'tables', 'menu', 'excel', 'reports', 'settings'];

async function main() {
  const settings = await window.api.getSettings();
  applyThemeAndFont(settings);

  await initI18n(settings.default_language || 'en');
  await setLanguage(getLang());

  bindLogin();
  await loadShortcuts();
  initKeyboardManager();
  registerShortcuts();
}

function applyThemeAndFont(settings) {
  if (settings.theme === 'dark') {
    document.body.classList.add('theme-dark');
  } else {
    document.body.classList.remove('theme-dark');
  }

  if (settings.font_size === 'medium') {
    document.documentElement.style.setProperty('--font-size', '14px');
  } else if (settings.font_size === 'large') {
    document.documentElement.style.setProperty('--font-size', '15px');
  } else {
    document.documentElement.style.setProperty('--font-size', '13px');
  }
}

function bindLogin() {
  const pinInput = document.getElementById('login-pin');
  const btnLogin = document.getElementById('btn-login-submit');

  const doLogin = async () => {
    const pin = pinInput.value.trim();
    if (!pin) return;
    const res = await window.api.login(pin);
    if (!res.ok) {
      const errEl = document.getElementById('login-error');
      errEl.textContent = res.error || 'Invalid PIN';
      errEl.classList.remove('hidden');
      pinInput.value = '';
      pinInput.focus();
      return;
    }

    currentUser = res.user;
    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');
    document.getElementById('status-user').textContent = currentUser.name;
    document.getElementById('status-role').textContent = currentUser.role.toUpperCase();

    await initApp();
  };

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  btnLogin.addEventListener('click', doLogin);
}

async function initApp() {
  grid = new BillingGrid(document.getElementById('billing-grid'), onGridChange);
  const cats = await window.api.getCategories();
  grid.setCategories(cats);

  await loadMasters();
  bindUi();

  // Check for crash recovery drafts
  const drafts = await window.api.getDrafts();
  if (drafts && drafts.length > 0) {
    initTabsFromDrafts(drafts);
  } else {
    initDefaultTab();
  }

  showView('billing');
  document.getElementById('status-lang').textContent = getLang().toUpperCase();
}

async function loadMasters() {
  const tables = await window.api.getTables();
  const waiters = await window.api.getWaiters();
  fillSelect('field-table', tables, 'id', 'name', true);
  fillSelect('field-waiter', waiters, 'id', 'name', true);
  renderTableGrid(tables);
  renderMenuTable(await window.api.getItems());
  await loadSettingsForm();
}

function fillSelect(id, rows, valKey, labelKey, optional) {
  const sel = document.getElementById(id);
  sel.innerHTML = optional ? '<option value="">-- None --</option>' : '';
  (rows || []).forEach((r) => {
    const o = document.createElement('option');
    o.value = r[valKey];
    o.textContent = r[labelKey];
    sel.appendChild(o);
  });
}

function bindUi() {
  // Click-to-open menu bar (replaces CSS hover)
  const menuBarItems = document.querySelectorAll('.menu-bar > .menu-item');
  menuBarItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.menu-dropdown')) {
        // Click inside dropdown — close menu, let action bubble normally
        item.classList.remove('menu-open');
        return;
      }
      // Click on menu label — toggle open
      e.stopPropagation();
      const isOpen = item.classList.contains('menu-open');
      menuBarItems.forEach((m) => m.classList.remove('menu-open'));
      if (!isOpen) item.classList.add('menu-open');
    });
  });
  // Close all menus when clicking outside
  document.addEventListener('click', () => {
    menuBarItems.forEach((m) => m.classList.remove('menu-open'));
  });
  // Escape closes open menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menuBarItems.forEach((m) => m.classList.remove('menu-open'));
  });

  // Navigation
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.nav));
  });

  // Menu bar dropdown actions
  document.querySelectorAll('[data-action]').forEach((item) => {
    item.addEventListener('click', () => {
      const act = item.dataset.action;
      if (act === 'newBill') newBill();
      else if (act === 'saveBill') saveBill(false);
      else if (act === 'excel') showView('excel');
      else if (act === 'lock') lockApp();
      else if (act === 'deleteLine') grid.deleteCurrentRow();
      else if (act === 'undoItem') grid.undoLastItem();
      else if (act === 'discount') focusDiscount();
      else if (act === 'quickTable') openQuickAddMaster('table');
      else if (act === 'quickWaiter') openQuickAddMaster('waiter');
      else if (act === 'taxSetup') { showView('settings'); showSettingsTab('tax'); }
      else if (act === 'backup') runBackup();
      else if (act === 'toggleLang') toggleLanguage();
      else if (act === 'testPrint') window.api.testPrint();
      else if (act === 'help') showHelp();
    });
  });

  // Toolbar
  document.getElementById('btn-new').addEventListener('click', () => newBill());
  document.getElementById('btn-save').addEventListener('click', () => saveBill(false));
  document.getElementById('btn-payment').addEventListener('click', () => openPaymentModal());
  document.getElementById('btn-print').addEventListener('click', () => printCurrentBill());
  document.getElementById('btn-kot').addEventListener('click', () => printKot());
  document.getElementById('btn-hold').addEventListener('click', () => holdCurrentBill());
  document.getElementById('btn-recall').addEventListener('click', () => recallHeldBill());
  document.getElementById('btn-del-line').addEventListener('click', () => grid.deleteCurrentRow());
  document.getElementById('btn-cancel-bill').addEventListener('click', () => cancelActiveBill());
  document.getElementById('btn-lock').addEventListener('click', () => lockApp());

  // Quick pay and quick KOT from totals box
  document.getElementById('btn-quick-pay').addEventListener('click', () => openPaymentModal());
  document.getElementById('btn-quick-kot').addEventListener('click', () => printKot());

  // + buttons next to table & waiter
  document.getElementById('btn-quick-table').addEventListener('click', () => openQuickAddMaster('table'));
  document.getElementById('btn-quick-waiter').addEventListener('click', () => openQuickAddMaster('waiter'));

  // Discount toggles
  document.getElementById('chk-discount').addEventListener('change', (e) => {
    document.getElementById('field-discount-pct').disabled = !e.target.checked;
    if (e.target.checked) document.getElementById('field-discount-pct').focus();
    refreshTotals();
  });
  document.getElementById('field-discount-pct').addEventListener('input', () => refreshTotals());

  // Multi-tab button
  document.getElementById('btn-add-tab').addEventListener('click', () => addNewTab());

  // Tables view button
  document.getElementById('btn-add-table-view').addEventListener('click', () => openQuickAddMaster('table'));

  // Menu Search
  document.getElementById('menu-search-input').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const items = await window.api.searchItems(q, 100);
    renderMenuTable(items);
  });
  document.getElementById('btn-add-item').addEventListener('click', () => openItemEditModal());

  // Excel Centre
  document.getElementById('btn-import-menu').addEventListener('click', handleMenuImport);
  document.getElementById('btn-import-bills').addEventListener('click', handleBillsImport);
  document.getElementById('btn-export-daily').addEventListener('click', handleExportDaily);
  document.getElementById('excel-export-date').value = todayStr();

  // Reports
  document.getElementById('rep-from-date').value = todayStr();
  document.getElementById('rep-to-date').value = todayStr();
  document.getElementById('btn-load-report').addEventListener('click', runDetailedReport);
  document.getElementById('btn-export-full-excel').addEventListener('click', exportFullReportExcel);

  document.querySelectorAll('[data-rtab]').forEach((btn) => {
    btn.addEventListener('click', () => switchReportTab(btn.dataset.rtab));
  });

  // Settings
  document.querySelectorAll('[data-stab]').forEach((btn) => {
    btn.addEventListener('click', () => showSettingsTab(btn.dataset.stab));
  });
  document.getElementById('btn-save-settings').addEventListener('click', saveSettingsForm);
  document.getElementById('btn-pick-data').addEventListener('click', async () => {
    const f = await window.api.pickFolder();
    if (f) document.getElementById('set-data-folder').value = f;
  });
  document.getElementById('btn-pick-backup').addEventListener('click', async () => {
    const f = await window.api.pickFolder();
    if (f) document.getElementById('set-backup-folder').value = f;
  });
  document.getElementById('btn-pick-export').addEventListener('click', async () => {
    const f = await window.api.pickFolder();
    if (f) document.getElementById('set-export-folder').value = f;
  });

  // Tax Setup Buttons
  document.getElementById('btn-add-tax-rate').addEventListener('click', () => openTaxRateModal());
  document.getElementById('btn-add-tax-profile').addEventListener('click', () => openTaxProfileModal());
  document.getElementById('btn-export-tax-excel').addEventListener('click', async () => {
    const r = await window.api.exportTaxSettings();
    alert(`Tax settings exported (${r.ratesCount} rates, ${r.profilesCount} profiles)`);
  });
  document.getElementById('btn-import-tax-excel').addEventListener('click', async () => {
    const r = await window.api.importTaxSettings();
    if (!r.cancelled) {
      alert(`Imported ${r.ratesImported} rates and ${r.profilesImported} profiles.`);
      await loadTaxSetupData();
    }
  });

  // User Management
  document.getElementById('btn-add-user').addEventListener('click', () => openUserModal());

  // Backup & Restore
  document.getElementById('btn-backup-now').addEventListener('click', runBackup);

  // Settings Export / Import / Reset
  document.getElementById('btn-export-settings-json').addEventListener('click', async () => {
    const r = await window.api.exportSettingsBackup();
    alert(`Settings saved to: ${r.path}`);
  });
  document.getElementById('btn-import-settings-json').addEventListener('click', async () => {
    const r = await window.api.importSettingsBackup();
    if (!r.cancelled) {
      alert(`Successfully restored ${r.count} settings. Restarting views.`);
      await loadSettingsForm();
    }
  });
  document.getElementById('btn-reset-defaults').addEventListener('click', async () => {
    if (confirm('Reset all settings to shipped factory defaults?')) {
      await window.api.resetSettings();
      alert('Settings reset to defaults.');
      await loadSettingsForm();
    }
  });

  // Keyboard Reset
  document.getElementById('btn-reset-shortcuts').addEventListener('click', async () => {
    if (confirm('Reset all keyboard shortcuts to default?')) {
      await resetAllShortcuts();
      await loadShortcuts();
      renderShortcutsTable();
      setStatus('Shortcuts reset to default');
    }
  });

  // Test Print
  document.getElementById('btn-test-print').addEventListener('click', () => window.api.testPrint());
}

function showView(name) {
  navViews.forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });

  if (name === 'billing') {
    requestAnimationFrame(() => {
      const activeCell = document.querySelector('#billing-grid .cell-active input');
      if (activeCell) activeCell.focus();
    });
  } else if (name === 'tables') {
    window.api.getTables().then(renderTableGrid);
  } else if (name === 'menu') {
    window.api.getItems().then(renderMenuTable);
  } else if (name === 'reports') {
    runDetailedReport();
  } else if (name === 'settings') {
    loadSettingsForm();
  }
}

function showSettingsTab(tabName) {
  ['shop', 'tax', 'billing', 'printer', 'paths', 'keyboard', 'users', 'backup', 'appearance'].forEach((t) => {
    const el = document.getElementById(`stab-${t}`);
    if (el) el.classList.toggle('hidden', t !== tabName);
  });
  document.querySelectorAll('.snav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.stab === tabName);
  });
}

// Multi-Bill Tab Management
async function initDefaultTab() {
  const billNo = await window.api.nextBillNo();
  tabs = [
    {
      id: 'tab-1',
      name: billNo,
      bill_no: billNo,
      date_time: toLocalDatetime(new Date()),
      order_type: 'Dine-in',
      table_id: '',
      waiter_id: '',
      customer_name: '',
      customer_phone: '',
      customer_address: '',
      remark: '',
      discount_percent: 0,
      lines: [],
    },
  ];
  activeTabId = 'tab-1';
  renderTabs();
  loadTabToForm(tabs[0]);
}

function initTabsFromDrafts(drafts) {
  tabs = drafts.map((d, idx) => ({
    id: d.tabId || `tab-${idx + 1}`,
    name: d.tabName || d.payload?.bill_no || `Bill ${idx + 1}`,
    ...d.payload,
  }));
  activeTabId = tabs[0].id;
  renderTabs();
  loadTabToForm(tabs[0]);
  setStatus('Restored unsaved bills from previous session.');
}

async function addNewTab() {
  saveCurrentFormToTab();
  const billNo = await window.api.nextBillNo();
  const newTab = {
    id: `tab-${Date.now()}`,
    name: billNo,
    bill_no: billNo,
    date_time: toLocalDatetime(new Date()),
    order_type: 'Dine-in',
    table_id: '',
    waiter_id: '',
    customer_name: '',
    customer_phone: '',
    customer_address: '',
    remark: '',
    discount_percent: 0,
    lines: [],
  };
  tabs.push(newTab);
  activeTabId = newTab.id;
  renderTabs();
  loadTabToForm(newTab);
  persistActiveTabDraft();
}

function closeTab(tabId) {
  if (tabs.length <= 1) {
    newBill();
    return;
  }
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx !== -1) {
    window.api.removeDraft(tabId);
    tabs.splice(idx, 1);
    if (activeTabId === tabId) {
      activeTabId = tabs[Math.max(0, idx - 1)].id;
      loadTabToForm(tabs.find((t) => t.id === activeTabId));
    }
    renderTabs();
  }
}

function switchTab(tabId) {
  saveCurrentFormToTab();
  activeTabId = tabId;
  const target = tabs.find((t) => t.id === tabId);
  if (target) {
    loadTabToForm(target);
    renderTabs();
  }
}

function nextTab() {
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const nextIdx = (idx + 1) % tabs.length;
  switchTab(tabs[nextIdx].id);
}

function prevTab() {
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const prevIdx = (idx - 1 + tabs.length) % tabs.length;
  switchTab(tabs[prevIdx].id);
}

function renderTabs() {
  const container = document.getElementById('bill-tabs');
  container.innerHTML = '';
  tabs.forEach((tab) => {
    const div = document.createElement('div');
    div.className = `bill-tab ${tab.id === activeTabId ? 'active' : ''}`;
    div.innerHTML = `<span>${tab.name || tab.bill_no}</span><span class="tab-close" title="Close (Ctrl+W)">×</span>`;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        closeTab(tab.id);
      } else {
        switchTab(tab.id);
      }
    });
    container.appendChild(div);
  });
}

function saveCurrentFormToTab() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  tab.bill_no = document.getElementById('field-bill-no').value;
  tab.date_time = document.getElementById('field-date').value;
  tab.order_type = document.getElementById('field-order-type').value;
  tab.table_id = document.getElementById('field-table').value;
  tab.waiter_id = document.getElementById('field-waiter').value;
  tab.customer_name = document.getElementById('field-customer').value;
  tab.customer_phone = document.getElementById('field-phone').value;
  tab.customer_address = document.getElementById('field-address').value;
  tab.remark = document.getElementById('field-remark').value;
  tab.discount_percent = document.getElementById('chk-discount').checked
    ? parseFloat(document.getElementById('field-discount-pct').value) || 0
    : 0;
  tab.lines = grid.getLines();
}

function loadTabToForm(tab) {
  document.getElementById('field-bill-no').value = tab.bill_no || '';
  document.getElementById('title-bill').textContent = tab.bill_no || '';
  document.getElementById('field-date').value = tab.date_time || toLocalDatetime(new Date());
  document.getElementById('field-order-type').value = tab.order_type || 'Dine-in';
  document.getElementById('field-table').value = tab.table_id || '';
  document.getElementById('field-waiter').value = tab.waiter_id || '';
  document.getElementById('field-customer').value = tab.customer_name || '';
  document.getElementById('field-phone').value = tab.customer_phone || '';
  document.getElementById('field-address').value = tab.customer_address || '';
  document.getElementById('field-remark').value = tab.remark || '';

  const hasDiscount = (Number(tab.discount_percent) || 0) > 0;
  document.getElementById('chk-discount').checked = hasDiscount;
  document.getElementById('field-discount-pct').disabled = !hasDiscount;
  document.getElementById('field-discount-pct').value = hasDiscount ? tab.discount_percent : '';

  grid.setLines(tab.lines || []);
  refreshTotals();
}

function persistActiveTabDraft() {
  saveCurrentFormToTab();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (tab) {
    window.api.saveDraft(tab.id, tab.name || tab.bill_no, tab);
  }
}

function onGridChange() {
  persistActiveTabDraft();
  refreshTotals();
}

function collectBillPayload(paymentMode = 'Cash', payments = null) {
  saveCurrentFormToTab();
  const tab = tabs.find((t) => t.id === activeTabId);
  return {
    bill_no: tab.bill_no,
    date_time: new Date(tab.date_time || Date.now()).toISOString(),
    order_type: tab.order_type,
    table_id: tab.table_id || null,
    waiter_id: tab.waiter_id || null,
    customer_name: tab.customer_name,
    customer_phone: tab.customer_phone,
    customer_address: tab.customer_address,
    remark: tab.remark,
    discount_percent: tab.discount_percent,
    use_discount_percent: tab.discount_percent > 0,
    lines: tab.lines,
    payment_mode: paymentMode,
    payments: payments,
  };
}

async function refreshTotals() {
  const payload = collectBillPayload();
  if (!payload.lines || payload.lines.length === 0) {
    resetTotalsDisplay();
    return;
  }

  try {
    const totals = await window.api.previewBill(payload);
    document.getElementById('total-subtotal').textContent = totals.subtotal.toFixed(2);
    document.getElementById('total-discount').textContent = totals.discount.toFixed(2);
    document.getElementById('total-roundoff').textContent = totals.round_off.toFixed(2);
    document.getElementById('total-net').textContent = `₹${totals.total.toFixed(2)}`;

    const taxContainer = document.getElementById('tax-rows');
    taxContainer.innerHTML = '';
    (totals.billTaxes || []).forEach((tx) => {
      const div = document.createElement('div');
      div.className = 'tot-row';
      div.innerHTML = `<span>${tx.component_name} (${tx.percent}%)</span><span>₹${tx.tax_amount.toFixed(2)}</span>`;
      taxContainer.appendChild(div);
    });

    document.getElementById('tax-warning').classList.toggle('hidden', !totals.mixedTaxWarning);
  } catch {
    resetTotalsDisplay();
  }
}

function resetTotalsDisplay() {
  document.getElementById('total-subtotal').textContent = '0.00';
  document.getElementById('total-discount').textContent = '0.00';
  document.getElementById('total-roundoff').textContent = '0.00';
  document.getElementById('total-net').textContent = '₹0.00';
  document.getElementById('tax-rows').innerHTML = '';
  document.getElementById('tax-warning').classList.add('hidden');
}

async function newBill() {
  const billNo = await window.api.nextBillNo();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (tab) {
    tab.bill_no = billNo;
    tab.name = billNo;
    tab.date_time = toLocalDatetime(new Date());
    tab.order_type = 'Dine-in';
    tab.table_id = '';
    tab.waiter_id = '';
    tab.customer_name = '';
    tab.customer_phone = '';
    tab.customer_address = '';
    tab.remark = '';
    tab.discount_percent = 0;
    tab.lines = [];
    loadTabToForm(tab);
    renderTabs();
    persistActiveTabDraft();
  }
  lastSavedBillId = null;
  setStatus(t('status.ready'));
}

async function saveBill(fromPayment = false, paymentMode = 'Cash', splitPayments = null) {
  const payload = collectBillPayload(paymentMode, splitPayments);
  if (!payload.lines || payload.lines.length === 0) {
    alert(t('msg.noItems'));
    return null;
  }

  try {
    const res = await window.api.saveBill(payload);
    lastSavedBillId = res.billId;
    setStatus(`${t('msg.saved')}: ${res.billNo}`);
    window.api.removeDraft(activeTabId);
    return res;
  } catch (err) {
    alert(`${t('msg.error')}: ${err.message}`);
    return null;
  }
}

async function printCurrentBill() {
  let id = lastSavedBillId;
  if (!id) {
    const saved = await saveBill(true);
    id = saved?.billId;
  }
  if (id) {
    await window.api.printBill(id);
    setStatus(`Bill printed: #${id}`);
  }
}

async function printKot() {
  const lines = grid.getLines();
  if (!lines.length) {
    alert(t('msg.noItems'));
    return;
  }
  const tableSel = document.getElementById('field-table');
  const waiterSel = document.getElementById('field-waiter');
  await window.api.printKot({
    table: tableSel.selectedIndex >= 0 ? tableSel.selectedOptions[0].text : 'Takeaway',
    waiter: waiterSel.selectedIndex >= 0 ? waiterSel.selectedOptions[0].text : '',
    items: lines.map((l) => ({ name: l.name_snapshot, qty: l.qty })),
    note: document.getElementById('field-remark').value,
  });
  setStatus('KOT printed successfully');
}

function openPaymentModal() {
  const payload = collectBillPayload();
  if (!payload.lines || payload.lines.length === 0) {
    alert(t('msg.noItems'));
    return;
  }

  window.api.previewBill(payload).then((totals) => {
    const totalPayable = totals.total;
    const modalHtml = `
      <div style="font-size: 15px; margin-bottom: 12px;">
        Total Amount: <strong style="font-size: 20px; color: #28a745;">₹${totalPayable.toFixed(2)}</strong>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px;">
        <button type="button" class="btn btn-primary btn-pay-mode" data-mode="Cash">1 - Cash</button>
        <button type="button" class="btn btn-primary btn-pay-mode" data-mode="UPI">2 - UPI</button>
        <button type="button" class="btn btn-primary btn-pay-mode" data-mode="Card">3 - Card</button>
        <button type="button" class="btn btn-secondary btn-pay-mode" data-mode="Split">4 - Split</button>
      </div>
      <div id="payment-standard-box">
        <label style="display:block; font-weight:bold; margin-bottom: 4px;">Amount Received (₹):</label>
        <input id="pay-received" type="number" step="1" value="${Math.ceil(totalPayable)}" style="font-size: 20px; width: 100%; padding: 6px;" autofocus />
        <div style="font-size: 16px; margin-top: 10px; font-weight: bold;">
          Change / Balance: <span id="pay-change" style="color: #0066cc;">₹0.00</span>
        </div>
      </div>
      <div id="payment-split-box" class="hidden" style="margin-top: 10px;">
        <label style="display:block; margin-bottom:4px;">Cash Amount (₹): <input id="pay-split-cash" type="number" min="0" value="${totalPayable}" style="width: 100%; padding:4px;" /></label>
        <label style="display:block; margin-bottom:4px;">UPI Amount (₹): <input id="pay-split-upi" type="number" min="0" value="0" style="width: 100%; padding:4px;" /></label>
        <label style="display:block; margin-bottom:8px;">Card Amount (₹): <input id="pay-split-card" type="number" min="0" value="0" style="width: 100%; padding:4px;" /></label>
        <button type="button" id="btn-confirm-split" class="btn btn-success" style="width:100%; font-size:16px; padding:8px;">Confirm Split Payment</button>
      </div>
    `;

    showModal(t('payment.title'), modalHtml, (root) => {
      const recInput = root.querySelector('#pay-received');
      const changeEl = root.querySelector('#pay-change');
      let chosenMode = 'Cash';

      // Ensure modal input has focus — grid render() may fire a rAF to steal it back
      // Use double rAF to run after grid's pending rAF completes
      requestAnimationFrame(() => requestAnimationFrame(() => recInput?.focus()));

      const updateChange = () => {
        const rec = parseFloat(recInput.value) || 0;
        const chg = Math.max(0, rec - totalPayable);
        changeEl.textContent = `₹${chg.toFixed(2)}`;
      };
      recInput.addEventListener('input', updateChange);
      updateChange();

      const doPayAndClose = async (mode, splitPayments) => {
        const res = await saveBill(true, mode, splitPayments);
        if (res) {
          closeModal(); // closeModal handles removing _payModalKeyListener
          const s = await window.api.getSettings();
          if (s.auto_print !== false) {
            await window.api.printBill(res.billId);
          }
          await newBill();
        }
      };

      // Mode buttons
      const highlightMode = (mode) => {
        root.querySelectorAll('.btn-pay-mode').forEach((b) => {
          b.style.outline = b.dataset.mode === mode ? '3px solid #fff' : '';
          b.style.boxShadow = b.dataset.mode === mode ? '0 0 0 3px #0056b3' : '';
        });
      };
      highlightMode(chosenMode);

      root.querySelectorAll('.btn-pay-mode').forEach((btn) => {
        btn.addEventListener('click', async () => {
          chosenMode = btn.dataset.mode;
          highlightMode(chosenMode);
          if (chosenMode === 'Split') {
            root.querySelector('#payment-standard-box').classList.add('hidden');
            root.querySelector('#payment-split-box').classList.remove('hidden');
            root.querySelector('#pay-split-cash').focus();
            return;
          }
          await doPayAndClose(chosenMode, null);
        });
      });

      // Split payment confirm button
      root.querySelector('#btn-confirm-split')?.addEventListener('click', async () => {
        const cashAmt = parseFloat(root.querySelector('#pay-split-cash').value) || 0;
        const upiAmt = parseFloat(root.querySelector('#pay-split-upi').value) || 0;
        const cardAmt = parseFloat(root.querySelector('#pay-split-card').value) || 0;
        const splitTotal = cashAmt + upiAmt + cardAmt;
        if (Math.abs(splitTotal - totalPayable) > 0.5) {
          alert(`Split amounts total ₹${splitTotal.toFixed(2)} does not match bill ₹${totalPayable.toFixed(2)}`);
          return;
        }
        const splitPayments = [];
        if (cashAmt > 0) splitPayments.push({ mode: 'Cash', amount: cashAmt });
        if (upiAmt > 0) splitPayments.push({ mode: 'UPI', amount: upiAmt });
        if (cardAmt > 0) splitPayments.push({ mode: 'Card', amount: cardAmt });
        await doPayAndClose('Split', splitPayments);
      });

      // Keyboard: 1/2/3/4 = select mode, Enter = confirm, ←/→ = cycle modes
      const PAY_MODES = ['Cash', 'UPI', 'Card', 'Split'];
      _payModalKeyListener = async (e) => {
        const tag = document.activeElement?.tagName;

        // Arrow keys cycle payment modes even when amount input is focused
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const idx = PAY_MODES.indexOf(chosenMode);
          chosenMode = PAY_MODES[e.key === 'ArrowRight' ? (idx + 1) % PAY_MODES.length : (idx - 1 + PAY_MODES.length) % PAY_MODES.length];
          highlightMode(chosenMode);
          return;
        }

        // Enter always confirms current mode (from input or elsewhere)
        if (e.key === 'Enter') {
          e.preventDefault();
          root.querySelector(`[data-mode="${chosenMode}"]`)?.click();
          return;
        }

        // Number shortcuts only when not typing in an input
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if (e.key === '1') { e.preventDefault(); root.querySelector('[data-mode="Cash"]')?.click(); }
        else if (e.key === '2') { e.preventDefault(); root.querySelector('[data-mode="UPI"]')?.click(); }
        else if (e.key === '3') { e.preventDefault(); root.querySelector('[data-mode="Card"]')?.click(); }
        else if (e.key === '4') { e.preventDefault(); root.querySelector('[data-mode="Split"]')?.click(); }
      };
      document.addEventListener('keydown', _payModalKeyListener);
    });
  });
}

async function cancelActiveBill() {
  if (currentUser?.role !== 'admin') {
    alert('Admin role required to cancel bills');
    return;
  }

  const reason = prompt(t('msg.confirmCancel'));
  if (reason) {
    if (lastSavedBillId) {
      await window.api.cancelBill(lastSavedBillId, reason);
      alert(t('msg.billDeleted'));
      await newBill();
    } else {
      newBill();
    }
  }
}

async function holdCurrentBill() {
  const payload = collectBillPayload();
  if (!payload.lines || payload.lines.length === 0) {
    alert(t('msg.noItems'));
    return;
  }
  const label = `${payload.bill_no} (${payload.order_type})`;
  await window.api.holdBill(label, payload);
  setStatus(`Bill held: ${label}`);
  window.api.removeDraft(activeTabId);
  await newBill();
}

async function recallHeldBill() {
  const held = await window.api.listHeldBills();
  if (!held || held.length === 0) {
    alert('No held bills found.');
    return;
  }

  const listHtml = `
    <div style="max-height: 250px; overflow-y: auto;">
      ${held
        .map(
          (h) => `
        <div class="recall-row" style="display:flex; justify-content:space-between; align-items:center; padding: 8px; border-bottom: 1px solid #ddd;">
          <span><strong>${h.label}</strong> <small style="color:#777">(${new Date(h.created_at).toLocaleTimeString()})</small></span>
          <button type="button" class="btn btn-primary btn-recall-item" data-id="${h.id}">Recall</button>
        </div>`
        )
        .join('')}
    </div>
  `;

  showModal(t('toolbar.recall'), listHtml, (root) => {
    root.querySelectorAll('.btn-recall-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const data = await window.api.recallHeldBill(id);
        if (data) {
          const tab = tabs.find((t) => t.id === activeTabId);
          if (tab) {
            Object.assign(tab, data);
            loadTabToForm(tab);
            renderTabs();
            persistActiveTabDraft();
          }
          closeModal();
          setStatus('Bill recalled successfully');
        }
      });
    });
    // keyboard nav for list rows
    const rows = [...root.querySelectorAll('.recall-row')];
    rows.forEach((row) => {
      row.setAttribute('tabindex', '0');
      row.style.cursor = 'pointer';
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          row.querySelector('.btn-recall-item')?.click();
        }
      });
      row.addEventListener('focus', () => { row.style.background = '#dce8ff'; });
      row.addEventListener('blur', () => { row.style.background = ''; });
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const idx = rows.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'ArrowDown') rows[Math.min(idx + 1, rows.length - 1)].focus();
      else rows[Math.max(idx - 1, 0)].focus();
    });
    if (rows.length) rows[0].focus();
  });
}

// Quick Add Master (Table / Waiter)
function openQuickAddMaster(type) {
  const isTable = type === 'table';
  const title = isTable ? 'Add Table | மேசை சேர்' : 'Add Waiter | பரிமாறுபவர் சேர்';
  const html = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <label>Name: <input id="quick-master-name" style="width:100%; padding:6px;" autofocus /></label>
      ${isTable ? `<label>Section: <input id="quick-master-sec" value="General" style="width:100%; padding:6px;" /></label>` : ''}
      <button type="button" id="btn-quick-master-save" class="btn btn-success" style="margin-top: 8px;">Save & Add</button>
    </div>
  `;

  showModal(title, html, (root) => {
    root.querySelector('#btn-quick-master-save').addEventListener('click', async () => {
      const name = root.querySelector('#quick-master-name').value.trim();
      if (!name) return;
      if (isTable) {
        const sec = root.querySelector('#quick-master-sec').value.trim() || 'General';
        const res = await window.api.createTable(name, sec);
        await loadMasters();
        document.getElementById('field-table').value = res.id;
      } else {
        const res = await window.api.createWaiter(name);
        await loadMasters();
        document.getElementById('field-waiter').value = res.id;
      }
      closeModal();
      setStatus(`Added ${name}`);
    });
  });
}

// Item Master Add / Edit
function openItemEditModal(item = null) {
  window.api.getCategories().then((cats) => {
    window.api.getTaxProfiles().then((profiles) => {
      const html = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <label>Code: <input id="item-code" value="${item?.code || ''}" /></label>
          <label>Category:
            <select id="item-cat">
              ${cats.map((c) => `<option value="${c.id}" ${c.id === item?.category_id ? 'selected' : ''}>${c.name_en}</option>`).join('')}
            </select>
          </label>
          <label>Name (English): <input id="item-name-en" value="${item?.name_en || ''}" /></label>
          <label>Name (Tamil): <input id="item-name-ta" value="${item?.name_ta || ''}" /></label>
          <label>Price (₹): <input id="item-price" type="number" step="0.5" value="${item?.price || 0}" /></label>
          <label>Unit: <input id="item-unit" value="${item?.unit || 'Plate'}" /></label>
          <label class="span-2">Tax Profile:
            <select id="item-tax">
              ${profiles.map((p) => `<option value="${p.id}" ${p.id === item?.tax_profile_id ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" id="btn-save-menu-item" class="btn btn-success">Save Item</button>
        </div>
      `;

      showModal(item ? 'Edit Menu Item' : 'Add Menu Item', html, (root) => {
        root.querySelector('#btn-save-menu-item').addEventListener('click', async () => {
          const payload = {
            id: item?.id || null,
            code: root.querySelector('#item-code').value.trim(),
            category_id: parseInt(root.querySelector('#item-cat').value, 10),
            name_en: root.querySelector('#item-name-en').value.trim(),
            name_ta: root.querySelector('#item-name-ta').value.trim(),
            price: parseFloat(root.querySelector('#item-price').value) || 0,
            unit: root.querySelector('#item-unit').value.trim() || 'Plate',
            tax_profile_id: parseInt(root.querySelector('#item-tax').value, 10),
          };
          if (!payload.code || !payload.name_en) {
            alert('Code and Name are required');
            return;
          }
          await window.api.saveItem(payload);
          closeModal();
          const items = await window.api.getItems();
          renderMenuTable(items);
          grid.setCategories(await window.api.getCategories());
          setStatus(`Item saved: ${payload.name_en}`);
        });
      });
    });
  });
}

// Table Cards View
function renderTableGrid(tables) {
  const container = document.getElementById('table-grid');
  container.innerHTML = '';
  (tables || []).forEach((t, idx) => {
    const div = document.createElement('div');
    div.className = `table-cell ${t.status || 'free'}`;
    div.tabIndex = 0;
    div.innerHTML = `<div>${t.name}</div><small>${t.section || 'General'}</small><div style="font-size:11px; margin-top:4px;">${t.status.toUpperCase()}</div>`;
    div.addEventListener('click', () => {
      document.getElementById('field-table').value = t.id;
      showView('billing');
    });
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') div.click();
    });
    container.appendChild(div);
  });
}

// Menu Table
function renderMenuTable(items) {
  const tbody = document.querySelector('#menu-table tbody');
  tbody.innerHTML = '';
  (items || []).forEach((it) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${it.code}</strong></td>
      <td>${it.category_en || ''}</td>
      <td>${it.name_en}</td>
      <td>${it.name_ta || ''}</td>
      <td>₹${Number(it.price).toFixed(2)}</td>
      <td>${it.tax_profile_name || 'Restaurant 5%'}</td>
      <td>${it.unit || 'Plate'}</td>
      <td>
        <button type="button" class="btn btn-secondary btn-sm btn-edit-it">Edit</button>
        <button type="button" class="btn btn-danger btn-sm btn-del-it">Deactivate</button>
      </td>
    `;
    tr.querySelector('.btn-edit-it').addEventListener('click', () => openItemEditModal(it));
    tr.querySelector('.btn-del-it').addEventListener('click', async () => {
      if (confirm(`Deactivate item ${it.name_en}?`)) {
        await window.api.deleteItem(it.id);
        renderMenuTable(await window.api.getItems());
      }
    });
    tbody.appendChild(tr);
  });
}

// Excel Centre Logic
async function handleMenuImport() {
  const res = await window.api.importMenu();
  if (res.cancelled) return;
  const pArea = document.getElementById('excel-preview-area');
  const pContent = document.getElementById('excel-preview-content');
  pArea.classList.remove('hidden');

  let html = `<p><strong>Imported Items:</strong> ${res.imported} / ${res.preview?.length || 0}</p>`;
  if (res.errors && res.errors.length > 0) {
    html += `<div class="alert-danger">Errors in ${res.errors.length} rows:
      <ul>${res.errors.map((e) => `<li>Row ${e.row} [${e.code}]: ${e.messages.join(', ')}</li>`).join('')}</ul>
    </div>`;
  }
  pContent.innerHTML = html;
  grid.setCategories(await window.api.getCategories());
  renderMenuTable(await window.api.getItems());
}

async function handleBillsImport() {
  const val = await window.api.validateBills();
  if (val.cancelled) return;

  const pArea = document.getElementById('excel-preview-area');
  const pContent = document.getElementById('excel-preview-content');
  pArea.classList.remove('hidden');

  let dupAction = 'skip';
  let dupHtml = '';
  if (val.duplicateCount > 0) {
    dupHtml = `
      <div style="background:#fff3cd; padding:8px; border:1px solid #ffeeba; margin: 8px 0; border-radius:3px;">
        <strong>⚠️ ${val.duplicateCount} Duplicate Bills Detected!</strong> Choose action:
        <div style="display:flex; gap:12px; margin-top:4px;">
          <label><input type="radio" name="dupOpt" value="skip" checked /> Skip duplicates (S)</label>
          <label><input type="radio" name="dupOpt" value="overwrite" /> Overwrite existing (O)</label>
          <label><input type="radio" name="dupOpt" value="renumber" /> Renumber new bills (R)</label>
        </div>
      </div>
    `;
  }

  pContent.innerHTML = `
    <div><strong>Total Bills to Import:</strong> ${val.totalBills} | <strong>Errors:</strong> ${val.errorCount}</div>
    ${dupHtml}
    <div style="margin-top:10px;">
      <button type="button" id="btn-confirm-import-bills" class="btn btn-success">Confirm & Commit Import</button>
    </div>
  `;

  document.querySelectorAll('input[name="dupOpt"]').forEach((r) => {
    r.addEventListener('change', (e) => { dupAction = e.target.value; });
  });

  document.getElementById('btn-confirm-import-bills').addEventListener('click', async () => {
    const res = await window.api.importBills(val.filePath, dupAction);
    pContent.innerHTML = `<div class="alert-success">Successfully saved ${res.saved} bills (${res.skipped || 0} skipped).</div>`;
    setStatus(`Imported ${res.saved} bills`);
  });
}

async function handleExportDaily() {
  const d = document.getElementById('excel-export-date').value || todayStr();
  const res = await window.api.exportDaily(d);
  alert(`Daily sales report exported (${res.count} bills). Saved to Export folder.`);
}

// Reports Logic
let activeReportTab = 'bills';
let reportDataCache = null;

async function runDetailedReport() {
  const fromDate = document.getElementById('rep-from-date').value || todayStr();
  const toDate = document.getElementById('rep-to-date').value || todayStr();

  const data = await window.api.detailedReport(fromDate, toDate);
  reportDataCache = data;

  // Update KPIs
  document.getElementById('kpi-bills').textContent = data.summary.total_bills;
  document.getElementById('kpi-subtotal').textContent = `₹${data.summary.total_subtotal.toFixed(2)}`;
  document.getElementById('kpi-discount').textContent = `₹${data.summary.total_discount.toFixed(2)}`;
  document.getElementById('kpi-tax').textContent = `₹${data.summary.total_tax.toFixed(2)}`;
  document.getElementById('kpi-sales').textContent = `₹${data.summary.total_sales.toFixed(2)}`;

  renderReportTable();
}

function switchReportTab(tabKey) {
  activeReportTab = tabKey;
  document.querySelectorAll('.subtab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.rtab === tabKey);
  });
  renderReportTable();
}

function renderReportTable() {
  if (!reportDataCache) return;
  const thead = document.querySelector('#report-table thead');
  const tbody = document.querySelector('#report-table tbody');

  if (activeReportTab === 'bills') {
    thead.innerHTML = `<tr><th>Bill No</th><th>Date</th><th>Type</th><th>Customer</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Payment</th><th>Status</th></tr>`;
    tbody.innerHTML = (reportDataCache.bills || [])
      .map(
        (b) => `<tr>
          <td><strong>${b.bill_no}</strong></td>
          <td>${new Date(b.date_time).toLocaleDateString()}</td>
          <td>${b.order_type}</td>
          <td>${b.customer_name || '-'}</td>
          <td>₹${b.subtotal.toFixed(2)}</td>
          <td>₹${b.tax_total.toFixed(2)}</td>
          <td><strong>₹${b.total.toFixed(2)}</strong></td>
          <td>${b.payment_mode}</td>
          <td>${b.status}</td>
        </tr>`
      )
      .join('');
  } else if (activeReportTab === 'items') {
    thead.innerHTML = `<tr><th>Item Name</th><th>Unit</th><th>Qty Sold</th><th>Total Revenue (₹)</th></tr>`;
    tbody.innerHTML = (reportDataCache.byItem || [])
      .map((it) => `<tr><td><strong>${it.item_name}</strong></td><td>${it.unit}</td><td>${it.total_qty}</td><td>₹${it.total_amount.toFixed(2)}</td></tr>`)
      .join('');
  } else if (activeReportTab === 'categories') {
    thead.innerHTML = `<tr><th>Category Name</th><th>Qty Sold</th><th>Total Revenue (₹)</th></tr>`;
    tbody.innerHTML = (reportDataCache.byCategory || [])
      .map((c) => `<tr><td><strong>${c.category_name}</strong></td><td>${c.total_qty}</td><td>₹${c.total_amount.toFixed(2)}</td></tr>`)
      .join('');
  } else if (activeReportTab === 'payments') {
    thead.innerHTML = `<tr><th>Payment Mode</th><th>Bill Count</th><th>Total Collected (₹)</th></tr>`;
    tbody.innerHTML = (reportDataCache.byPayment || [])
      .map((p) => `<tr><td><strong>${p.payment_mode}</strong></td><td>${p.count}</td><td>₹${p.amount.toFixed(2)}</td></tr>`)
      .join('');
  } else if (activeReportTab === 'gst') {
    thead.innerHTML = `<tr><th>Tax Component</th><th>Rate (%)</th><th>Taxable Amount (₹)</th><th>Tax Amount (₹)</th></tr>`;
    tbody.innerHTML = (reportDataCache.byGst || [])
      .map((g) => `<tr><td><strong>${g.component_name}</strong></td><td>${g.percent}%</td><td>₹${g.taxable_amount.toFixed(2)}</td><td>₹${g.tax_amount.toFixed(2)}</td></tr>`)
      .join('');
  }
}

async function exportFullReportExcel() {
  const fromDate = document.getElementById('rep-from-date').value || todayStr();
  const toDate = document.getElementById('rep-to-date').value || todayStr();
  await window.api.exportDetailedReport(fromDate, toDate);
  alert('Excel report generated and saved to Export folder.');
}

// Settings Forms & Masters
async function loadSettingsForm() {
  const s = await window.api.getSettings();
  document.getElementById('set-shop-en').value = s.shop_name_en || '';
  document.getElementById('set-shop-ta').value = s.shop_name_ta || '';
  document.getElementById('set-addr-en').value = s.shop_address_en || '';
  document.getElementById('set-addr-ta').value = s.shop_address_ta || '';
  document.getElementById('set-phone').value = s.shop_phone || '';
  document.getElementById('set-gstin').value = s.gstin || '';
  document.getElementById('set-fssai').value = s.fssai || '';
  document.getElementById('set-footer').value = s.footer_message || '';

  document.getElementById('set-gst-enabled').checked = s.gst_enabled !== false;
  document.getElementById('set-price-mode').value = s.price_mode || 'exclusive';
  document.getElementById('set-roundoff').value = s.round_off || 'rupee';

  document.getElementById('set-bill-prefix').value = s.bill_prefix || '';
  document.getElementById('set-bill-digits').value = s.bill_digits || 6;
  document.getElementById('set-bill-reset').value = s.bill_reset || 'yearly';
  document.getElementById('set-fy-month').value = s.fy_start_month || 4;
  document.getElementById('set-bill-color').value = s.bill_no_color || '#ffff99';

  document.getElementById('set-show-customer').checked = s.show_customer !== false;
  document.getElementById('set-show-address').checked = s.show_address !== false;
  document.getElementById('set-show-table').checked = s.show_table !== false;
  document.getElementById('set-show-waiter').checked = s.show_waiter !== false;
  document.getElementById('set-show-remark').checked = s.show_remark !== false;

  document.getElementById('set-paper-width').value = s.printer_paper || '80';
  document.getElementById('set-bill-lang').value = s.bill_language || 'both';
  document.getElementById('set-print-copies').value = s.print_copies || 1;
  document.getElementById('set-auto-print').checked = !!s.auto_print;

  const paths = await window.api.getPaths();
  document.getElementById('set-data-folder').value = paths.dataFolder || '';
  document.getElementById('set-backup-folder').value = paths.backupFolder || '';
  document.getElementById('set-export-folder').value = paths.exportFolder || '';
  document.getElementById('set-usb-folder').value = paths.usbFolder || '';

  document.getElementById('set-theme').value = s.theme || 'light';
  document.getElementById('set-font-size').value = s.font_size || 'normal';

  // Load printer choices
  const printers = await window.api.getPrinters();
  const prnSelect = document.getElementById('set-printer-select');
  prnSelect.innerHTML = '<option value="">Default Windows Printer</option>';
  (printers || []).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    if (p.name === s.printer_name) opt.selected = true;
    prnSelect.appendChild(opt);
  });

  await loadTaxSetupData();
  renderShortcutsTable();
  await loadUsersList();
  await loadBackupsList();
}

async function loadTaxSetupData() {
  const rates = await window.api.getTaxRates();
  const profiles = await window.api.getTaxProfiles();

  // Render profiles
  const pContainer = document.getElementById('tax-profiles-container');
  pContainer.innerHTML = (profiles || [])
    .map(
      (p) => `
      <div class="tax-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${p.name}</strong>
          ${p.is_default ? '<span class="badge free">DEFAULT</span>' : ''}
        </div>
        <div style="font-size:12px; color:#555; margin: 4px 0;">Mode: ${p.price_mode}</div>
        <div style="font-size:11px; color:#777;">
          Rates: ${(p.rates || []).map((r) => `${r.name} (${r.percent}%)`).join(', ') || 'None'}
        </div>
      </div>`
    )
    .join('');

  // Render rates table
  const tbody = document.querySelector('#tax-rates-table tbody');
  tbody.innerHTML = (rates || [])
    .map(
      (r) => `
      <tr>
        <td>${r.id}</td>
        <td><strong>${r.name}</strong></td>
        <td>${r.component_type}</td>
        <td>${r.percent}%</td>
        <td>${r.effective_from || 'Always'}</td>
        <td>${r.is_active ? '<span style="color:green">Active</span>' : '<span style="color:red">Inactive</span>'}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm btn-edit-rate" data-id="${r.id}">Edit</button>
          <button type="button" class="btn btn-danger btn-sm btn-del-rate" data-id="${r.id}">Delete</button>
        </td>
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit-rate').forEach((b) => {
    b.addEventListener('click', () => {
      const rate = rates.find((x) => x.id === Number(b.dataset.id));
      if (rate) openTaxRateModal(rate);
    });
  });
  tbody.querySelectorAll('.btn-del-rate').forEach((b) => {
    b.addEventListener('click', async () => {
      if (confirm('Deactivate / delete this tax rate?')) {
        const res = await window.api.deleteTaxRate(Number(b.dataset.id));
        if (res.message) alert(res.message);
        await loadTaxSetupData();
      }
    });
  });
}

function openTaxRateModal(rate = null) {
  const html = `
    <div class="form-grid">
      <label>Rate Name: <input id="tr-name" value="${rate?.name || ''}" placeholder="e.g. CGST 2.5%" /></label>
      <label>Component Type:
        <select id="tr-type">
          <option value="CGST" ${rate?.component_type === 'CGST' ? 'selected' : ''}>CGST</option>
          <option value="SGST" ${rate?.component_type === 'SGST' ? 'selected' : ''}>SGST</option>
          <option value="IGST" ${rate?.component_type === 'IGST' ? 'selected' : ''}>IGST</option>
          <option value="CESS" ${rate?.component_type === 'CESS' ? 'selected' : ''}>CESS</option>
          <option value="OTHER" ${rate?.component_type === 'OTHER' ? 'selected' : ''}>OTHER</option>
        </select>
      </label>
      <label>Percent (%): <input id="tr-percent" type="number" step="0.1" value="${rate?.percent || 0}" /></label>
      <label>Effective From: <input id="tr-from" type="date" value="${rate?.effective_from || ''}" /></label>
    </div>
    <div class="modal-actions">
      <button type="button" id="btn-save-tr" class="btn btn-success">Save Rate</button>
    </div>
  `;

  showModal(rate ? 'Edit Tax Rate' : 'Add Tax Rate', html, (root) => {
    root.querySelector('#btn-save-tr').addEventListener('click', async () => {
      const payload = {
        id: rate?.id || null,
        name: root.querySelector('#tr-name').value.trim(),
        component_type: root.querySelector('#tr-type').value,
        percent: parseFloat(root.querySelector('#tr-percent').value) || 0,
        effective_from: root.querySelector('#tr-from').value || null,
      };
      if (!payload.name) return alert('Name required');
      await window.api.saveTaxRate(payload);
      closeModal();
      await loadTaxSetupData();
    });
  });
}

function openTaxProfileModal(profile = null) {
  window.api.getTaxRates().then((rates) => {
    const existingRateIds = (profile?.rates || []).map((r) => r.id);
    const html = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <label>Profile Name: <input id="tp-name" value="${profile?.name || ''}" placeholder="e.g. Restaurant 5%" style="width:100%; padding:6px;" /></label>
        <label>Price Mode:
          <select id="tp-mode" style="width:100%; padding:6px;">
            <option value="exclusive" ${profile?.price_mode === 'exclusive' ? 'selected' : ''}>Exclusive (Tax added on top)</option>
            <option value="inclusive" ${profile?.price_mode === 'inclusive' ? 'selected' : ''}>Inclusive (Price includes tax)</option>
          </select>
        </label>
        <label class="chk-label"><input type="checkbox" id="tp-default" ${profile?.is_default ? 'checked' : ''} /> Set as Default Profile</label>
        <label style="font-weight:bold; margin-top:8px;">Included Tax Rates:</label>
        <div style="max-height:160px; overflow-y:auto; border:1px solid #ccc; padding:6px;">
          ${rates
            .map(
              (r) => `
            <label style="display:block; margin: 3px 0;">
              <input type="checkbox" class="tp-rate-chk" value="${r.id}" ${existingRateIds.includes(r.id) ? 'checked' : ''} />
              ${r.name} (${r.percent}%)
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" id="btn-save-tp" class="btn btn-success">Save Profile</button>
      </div>
    `;

    showModal(profile ? 'Edit Tax Profile' : 'Add Tax Profile', html, (root) => {
      root.querySelector('#btn-save-tp').addEventListener('click', async () => {
        const rateIds = [];
        root.querySelectorAll('.tp-rate-chk:checked').forEach((c) => rateIds.push(parseInt(c.value, 10)));
        const payload = {
          id: profile?.id || null,
          name: root.querySelector('#tp-name').value.trim(),
          price_mode: root.querySelector('#tp-mode').value,
          is_default: root.querySelector('#tp-default').checked,
          rate_ids: rateIds,
        };
        if (!payload.name) return alert('Name required');
        await window.api.saveTaxProfile(payload);
        closeModal();
        await loadTaxSetupData();
      });
    });
  });
}

function renderShortcutsTable() {
  const tbody = document.querySelector('#shortcut-table tbody');
  tbody.innerHTML = '';
  getShortcutList().forEach((sc) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${sc.action}</strong></td>
      <td><input class="sc-input" data-action="${sc.action}" value="${sc.key}" style="padding:4px 6px; width:180px;" /></td>
      <td><button type="button" class="btn btn-secondary btn-sm btn-sc-reset" data-action="${sc.action}">Reset</button></td>
    `;
    const input = tr.querySelector('.sc-input');
    input.addEventListener('keydown', async (e) => {
      e.preventDefault();
      const parts = [];
      if (e.ctrlKey) parts.push('Control');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      let k = e.key;
      if (k === ' ') k = 'Space';
      if (k.length === 1) k = k.toUpperCase();
      if (!['Control', 'Alt', 'Shift'].includes(k)) parts.push(k);
      const combo = parts.join('+');

      const clash = checkConflict(combo, sc.action);
      if (clash) {
        input.style.border = '2px solid red';
        input.title = `Clashes with ${clash}!`;
        alert(`Shortcut ${combo} clashes with "${clash}"!`);
        return;
      }

      input.style.border = '1px solid #aaa';
      input.value = combo;
      await window.api.setShortcut(sc.action, combo);
      await loadShortcuts();
      setStatus(`Updated ${sc.action} to ${combo}`);
    });

    tr.querySelector('.btn-sc-reset').addEventListener('click', async () => {
      await resetShortcut(sc.action);
      await loadShortcuts();
      renderShortcutsTable();
    });

    tbody.appendChild(tr);
  });
}

async function loadUsersList() {
  const users = await window.api.getUsers();
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = (users || [])
    .map(
      (u) => `
      <tr>
        <td>${u.id}</td>
        <td><strong>${u.name}</strong></td>
        <td>${u.role.toUpperCase()}</td>
        <td>${u.is_active ? 'Active' : 'Disabled'}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm btn-edit-usr" data-id="${u.id}">Edit PIN</button>
          <button type="button" class="btn btn-danger btn-sm btn-del-usr" data-id="${u.id}">Remove</button>
        </td>
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-edit-usr').forEach((b) => {
    b.addEventListener('click', () => {
      const u = users.find((x) => x.id === Number(b.dataset.id));
      if (u) openUserModal(u);
    });
  });
  tbody.querySelectorAll('.btn-del-usr').forEach((b) => {
    b.addEventListener('click', async () => {
      if (confirm('Deactivate user?')) {
        await window.api.deleteUser(Number(b.dataset.id));
        await loadUsersList();
      }
    });
  });
}

function openUserModal(user = null) {
  const html = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <label>User Name: <input id="usr-name" value="${user?.name || ''}" style="width:100%; padding:6px;" /></label>
      <label>Role:
        <select id="usr-role" style="width:100%; padding:6px;">
          <option value="cashier" ${user?.role === 'cashier' ? 'selected' : ''}>Cashier (Billing only)</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin (Full Access)</option>
          <option value="waiter" ${user?.role === 'waiter' ? 'selected' : ''}>Waiter</option>
        </select>
      </label>
      <label>PIN (4 to 8 digits): <input id="usr-pin" type="password" maxlength="8" placeholder="${user ? 'Leave blank to keep current' : 'e.g. 1234'}" style="width:100%; padding:6px;" /></label>
    </div>
    <div class="modal-actions">
      <button type="button" id="btn-save-user-act" class="btn btn-success">Save User</button>
    </div>
  `;

  showModal(user ? 'Edit User' : 'Add New User', html, (root) => {
    root.querySelector('#btn-save-user-act').addEventListener('click', async () => {
      const payload = {
        id: user?.id || null,
        name: root.querySelector('#usr-name').value.trim(),
        role: root.querySelector('#usr-role').value,
        pin: root.querySelector('#usr-pin').value.trim() || undefined,
      };
      if (!payload.name) return alert('Name required');
      await window.api.saveUser(payload);
      closeModal();
      await loadUsersList();
      setStatus(`Saved user ${payload.name}`);
    });
  });
}

async function loadBackupsList() {
  const list = await window.api.listBackups();
  const tbody = document.querySelector('#backups-table tbody');
  tbody.innerHTML = (list || [])
    .map(
      (b) => `
      <tr>
        <td><strong>${b.name}</strong></td>
        <td>${new Date(b.mtime).toLocaleString()}</td>
        <td>${(b.size / 1024).toFixed(1)} KB</td>
        <td>
          <button type="button" class="btn btn-danger btn-sm btn-restore-bk" data-path="${b.path}">Restore</button>
        </td>
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-restore-bk').forEach((b) => {
    b.addEventListener('click', async () => {
      if (confirm('RESTORE WARNING: This will overwrite active database with this backup. Continue?')) {
        const res = await window.api.restoreBackup(b.dataset.path);
        alert('Database restored! The application will restart.');
        location.reload();
      }
    });
  });
}

async function runBackup() {
  try {
    const res = await window.api.backupNow();
    setStatus(`Backup taken: ${res.path}`);
    alert(`Backup successfully saved to:\n${res.path}`);
    await loadBackupsList();
  } catch (err) {
    alert(`Backup failed: ${err.message}`);
  }
}

async function saveSettingsForm() {
  const payload = {
    shop_name_en: document.getElementById('set-shop-en').value,
    shop_name_ta: document.getElementById('set-shop-ta').value,
    shop_address_en: document.getElementById('set-addr-en').value,
    shop_address_ta: document.getElementById('set-addr-ta').value,
    shop_phone: document.getElementById('set-phone').value,
    gstin: document.getElementById('set-gstin').value,
    fssai: document.getElementById('set-fssai').value,
    footer_message: document.getElementById('set-footer').value,

    gst_enabled: document.getElementById('set-gst-enabled').checked,
    price_mode: document.getElementById('set-price-mode').value,
    round_off: document.getElementById('set-roundoff').value,

    bill_prefix: document.getElementById('set-bill-prefix').value,
    bill_digits: parseInt(document.getElementById('set-bill-digits').value, 10) || 6,
    bill_reset: document.getElementById('set-bill-reset').value,
    fy_start_month: parseInt(document.getElementById('set-fy-month').value, 10) || 4,
    bill_no_color: document.getElementById('set-bill-color').value,

    show_customer: document.getElementById('set-show-customer').checked,
    show_address: document.getElementById('set-show-address').checked,
    show_table: document.getElementById('set-show-table').checked,
    show_waiter: document.getElementById('set-show-waiter').checked,
    show_remark: document.getElementById('set-show-remark').checked,

    printer_paper: document.getElementById('set-paper-width').value,
    bill_language: document.getElementById('set-bill-lang').value,
    printer_name: document.getElementById('set-printer-select').value,
    print_copies: parseInt(document.getElementById('set-print-copies').value, 10) || 1,
    auto_print: document.getElementById('set-auto-print').checked,

    backup_folder: document.getElementById('set-backup-folder').value,
    export_folder: document.getElementById('set-export-folder').value,
    usb_backup_folder: document.getElementById('set-usb-folder').value,

    theme: document.getElementById('set-theme').value,
    font_size: document.getElementById('set-font-size').value,
  };

  await window.api.setSettings(payload);

  const newDataFolder = document.getElementById('set-data-folder').value;
  if (newDataFolder && currentUser?.role === 'admin') {
    const paths = await window.api.getPaths();
    if (paths.dataFolder !== newDataFolder) {
      const res = await window.api.setDataFolder(newDataFolder);
      if (res.requiresRestart) {
        alert('Data folder changed. Application will reload.');
        location.reload();
        return;
      }
    }
  }

  applyThemeAndFont(payload);
  setStatus('Settings saved successfully');
  alert('Settings saved successfully!');
}

function registerShortcuts() {
  onAction('newBill', () => { showView('billing'); newBill(); });
  onAction('saveBill', () => saveBill(false));
  onAction('payment', () => openPaymentModal());
  onAction('printBill', () => printCurrentBill());
  onAction('printKOT', () => printKot());
  onAction('holdBill', () => holdCurrentBill());
  onAction('recallBill', () => recallHeldBill());
  onAction('deleteLine', () => grid.deleteCurrentRow());
  onAction('undoItem', () => grid.undoLastItem());
  onAction('deleteBill', () => cancelActiveBill());
  onAction('closeBill', () => closeTab(activeTabId));
  onAction('reprintBill', () => printCurrentBill());
  onAction('testPrint', () => window.api.testPrint());
  onAction('help', () => showHelp());
  onAction('settings', () => showView('settings'));
  onAction('reports', () => showView('reports'));
  onAction('excel', () => showView('excel'));
  onAction('menuManager', () => showView('menu'));
  onAction('selectTable', () => showView('tables'));
  onAction('backup', () => runBackup());
  onAction('lock', () => lockApp());
  onAction('toggleLang', () => toggleLanguage());
  onAction('nextTab', () => nextTab());
  onAction('prevTab', () => prevTab());
  onAction('customer', () => {
    showView('billing');
    document.getElementById('field-customer').focus();
  });
  onAction('discount', () => focusDiscount());
  onAction('searchItem', () => {
    showView('billing');
    grid.active.c = 2;
    grid.render();
  });
  onAction('jumpCategory', (catNum) => {
    showView('billing');
    grid.focusCategory(catNum);
  });
  onAction('quickAddMaster', () => {
    openQuickAddMaster('table');
  });
  onAction('escape', () => {
    closeModal();
  });
}

function focusDiscount() {
  showView('billing');
  const chk = document.getElementById('chk-discount');
  chk.checked = true;
  const inp = document.getElementById('field-discount-pct');
  inp.disabled = false;
  inp.focus();
}

async function toggleLanguage() {
  const next = getLang() === 'en' ? 'ta' : 'en';
  await setLanguage(next);
  document.getElementById('status-lang').textContent = next.toUpperCase();
  grid.setCategories(await window.api.getCategories());
  renderTabs();
  setStatus(`Language changed to ${next.toUpperCase()}`);
}

function lockApp() {
  window.api.logout();
  currentUser = null;
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('login-pin').value = '';
  document.getElementById('login-pin').focus();
}

function showHelp() {
  const rows = getShortcutList()
    .map((s) => `<tr><td><strong>${s.key}</strong></td><td>${s.action}</td></tr>`)
    .join('');
  showModal(
    t('help.title'),
    `<table class="data-table"><thead><tr><th>Shortcut Key</th><th>Action Performed</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

function showModal(title, contentHtml, onMount) {
  const root = document.getElementById('modal-root');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal" role="dialog">
        <h2>${title}</h2>
        <div>${contentHtml}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary btn-modal-close">Close (Esc)</button>
        </div>
      </div>
    </div>
  `;
  root.querySelector('.btn-modal-close').addEventListener('click', closeModal);
  root.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
  });
  onMount?.(root);
  const modalEl = root.querySelector('.modal');
  if (_modalNavHandler) document.removeEventListener('keydown', _modalNavHandler);
  _modalNavHandler = (e) => {
    const activeEl = document.activeElement;
    if (!modalEl || !modalEl.contains(activeEl)) return;
    const tag = activeEl.tagName;

    if (e.key === 'Enter' && (tag === 'INPUT' || tag === 'TEXTAREA')) {
      const primaryBtn = modalEl.querySelector('.btn-success') || modalEl.querySelector('.btn-primary:not(.btn-modal-close)');
      if (primaryBtn) { e.preventDefault(); primaryBtn.click(); }
      return;
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const focusables = [...modalEl.querySelectorAll(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    )].filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const idx = focusables.indexOf(activeEl);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusables[idx < 0 || idx >= focusables.length - 1 ? 0 : idx + 1]?.focus();
    } else {
      e.preventDefault();
      focusables[idx <= 0 ? focusables.length - 1 : idx - 1]?.focus();
    }
  };
  document.addEventListener('keydown', _modalNavHandler);

  // Auto-focus first input/select; fallback to first button (never the Close button)
  requestAnimationFrame(() => {
    const firstInput = modalEl.querySelector(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    if (firstInput) {
      firstInput.focus();
      if (firstInput.select) firstInput.select();
    } else {
      const firstBtn = modalEl.querySelector('button:not(.btn-modal-close):not([disabled])');
      firstBtn?.focus();
    }
  });
}

let _payModalKeyListener = null;
let _modalNavHandler = null;

function closeModal() {
  if (_payModalKeyListener) {
    document.removeEventListener('keydown', _payModalKeyListener);
    _payModalKeyListener = null;
  }
  if (_modalNavHandler) {
    document.removeEventListener('keydown', _modalNavHandler);
    _modalNavHandler = null;
  }
  const root = document.getElementById('modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
}

function setStatus(msg) {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function toLocalDatetime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

main();
