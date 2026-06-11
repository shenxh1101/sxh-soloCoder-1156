import { bus } from '../core/EventBus.js';
import { formatTime } from '../utils/format.js';

const ICONS = {
  record: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  broadcast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 0 1 10-10"/><path d="M22 12a10 10 0 0 1-10 10"/><path d="M4.93 4.93a16 16 0 0 1 14.14 14.14"/><circle cx="12" cy="12" r="2"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  fileJson: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 12h8M8 16h5"/></svg>`,
  scissor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
  images: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
};

export class Toolbar {
  constructor(rootEl, actions) {
    this.el = rootEl;
    this.actions = actions;
    this.recording = false;
    this.paused = false;
    this.currentTime = 0;
    this.duration = 0;
    this.hasVideo = false;
    this.drawEnabled = false;
    this.strokesVisible = true;
    this._render();
    this._bind();
  }

  setState(patch) {
    Object.assign(this, patch);
    this._updateUI();
  }

  _render() {
    this.el.innerHTML = `
      <div class="toolbar__left">
        <div class="brand">
          <div class="brand__logo">▶</div>
          <span>ScreenStudio</span>
        </div>
      </div>
      <div class="toolbar__center">
        <div class="record-status idle" id="recordStatus">
          <span class="status-dot"></span>
          <span id="statusText">待机中</span>
          <span class="sep" style="opacity:0.3;margin:0 6px">|</span>
          <span id="timerText">00:00:00</span>
        </div>
      </div>
      <div class="toolbar__right">
        <button class="btn btn--ghost" id="btnToggleDraw" title="切换画笔 (Ctrl+D)">
          <span class="icon" style="display:inline-flex;align-items:center">${ICONS.broadcast}</span>
          <span class="lbl">画笔</span>
        </button>
        <button class="btn btn--ghost" id="btnToggleStrokes" title="显示/隐藏标注">
          <span class="icon" style="display:inline-flex;align-items:center">${ICONS.eye}</span>
        </button>
        <div class="dropdown">
          <button class="btn" id="btnExport" disabled>
            <span class="icon" style="display:inline-flex;align-items:center">${ICONS.download}</span>
            <span>导出</span>
          </button>
          <div class="dropdown-menu" id="exportMenu">
            <div class="dropdown-item" data-action="export-video">
              <span class="emoji">🎬</span>导出视频 (WebM)
            </div>
            <div class="dropdown-item" data-action="export-video-no-strokes">
              <span class="emoji">🎥</span>纯视频（无标注）
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" data-action="export-frames">
              <span class="emoji">🖼️</span>导出帧序列 (PNG)
            </div>
            <div class="dropdown-item" data-action="export-json">
              <span class="emoji">📄</span>导出标注 (JSON)
            </div>
          </div>
        </div>
        <button class="btn btn--ghost" id="btnUpload" title="导入视频/JSON">
          <span style="display:inline-flex;align-items:center">${ICONS.upload}</span>
        </button>
        <input type="file" id="fileUpload" accept="video/*,.json" style="display:none" multiple>
        <button class="btn btn--ghost" id="btnSettings" title="设置">
          <span style="display:inline-flex;align-items:center">${ICONS.settings}</span>
        </button>
        <button class="btn btn--primary" id="btnRecord" title="开始录制 (Ctrl+R)">
          <span class="icon" style="display:inline-flex;align-items:center;color:inherit">${ICONS.record}</span>
          <span>开始录制</span>
        </button>
      </div>
    `;
  }

  _bind() {
    const $ = (id) => this.el.querySelector('#' + id);
    const q = (sel) => this.el.querySelector(sel);

    $('btnRecord').addEventListener('click', () => this.actions.toggleRecord());
    $('btnToggleDraw').addEventListener('click', () => this.actions.toggleDraw());
    $('btnToggleStrokes').addEventListener('click', () => {
      this.strokesVisible = !this.strokesVisible;
      this.actions.setStrokesVisible(this.strokesVisible);
      const iconEl = q('#btnToggleStrokes .icon');
      if (iconEl) iconEl.innerHTML = this.strokesVisible ? ICONS.eye : ICONS.eyeOff;
      $('btnToggleStrokes').title = this.strokesVisible ? '隐藏标注' : '显示标注';
    });

    $('btnExport').addEventListener('click', (e) => {
      e.stopPropagation();
      $('exportMenu').classList.toggle('open');
    });
    document.addEventListener('click', () => $('exportMenu').classList.remove('open'));

    q('#exportMenu').addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item) return;
      $('exportMenu').classList.remove('open');
      const action = item.dataset.action;
      if (action === 'export-video') this.actions.exportVideo({ burnStrokes: true });
      else if (action === 'export-video-no-strokes') this.actions.exportVideo({ burnStrokes: false });
      else if (action === 'export-frames') this.actions.exportFrames();
      else if (action === 'export-json') this.actions.exportAnnotations();
    });

    $('btnUpload').addEventListener('click', () => $('fileUpload').click());
    $('fileUpload').addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) this.actions.handleFileUpload(e.target.files);
      e.target.value = '';
    });
    $('btnSettings').addEventListener('click', () => this.actions.openSettings());
  }

  _updateUI() {
    const $ = (id) => this.el.querySelector('#' + id);
    if (!$) return;
    const status = $('recordStatus');
    const statusText = $('statusText');
    const timer = $('timerText');
    const btnRec = $('btnRecord');
    const btnExport = $('btnExport');
    const btnToggleDraw = $('btnToggleDraw');

    status.classList.remove('idle', 'recording', 'paused');
    if (this.recording && !this.paused) {
      status.classList.add('recording');
      statusText.textContent = '录制中';
      btnRec.classList.remove('btn--primary');
      btnRec.classList.add('btn--danger');
      btnRec.innerHTML = `<span class="icon" style="display:inline-flex;align-items:center">${ICONS.stop}</span><span>停止录制</span>`;
    } else if (this.recording && this.paused) {
      status.classList.add('paused');
      statusText.textContent = '已暂停';
      btnRec.classList.remove('btn--primary', 'btn--danger');
      btnRec.classList.add('btn--danger');
      btnRec.innerHTML = `<span class="icon" style="display:inline-flex;align-items:center">${ICONS.play}</span><span>继续录制</span>`;
    } else {
      status.classList.add('idle');
      statusText.textContent = this.hasVideo ? '已就绪' : '待机中';
      btnRec.classList.remove('btn--danger');
      btnRec.classList.add('btn--primary');
      btnRec.innerHTML = `<span class="icon" style="display:inline-flex;align-items:center">${ICONS.record}</span><span>开始录制</span>`;
    }
    timer.textContent = formatTime(this.currentTime);

    btnExport.disabled = !this.hasVideo;

    btnToggleDraw.classList.toggle('btn--primary', !!this.drawEnabled);
    btnToggleDraw.style.background = this.drawEnabled ? '' : '';
    if (this.drawEnabled) {
      btnToggleDraw.style.background = 'linear-gradient(135deg, rgba(34,211,238,0.18), rgba(168,85,247,0.08))';
      btnToggleDraw.style.borderColor = 'rgba(34,211,238,0.4)';
      btnToggleDraw.style.color = '#22D3EE';
      btnToggleDraw.style.boxShadow = '0 0 0 1px rgba(34,211,238,0.15)';
    } else {
      btnToggleDraw.style.background = '';
      btnToggleDraw.style.borderColor = '';
      btnToggleDraw.style.color = '';
      btnToggleDraw.style.boxShadow = '';
    }
  }
}
