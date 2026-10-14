import { itemDisplayName, getLang } from './i18n.js';

// Editable columns: 0: Category, 2: ItemNo, 4: Qty, 6: Rate
// Readonly columns: 1: Sr, 3: ItemName, 5: Unit, 7: Amount
const COLS = ['category', 'sr', 'itemNo', 'itemName', 'qty', 'unit', 'rate', 'amount'];
const EDITABLE_COLS = [0, 2, 4, 6];

export class BillingGrid {
  constructor(tableEl, onChange) {
    this.table = tableEl;
    this.onChange = onChange;
    this.rows = [this.emptyRow()];
    this.active = { r: 0, c: 2 }; // Start in Item No
    this.categories = [];
    this.suggestEl = null;
    this.suggestItems = [];
    this.suggestIndex = 0;
    this.history = [];
    this.historyIndex = -1;
    this.saveState();
    this.render();
  }

  emptyRow() {
    return {
      category_id: '',
      category_name: '',
      item_id: null,
      item_code: '',
      item_name: '',
      qty: 1,
      unit: 'Plate',
      rate: 0,
      amount: 0,
    };
  }

  saveState() {
    // Keep max 25 history states
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(JSON.stringify(this.rows));
    if (this.history.length > 25) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.rows = JSON.parse(this.history[this.historyIndex]);
      this.render();
      this.notify();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.rows = JSON.parse(this.history[this.historyIndex]);
      this.render();
      this.notify();
    }
  }

  setCategories(cats) {
    this.categories = cats || [];
    this.render();
  }

  getLines() {
    return this.rows
      .filter((r) => r.item_id && Number(r.qty) > 0)
      .map((r) => ({
        item_id: r.item_id,
        item_code: r.item_code,
        name_snapshot: r.item_name,
        category_name: r.category_name,
        qty: Number(r.qty) || 1,
        unit: r.unit || 'Plate',
        rate: Number(r.rate) || 0,
        amount: (Number(r.qty) || 1) * (Number(r.rate) || 0),
      }));
  }

  setLines(lines) {
    this.rows = lines && lines.length
      ? lines.map((l) => ({
          category_id: l.category_id || '',
          category_name: l.category_name || '',
          item_id: l.item_id,
          item_code: l.item_code || '',
          item_name: l.name_snapshot || l.item_name || '',
          qty: Number(l.qty) || 1,
          unit: l.unit || 'Plate',
          rate: Number(l.rate) || 0,
          amount: (Number(l.qty) || 1) * (Number(l.rate) || 0),
        }))
      : [this.emptyRow()];
    this.active = { r: 0, c: 2 };
    this.saveState();
    this.render();
    this.notify();
  }

  clear() {
    this.rows = [this.emptyRow()];
    this.active = { r: 0, c: 2 };
    this.saveState();
    this.render();
    this.notify();
  }

  deleteCurrentRow() {
    if (this.rows.length <= 1) {
      this.rows = [this.emptyRow()];
    } else {
      this.rows.splice(this.active.r, 1);
      if (this.active.r >= this.rows.length) this.active.r = this.rows.length - 1;
    }
    this.saveState();
    this.render();
    this.notify();
  }

  undoLastItem() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].item_id) {
        this.rows.splice(i, 1);
        if (this.rows.length === 0) this.rows = [this.emptyRow()];
        this.saveState();
        this.render();
        this.notify();
        return;
      }
    }
  }

  insertRowBelow() {
    this.rows.splice(this.active.r + 1, 0, this.emptyRow());
    this.active.r += 1;
    this.active.c = 2; // Jump to Item No
    this.saveState();
    this.render();
  }

  focusCategory(catIndex) {
    const cat = this.categories[catIndex - 1];
    if (cat) {
      this.rows[this.active.r].category_id = cat.id;
      this.rows[this.active.r].category_name = cat.name_en;
      this.active.c = 2; // Move to item
      this.render();
      this.notify();
    }
  }

  render() {
    const thead = this.table.querySelector('thead');
    const tbody = this.table.querySelector('tbody');
    if (!thead || !tbody) return;

    tbody.innerHTML = '';
    this.rows.forEach((row, rIdx) => {
      const tr = document.createElement('tr');
      COLS.forEach((col, cIdx) => {
        const td = document.createElement('td');
        const isActive = rIdx === this.active.r && cIdx === this.active.c;
        if (isActive) td.classList.add('cell-active');

        if (col === 'sr') {
          td.classList.add('cell-readonly');
          td.textContent = String(rIdx + 1);
        } else if (col === 'amount') {
          td.classList.add('cell-readonly');
          row.amount = (Number(row.qty) || 0) * (Number(row.rate) || 0);
          td.textContent = row.amount.toFixed(2);
        } else if (col === 'itemName') {
          td.classList.add('cell-readonly');
          td.textContent = row.item_name || '';
        } else if (col === 'unit') {
          td.classList.add('cell-readonly');
          td.textContent = row.unit || '';
        } else if (this.isEditable(col, rIdx, cIdx)) {
          const input = this.createInput(col, row, rIdx, cIdx);
          td.appendChild(input);
        } else {
          td.classList.add('cell-readonly');
          td.textContent = this.cellText(col, row);
          td.tabIndex = 0;
          td.addEventListener('click', () => {
            this.active = { r: rIdx, c: cIdx };
            this.render();
          });
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const activeCell = tbody.querySelector('.cell-active input, .cell-active select');
    if (activeCell) {
      requestAnimationFrame(() => {
        activeCell.focus();
        if (activeCell.select && activeCell.tagName === 'INPUT') activeCell.select();
      });
    }
  }

  isEditable(col, rIdx, cIdx) {
    return rIdx === this.active.r && cIdx === this.active.c && ['category', 'itemNo', 'qty', 'rate'].includes(col);
  }

  cellText(col, row) {
    if (col === 'category') return row.category_name || '';
    if (col === 'itemNo') return row.item_code || '';
    if (col === 'qty') return String(row.qty ?? '1');
    if (col === 'rate') return String(row.rate ?? '0');
    return '';
  }

  createInput(col, row, rIdx, cIdx) {
    if (col === 'category') {
      const sel = document.createElement('select');
      sel.innerHTML = `<option value="">-- ALL --</option>${this.categories
        .map(
          (c) =>
            `<option value="${c.id}" ${String(c.id) === String(row.category_id) ? 'selected' : ''}>${
              getLang() === 'ta' ? c.name_ta || c.name_en : c.name_en
            }</option>`
        )
        .join('')}`;
      sel.addEventListener('change', () => {
        row.category_id = sel.value;
        const cat = this.categories.find((c) => String(c.id) === String(sel.value));
        row.category_name = cat ? cat.name_en : '';
        this.notify();
      });
      sel.addEventListener('keydown', (e) => this.handleCellKey(e, rIdx, cIdx, row, sel));
      return sel;
    }

    const input = document.createElement('input');
    input.type = col === 'qty' || col === 'rate' ? 'number' : 'text';
    input.value = this.cellText(col, row);

    input.addEventListener('input', () => {
      if (col === 'itemNo') {
        this.onItemSearch(input, row, rIdx);
      }
      if (col === 'qty') {
        row.qty = input.value;
        row.amount = (Number(row.qty) || 0) * (Number(row.rate) || 0);
      }
      if (col === 'rate') {
        row.rate = input.value;
        row.amount = (Number(row.qty) || 0) * (Number(row.rate) || 0);
      }
      this.notify(false);
    });

    input.addEventListener('keydown', (e) => this.handleCellKey(e, rIdx, cIdx, row, input));

    // Handle Excel paste (Ctrl+Shift+V or regular Ctrl+V with tab-delimited text)
    input.addEventListener('paste', (e) => this.handlePaste(e, rIdx));

    return input;
  }

  async handlePaste(e, rIdx) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !text.includes('\t') && !text.includes('\n')) return; // normal paste

    e.preventDefault();
    const lines = text.trim().split(/\r?\n/).map((l) => l.split('\t'));
    if (!lines.length) return;

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i];
      const targetRowIdx = rIdx + i;
      if (targetRowIdx >= this.rows.length) {
        this.rows.push(this.emptyRow());
      }
      const r = this.rows[targetRowIdx];

      // Format could be: Code, Qty, Rate OR Code, Name, Qty, Rate
      const codeOrName = parts[0]?.trim();
      if (codeOrName) {
        const items = await window.api.searchItems(codeOrName, 1);
        if (items && items[0]) {
          this.applyItem(r, items[0]);
        } else {
          r.item_code = codeOrName;
          r.item_name = parts[1] || codeOrName;
        }
      }

      if (parts.length >= 3) {
        r.qty = parseFloat(parts[parts.length - 2]) || 1;
        r.rate = parseFloat(parts[parts.length - 1]) || r.rate;
      } else if (parts.length === 2) {
        r.qty = parseFloat(parts[1]) || 1;
      }
      r.amount = (Number(r.qty) || 1) * (Number(r.rate) || 0);
    }

    this.saveState();
    this.render();
    this.notify();
  }

  async onItemSearch(input, row, rIdx) {
    const q = input.value.trim();
    row.item_code = q;
    if (q.length < 1) {
      this.hideSuggest();
      return;
    }
    const items = await window.api.searchItems(q, 15, row.category_id || null);
    this.suggestItems = items;
    this.suggestIndex = 0;
    this.showSuggest(input, items, (item) => {
      this.applyItem(row, item);
      // PDF: after choosing item, cursor moves to Qty (c=4)
      this.active.c = 4;
      this.saveState();
      this.render();
      this.notify();
    });
  }

  applyItem(row, item) {
    row.item_id = item.id;
    row.item_code = item.code;
    row.item_name = itemDisplayName(item);
    row.rate = item.price;
    row.unit = item.unit || 'Plate';
    row.category_id = item.category_id || row.category_id;
    row.category_name = item.category_en || row.category_name || '';
    row.qty = row.qty || 1;
    row.amount = (Number(row.qty) || 1) * (Number(row.rate) || 0);
  }

  showSuggest(anchor, items, onPick) {
    this.hideSuggest();
    if (!items.length) return;
    const rect = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'suggest-list';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.bottom + window.scrollY}px`;

    items.forEach((it, i) => {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      if (i === 0) div.classList.add('active');
      div.innerHTML = `<strong>${it.code}</strong> - ${itemDisplayName(it)} <span style="float:right; color:#0066cc; font-weight:bold;">₹${it.price}</span>`;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onPick(it);
        this.hideSuggest();
      });
      el.appendChild(div);
    });

    document.body.appendChild(el);
    this.suggestEl = el;
    this._onPick = onPick;
  }

  hideSuggest() {
    if (this.suggestEl) {
      this.suggestEl.remove();
      this.suggestEl = null;
    }
  }

  handleCellKey(e, rIdx, cIdx, row, input) {
    // Dropdown arrow navigation
    if (this.suggestEl && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
      const divs = [...this.suggestEl.querySelectorAll('.suggest-item')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.suggestIndex = Math.min(this.suggestIndex + 1, divs.length - 1);
        divs.forEach((d, i) => d.classList.toggle('active', i === this.suggestIndex));
        divs[this.suggestIndex]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.suggestIndex = Math.max(this.suggestIndex - 1, 0);
        divs.forEach((d, i) => d.classList.toggle('active', i === this.suggestIndex));
        divs[this.suggestIndex]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.suggestItems[this.suggestIndex]) {
          this._onPick?.(this.suggestItems[this.suggestIndex]);
        }
        this.hideSuggest();
        return;
      }
    }

    // Alt+Down to trigger suggestion list
    if (e.altKey && e.key === 'ArrowDown' && cIdx === 2) {
      e.preventDefault();
      this.onItemSearch(input, row, rIdx);
      return;
    }

    // Insert key: insert row below
    if (e.key === 'Insert') {
      e.preventDefault();
      this.insertRowBelow();
      return;
    }

    // Ctrl+D: delete current row
    if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.deleteCurrentRow();
      return;
    }

    // Ctrl+Z: undo / Ctrl+Y: redo
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }

    // Home / End / Ctrl+Home
    if (e.ctrlKey && e.key === 'Home') {
      e.preventDefault();
      this.active = { r: 0, c: 2 };
      this.render();
      return;
    }
    if (e.key === 'Home' && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      this.active.c = EDITABLE_COLS[0];
      this.render();
      return;
    }
    if (e.key === 'End' && input.selectionStart === input.value.length) {
      e.preventDefault();
      this.active.c = EDITABLE_COLS[EDITABLE_COLS.length - 1];
      this.render();
      return;
    }

    // Enter key navigation as specified in PDF Page 6:
    // "Enter: Confirm and go to next cell; after Qty, go to Category/Item of a new row (Unit and Rate skipped)"
    if (e.key === 'Enter') {
      e.preventDefault();
      this.hideSuggest();

      if (cIdx === 0) {
        // From Category -> move to Item No
        this.active.c = 2;
      } else if (cIdx === 2) {
        // If exact item match or first suggestion
        if (this.suggestItems.length > 0 && !row.item_id) {
          this.applyItem(row, this.suggestItems[0]);
        }
        // From Item No -> move to Qty
        this.active.c = 4;
      } else if (cIdx === 4) {
        // From Qty -> advance to new row!
        this.ensureNextRow(rIdx);
        this.active = { r: rIdx + 1, c: 2 }; // Jump straight to Item No of next row
      } else if (cIdx === 6) {
        // From Rate -> advance to new row
        this.ensureNextRow(rIdx);
        this.active = { r: rIdx + 1, c: 2 };
      } else {
        this.moveCell(0, 1);
      }

      this.saveState();
      this.render();
      this.notify();
      return;
    }

    if (e.key === 'Escape') {
      if (this.suggestEl) {
        e.preventDefault();
        this.hideSuggest();
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      this.hideSuggest();
      this.moveCell(0, e.shiftKey ? -1 : 1);
      this.render();
      return;
    }

    // Arrow navigation when not browsing suggestions
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !this.suggestEl) {
      const isInput = input.tagName === 'INPUT';
      if (isInput) {
        if (e.key === 'ArrowLeft' && input.selectionStart > 0) return;
        if (e.key === 'ArrowRight' && input.selectionEnd < input.value.length) return;
      }

      const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (dr || dc) {
        e.preventDefault();
        this.moveCell(dr, dc);
        this.render();
      }
    }
  }

  moveCell(dr, dc) {
    let r = this.active.r + dr;
    let c = this.active.c;

    if (dc !== 0) {
      const idx = EDITABLE_COLS.indexOf(this.active.c);
      const nextIdx = idx + (dc > 0 ? 1 : -1);
      if (nextIdx >= 0 && nextIdx < EDITABLE_COLS.length) {
        c = EDITABLE_COLS[nextIdx];
      } else if (dc > 0) {
        c = EDITABLE_COLS[0];
        r += 1;
      } else {
        c = EDITABLE_COLS[EDITABLE_COLS.length - 1];
        r -= 1;
      }
    }

    r = Math.max(0, Math.min(r, this.rows.length - 1));
    if (!EDITABLE_COLS.includes(c)) c = EDITABLE_COLS[0];
    this.active = { r, c };
  }

  ensureNextRow(rIdx) {
    if (rIdx === this.rows.length - 1) {
      this.rows.push(this.emptyRow());
    }
  }

  notify(full = true) {
    this.rows.forEach((row) => {
      row.amount = (Number(row.qty) || 0) * (Number(row.rate) || 0);
    });
    if (full) this.onChange?.();
  }
}
