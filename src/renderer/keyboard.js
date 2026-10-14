const DEFAULT_ACTIONS = {
  help: 'F1',
  newBill: 'F2',
  searchItem: 'F3',
  selectTable: 'F4',
  holdBill: 'F5',
  recallBill: 'F6',
  customer: 'F7',
  discount: 'F8',
  payment: 'F9',
  printBill: 'F10',
  printKOT: 'F11',
  reports: 'F12',
  toggleLang: 'Control+L',
  menuManager: 'Control+M',
  excel: 'Control+E',
  settings: 'Control+S',
  backup: 'Control+B',
  deleteLine: 'Control+D',
  undoItem: 'Control+Z',
  lock: 'Control+Q',
  saveBill: 'Control+Enter',
  deleteBill: 'Control+Shift+Delete',
  closeBill: 'Control+W',
  reprintBill: 'Control+P',
  testPrint: 'Control+T',
  nextTab: 'Control+Tab',
  prevTab: 'Control+Shift+Tab',
};

let shortcuts = { ...DEFAULT_ACTIONS };
const handlers = new Map();

export async function loadShortcuts() {
  try {
    const rows = await window.api.getShortcuts();
    shortcuts = { ...DEFAULT_ACTIONS };
    if (Array.isArray(rows)) {
      rows.forEach((r) => {
        shortcuts[r.action_id] = r.key_combo;
      });
    }
  } catch {
    shortcuts = { ...DEFAULT_ACTIONS };
  }
}

export function onAction(actionId, fn) {
  handlers.set(actionId, fn);
}

export function triggerAction(actionId, ...args) {
  const fn = handlers.get(actionId);
  if (fn) return fn(...args);
}

export function eventToCombo(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key === 'Delete') key = 'Delete';
  if (key === 'Enter') key = 'Enter';
  if (key === '+' || key === '=') key = 'Plus';
  if (key.length === 1) key = key.toUpperCase();
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) parts.push(key);
  return parts.join('+');
}

export function checkConflict(combo, excludeActionId = '') {
  for (const [action, sc] of Object.entries(shortcuts)) {
    if (action !== excludeActionId && sc.toLowerCase() === combo.toLowerCase()) {
      return action;
    }
  }
  return null;
}

export function initKeyboardManager() {
  document.addEventListener('keydown', (e) => {
    updateLockIndicators(e);

    // Alt + 1..9 category jump
    if (e.altKey && !e.ctrlKey && e.key >= '1' && e.key <= '9') {
      const fn = handlers.get('jumpCategory');
      if (fn) {
        e.preventDefault();
        fn(parseInt(e.key, 10));
        return;
      }
    }

    // Quick add master (Ctrl+Plus)
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
      const fn = handlers.get('quickAddMaster');
      if (fn) {
        e.preventDefault();
        fn();
        return;
      }
    }

    // Modal close with Esc
    if (e.key === 'Escape') {
      const fn = handlers.get('escape');
      if (fn) {
        fn();
        return;
      }
    }

    // Ignore shortcut interception inside textarea or active dialogs if typing text
    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName === 'TEXTAREA') return;

    const combo = eventToCombo(e);

    for (const [action, sc] of Object.entries(shortcuts)) {
      if (sc.toLowerCase() === combo.toLowerCase()) {
        const fn = handlers.get(action);
        if (fn) {
          e.preventDefault();
          fn();
          return;
        }
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    updateLockIndicators(e);
  });

  window.api.onAction((action) => {
    const fn = handlers.get(action);
    if (fn) fn();
  });
}

function updateLockIndicators(e) {
  if (typeof e.getModifierState !== 'function') return;
  const cap = document.getElementById('lock-cap');
  const num = document.getElementById('lock-num');
  const scrl = document.getElementById('lock-scrl');

  if (cap) cap.classList.toggle('lock-active', e.getModifierState('CapsLock'));
  if (num) num.classList.toggle('lock-active', e.getModifierState('NumLock'));
  if (scrl) scrl.classList.toggle('lock-active', e.getModifierState('ScrollLock'));
}

export function getShortcutList() {
  return Object.entries(shortcuts).map(([action, key]) => ({ action, key }));
}

export function getShortcutsMap() {
  return { ...shortcuts };
}

export function getDefaultShortcut(actionId) {
  return DEFAULT_ACTIONS[actionId] || '';
}

export async function resetShortcut(actionId) {
  const def = DEFAULT_ACTIONS[actionId];
  if (def) {
    shortcuts[actionId] = def;
    await window.api.setShortcut(actionId, def);
  }
}

export async function resetAllShortcuts() {
  shortcuts = { ...DEFAULT_ACTIONS };
  await window.api.resetShortcuts();
}
