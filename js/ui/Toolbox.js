import { bus } from '../core/EventBus.js';
import { DEFAULT_COLORS, TOOLS } from '../core/DrawEngine.js';

const TOOL_ICONS = {
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  rect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" ry="2"/></svg>`,
  highlight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v4h4l6-6"/><path d="M22 12L16 6l-6 6 6 6 6-6z"/></svg>`,
  eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0L21 8a2 2 0 0 1 0 2.8L12 20"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 3L3 13"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 13"/></svg>`,
  clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
};

const TOOL_LABELS = {
  pen: '画笔', arrow: '箭头', rect: '矩形', highlight: '高亮', eraser: '橡皮擦',
};

const TOOL_KBDS = {
  pen: '1', arrow: '2', rect: '3', highlight: '4', eraser: '5',
};

const WIDTH_SIZES = [
  { label: 'S', value: 2, size: 6 },
  { label: 'M', value: 4, size: 10 },
  { label: 'L', value: 8, size: 14 },
  { label: 'XL', value: 14, size: 18 },
];

export class Toolbox {
  constructor(rootEl, actions) {
    this.el = rootEl;
    this.actions = actions;
    this.currentTool = TOOLS.PEN;
    this.currentColor = DEFAULT_COLORS[0];
    this.currentWidth = 4;
    this._render();
    this._bind();
  }

  setState(patch) {
    if ('tool' in patch) this.currentTool = patch.tool;
    if ('color' in patch) this.currentColor = patch.color;
    if ('width' in patch) this.currentWidth = patch.width;
    this._updateUI();
  }

  _render() {
    const tools = ['pen', 'arrow', 'rect', 'highlight', 'eraser'];
    const toolBtns = tools.map(t => `
      <button class="tool-btn ${t === this.currentTool ? 'active' : ''}" data-tool="${t}" title="${TOOL_LABELS[t]} (${TOOL_KBDS[t]})">
        ${TOOL_ICONS[t]}
        <span class="kbd">${TOOL_KBDS[t]}</span>
      </button>
    `).join('');

    const colorSwatches = DEFAULT_COLORS.map((c, idx) => `
      <div class="color-swatch ${c === this.currentColor ? 'active' : ''}" data-color="${c}" style="background:${c}" title="颜色 ${idx + 1}"></div>
    `).join('');

    const customColor = `
      <label class="color-swatch" title="自定义颜色" style="background: conic-gradient(#EF4444,#F59E0B,#10B981,#22D3EE,#A855F7,#EF4444); display:flex; align-items:center; justify-content:center; cursor:pointer;">
        <input type="color" id="customColor" value="${this.currentColor}" style="opacity:0;position:absolute;width:100%;height:100%;cursor:pointer;border:none;padding:0;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="position:relative;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6))"><path d="M12 5v14M5 12h14"/></svg>
      </label>
    `;

    const sizeDots = WIDTH_SIZES.map((s, idx) => `
      <div class="size-dot ${this.currentWidth === s.value ? 'active' : ''}" data-width="${s.value}" title="粗细 ${s.label}: ${s.value}px" style="width:${s.size}px;height:${s.size}px;"></div>
    `).join('');

    this.el.innerHTML = `
      ${toolBtns}
      <div class="toolbox__divider"></div>
      <div class="color-palette" id="colorPalette">
        ${colorSwatches}
        ${customColor}
      </div>
      <div class="toolbox__divider"></div>
      <div class="size-control" title="画笔粗细: ${this.currentWidth}px ([ / ])">
        <div class="size-dots" id="sizeDots">${sizeDots}</div>
      </div>
      <div class="toolbox__spacer"></div>
      <div class="toolbox__divider"></div>
      <button class="tool-btn" id="btnUndo" title="撤销 (Ctrl+Z)">${TOOL_ICONS.undo}<span class="kbd">Z</span></button>
      <button class="tool-btn" id="btnRedo" title="重做 (Ctrl+Shift+Z)">${TOOL_ICONS.redo}<span class="kbd">Y</span></button>
      <button class="tool-btn" id="btnClear" title="清空画布">${TOOL_ICONS.clear}</button>
    `;
  }

  _bind() {
    this.el.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => this.actions.setTool(btn.dataset.tool));
    });
    this.el.querySelectorAll('[data-color]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.actions.setColor(el.dataset.color);
      });
    });
    const custom = this.el.querySelector('#customColor');
    if (custom) custom.addEventListener('input', (e) => this.actions.setColor(e.target.value));
    this.el.querySelectorAll('[data-width]').forEach(el => {
      el.addEventListener('click', () => this.actions.setWidth(Number(el.dataset.width)));
    });
    this.el.querySelector('#btnUndo')?.addEventListener('click', () => this.actions.undo());
    this.el.querySelector('#btnRedo')?.addEventListener('click', () => this.actions.redo());
    this.el.querySelector('#btnClear')?.addEventListener('click', () => {
      if (confirm('确认清空所有标注？此操作可通过撤销恢复。')) this.actions.clear();
    });
  }

  _updateUI() {
    this.el.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
    this.el.querySelectorAll('[data-color]').forEach(el => {
      el.classList.toggle('active', el.dataset.color === this.currentColor);
    });
    WIDTH_SIZES.forEach(s => {
      const dot = this.el.querySelector(`[data-width="${s.value}"]`);
      if (dot) dot.classList.toggle('active', s.value === this.currentWidth);
    });
  }
}
