/* Positive Prompt Tabs 0.1.3 — Forge Neo, browser-local storage. */
(() => {
    'use strict';
    if (window.positivePromptTabs) return;
    const instances = new Map();
    const make = (tag, cls, text) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text) el.textContent = text;
        return el;
    };
    const uid = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
    const newTab = (name, text = '') => ({id: uid(), name, text});
    function valid(s) {
        return s?.version === 1 && Array.isArray(s.tabs) && s.tabs.length > 0 &&
            s.tabs.every(t => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.text === 'string') &&
            new Set(s.tabs.map(t => t.id)).size === s.tabs.length && s.tabs.some(t => t.id === s.active);
    }
    class PromptTabs {
        constructor(mode, area) {
            this.mode = mode; this.area = area;
            this.key = `positive-prompt-tabs:v1:${location.pathname}:${mode}`;
            this.state = null; this.deleted = []; this.writing = false;
            let loadError = '';
            try {
                const raw = localStorage.getItem(this.key);
                if (raw) {
                    const saved = JSON.parse(raw);
                    if (!valid(saved)) throw new Error('Invalid saved tabs');
                    this.state = saved;
                }
            } catch (error) {
                loadError = '保存データを読み込めません。既存データの上書きを停止しています。';
                this.storageBlocked = true;
                console.warn('Positive Prompt Tabs:', error);
            }
            if (!this.state) {
                const tabs = [newTab('タブ1', area.value), newTab('タブ2'), newTab('タブ3')];
                this.state = {version: 1, active: tabs[0].id, tabs};
            } else if (area.value && area.value !== this.current().text) {
                // Preserve a prompt restored by Neo or another extension before mounting.
                this.state.tabs.push(newTab('起動時のプロンプト', area.value));
            }
            this.root = make('section', 'ppt-root');
            this.root.setAttribute('aria-label', 'Positive Prompt Tabs');
            this.row = make('div', 'ppt-row');
            this.list = make('div', 'ppt-list');
            this.list.setAttribute('role', 'tablist');
            this.list.setAttribute('aria-label', 'ポジティブプロンプト');
            this.row.append(this.list);
            this.button(this.row, '＋', () => this.add(), 'タブを追加');
            this.restore = this.button(this.row, '↶', () => this.undoDelete(), '最後に削除したタブを復元');
            this.status = make('div', 'ppt-status'); this.status.setAttribute('role', 'status');
            this.root.append(this.row, this.status);
            const host = area.closest(`#${mode}_prompt`);
            // Insert outside Neo's flex row to preserve full textbox width.
            const promptRow = host.closest(`#${mode}_prompt_row`) || host;
            promptRow.before(this.root);
            host.classList.add('ppt-attached-prompt');
            // Cancel only the parent's gap between these two siblings.
            const attach = () => {
                const gap = parseFloat(getComputedStyle(this.root.parentElement).rowGap) || 0;
                this.root.style.marginBottom = `${-gap}px`;
            };
            attach(); new ResizeObserver(attach).observe(this.root.parentElement);
            this.area.id ||= `ppt-${mode}-textarea`;
            this.root.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeMenu(); });
            document.addEventListener('pointerdown', e => { if (!this.root.contains(e.target)) this.closeMenu(); });
            // Capture above the textarea so Neo's optional debounce cannot hide edits.
            host.addEventListener('input', () => { if (!this.writing) this.capture(); }, true);
            host.addEventListener('change', () => { if (!this.writing) this.capture(); }, true);
            window.addEventListener('pagehide', () => this.capture());
            this.apply(); this.render(); this.save();
            if (loadError) this.status.textContent = loadError;
        }
        current() { return this.state.tabs.find(t => t.id === this.state.active); }
        button(parent, label, action, title = label) {
            const b = make('button', 'ppt-button', label); b.type = 'button';
            b.title = title; b.setAttribute('aria-label', title);
            b.addEventListener('click', action); parent.append(b); return b;
        }
        capture() {
            if (this.current().text !== this.area.value) {
                this.current().text = this.area.value; this.save();
            }
        }
        save() {
            if (this.storageBlocked) return;
            try { localStorage.setItem(this.key, JSON.stringify(this.state)); }
            catch (error) { this.status.textContent = '自動保存に失敗しました。このページを閉じる前に文章を控えてください。'; }
        }
        apply() {
            this.writing = true;
            try {
                this.area.value = this.current().text;
                // Plain input also cancels pending Neo prompt debounce events.
                this.area.dispatchEvent(new Event('input', {bubbles: true}));
            } finally { this.writing = false; }
        }
        select(id) {
            this.capture(); this.state.active = id; this.apply(); this.save(); this.render();
            this.list.querySelector('[aria-selected="true"]')?.focus();
        }
        add(source) {
            this.capture();
            const t = newTab(source ? `${source.name} コピー` : `タブ${this.nextNumber()}`, source?.text || '');
            const index = source ? this.state.tabs.indexOf(source) + 1 : this.state.tabs.length;
            this.state.tabs.splice(index, 0, t); this.select(t.id);
        }
        nextNumber() {
            let n = 1; while (this.state.tabs.some(t => t.name === `タブ${n}`)) n++; return n;
        }
        remove(id) {
            if (this.state.tabs.length === 1) return;
            this.capture(); const index = this.state.tabs.findIndex(t => t.id === id);
            const [tab] = this.state.tabs.splice(index, 1);
            this.deleted.push({tab, index});
            if (this.state.active === id) { this.state.active = this.state.tabs[Math.min(index, this.state.tabs.length - 1)].id; this.apply(); }
            this.save(); this.render();
            this.list.querySelector('[aria-selected="true"]')?.focus();
        }
        undoDelete() {
            const entry = this.deleted.pop(); if (!entry) return;
            this.capture(); this.state.tabs.splice(entry.index, 0, entry.tab); this.select(entry.tab.id);
        }
        move(id, index) {
            this.capture(); const old = this.state.tabs.findIndex(t => t.id === id);
            if (old < 0) return;
            const [tab] = this.state.tabs.splice(old, 1); this.state.tabs.splice(index, 0, tab);
            this.save(); this.render();
            this.list.querySelector(`[data-id="${id}"] button`)?.focus();
        }
        closeMenu() { this.menu?.remove(); this.menu = null; this.menuTrigger?.setAttribute('aria-expanded', 'false'); }
        openMenu(tab, trigger) {
            const wasOpen = this.menuTrigger === trigger && this.menu;
            this.closeMenu(); if (wasOpen) return;
            this.menuTrigger = trigger; trigger.setAttribute('aria-expanded', 'true');
            this.menu = make('div', 'ppt-menu'); this.root.append(this.menu);
            this.button(this.menu, '名前を変更', () => this.rename(tab));
            this.button(this.menu, '複製', () => this.add(tab));
            const i = this.state.tabs.indexOf(tab);
            this.button(this.menu, '左へ移動', () => this.move(tab.id, i - 1)).disabled = i === 0;
            this.button(this.menu, '右へ移動', () => this.move(tab.id, i + 1)).disabled = i === this.state.tabs.length - 1;
            this.button(this.menu, '削除', () => this.remove(tab.id)).disabled = this.state.tabs.length === 1;
            this.button(this.menu, '最後に削除したタブを復元', () => this.undoDelete()).disabled = !this.deleted.length;
            this.menu.querySelector('button').focus();
        }
        rename(tab) {
            this.closeMenu();
            const form = make('form', 'ppt-menu');
            const input = make('input', 'ppt-name'); input.value = tab.name; input.maxLength = 80;
            input.setAttribute('aria-label', 'タブ名'); form.append(input);
            const finish = () => { this.render(); this.list.querySelector('[aria-selected="true"]')?.focus(); };
            const commit = () => { const name = input.value.trim(); if (!name) { input.focus(); return; } tab.name = name; this.save(); finish(); };
            this.button(form, '保存', commit); this.button(form, 'キャンセル', finish);
            form.addEventListener('submit', e => { e.preventDefault(); commit(); });
            form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); finish(); } });
            this.menu = form; this.root.append(form); input.focus(); input.select();
        }
        render() {
            this.closeMenu(); this.list.replaceChildren(); this.restore.disabled = !this.deleted.length;
            this.state.tabs.forEach((tab, index) => {
                const item = make('div', 'ppt-item'); item.dataset.id = tab.id; item.draggable = true;
                const selected = tab.id === this.state.active;
                const b = this.button(item, tab.name, () => this.select(tab.id));
                b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(selected));
                b.setAttribute('aria-controls', this.area.id); b.tabIndex = selected ? 0 : -1;
                b.addEventListener('keydown', e => {
                    let next;
                    if (e.key === 'ArrowRight') next = (index + 1) % this.state.tabs.length;
                    if (e.key === 'ArrowLeft') next = (index - 1 + this.state.tabs.length) % this.state.tabs.length;
                    if (e.key === 'Home') next = 0;
                    if (e.key === 'End') next = this.state.tabs.length - 1;
                    if (next !== undefined) { e.preventDefault(); e.stopPropagation(); this.select(this.state.tabs[next].id); }
                });
                const menu = this.button(item, '︙', () => this.openMenu(tab, menu), `${tab.name}の操作`);
                menu.setAttribute('aria-expanded', 'false');
                const clearMarkers = () => this.list.querySelectorAll('.ppt-drop-before, .ppt-drop-after').forEach(el => el.classList.remove('ppt-drop-before', 'ppt-drop-after'));
                item.addEventListener('dragstart', e => {
                    if (e.target === menu) { e.preventDefault(); return; }
                    this.dragged = tab.id; item.classList.add('ppt-dragging');
                    e.dataTransfer.setData('application/x-positive-prompt-tab', tab.id);
                    e.dataTransfer.effectAllowed = 'move';
                });
                item.addEventListener('dragover', e => {
                    if (!this.dragged) return;
                    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; clearMarkers();
                    const rect = item.getBoundingClientRect();
                    if (tab.id !== this.dragged) item.classList.add(e.clientX < rect.x + rect.width / 2 ? 'ppt-drop-before' : 'ppt-drop-after');
                    const viewport = this.list.getBoundingClientRect();
                    if (e.clientX < viewport.left + 28) this.list.scrollLeft -= 20;
                    if (e.clientX > viewport.right - 28) this.list.scrollLeft += 20;
                });
                item.addEventListener('dragleave', () => item.classList.remove('ppt-drop-before', 'ppt-drop-after'));
                item.addEventListener('drop', e => {
                    if (!this.dragged) return;
                    e.preventDefault(); e.stopPropagation();
                    const rect = item.getBoundingClientRect();
                    let destination = index + (e.clientX >= rect.x + rect.width / 2 ? 1 : 0);
                    const source = this.state.tabs.findIndex(t => t.id === this.dragged);
                    if (source < destination) destination--;
                    this.move(this.dragged, destination); this.dragged = null;
                });
                item.addEventListener('dragend', () => { this.dragged = null; item.classList.remove('ppt-dragging'); clearMarkers(); });
                this.list.append(item);
            });
            this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
        }
    }
    function mount() {
        const app = typeof gradioApp === 'function' ? gradioApp() : document;
        for (const mode of ['txt2img', 'img2img']) {
            const area = app.querySelector(`#${mode}_prompt textarea`);
            if (area && !instances.has(mode)) instances.set(mode, new PromptTabs(mode, area));
        }
    }
    window.positivePromptTabs = {mount};
    if (typeof onUiLoaded === 'function') onUiLoaded(mount);
    if (typeof onUiUpdate === 'function') onUiUpdate(mount);
    if (document.readyState !== 'loading') mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
