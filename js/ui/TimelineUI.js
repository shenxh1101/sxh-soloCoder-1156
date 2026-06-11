import { bus } from '../core/EventBus.js';
import { formatTime } from '../utils/format.js';

const ICONS = {
  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  skipBack: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`,
  skipForward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  speed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  cut: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
  reset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
};

export class TimelineUI {
  constructor(rootEl, actions) {
    this.el = rootEl;
    this.actions = actions;
    this.duration = 0;
    this.currentTime = 0;
    this.clipStart = 0;
    this.clipEnd = 0;
    this.isPlaying = false;
    this.bookmarks = [];
    this.playbackRate = 1;

    this._draggingClip = null;
    this._seeking = false;
    this._render();
    this._bind();
  }

  setState(patch) {
    if ('duration' in patch) this.duration = patch.duration;
    if ('currentTime' in patch) this.currentTime = patch.currentTime;
    if ('clipStart' in patch) this.clipStart = patch.clipStart;
    if ('clipEnd' in patch) this.clipEnd = patch.clipEnd;
    if ('isPlaying' in patch) this.isPlaying = patch.isPlaying;
    if ('bookmarks' in patch) this.bookmarks = patch.bookmarks || [];
    if ('playbackRate' in patch) this.playbackRate = patch.playbackRate;
    this._updateUI();
  }

  _render() {
    this.el.innerHTML = `
      <div class="timeline-controls">
        <div class="tc-left">
          <button class="btn btn--icon" id="tlSkipBack" title="后退5帧 (←)">${ICONS.skipBack}</button>
          <div class="play-controls">
            <button class="btn btn--icon" id="tlPlay" title="播放/暂停 (Space)" style="width:44px;height:44px;">${ICONS.play}</button>
            <button class="btn btn--icon" id="tlStop" title="停止并回到起点">${ICONS.stop}</button>
          </div>
          <button class="btn btn--icon" id="tlSkipForward" title="前进5帧 (→)">${ICONS.skipForward}</button>
          <div class="dropdown" style="position:relative">
            <button class="btn btn--ghost" id="tlSpeed" title="播放速度">
              ${ICONS.speed}
              <span id="speedLbl">1x</span>
            </button>
            <div class="dropdown-menu" id="speedMenu" style="left:0;right:auto;min-width:100px">
              <div class="dropdown-item" data-rate="0.25">0.25x</div>
              <div class="dropdown-item" data-rate="0.5">0.5x</div>
              <div class="dropdown-item" data-rate="0.75">0.75x</div>
              <div class="dropdown-item active" data-rate="1">1x (原速)</div>
              <div class="dropdown-item" data-rate="1.5">1.5x</div>
              <div class="dropdown-item" data-rate="2">2x</div>
            </div>
          </div>
        </div>
        <div class="tc-center">
          <div class="time-display">
            <span class="cur" id="timeCurrent">00:00:00</span>
            <span class="sep">/</span>
            <span class="dur" id="timeDuration">00:00:00</span>
          </div>
        </div>
        <div class="tc-right">
          <button class="btn btn--ghost" id="tlBookmark" title="添加书签 (Ctrl+B)">
            ${ICONS.bookmark} <span>书签</span>
          </button>
          <div style="width:1px;height:22px;background:var(--border-glass);margin:0 4px;"></div>
          <div class="dropdown" style="position:relative">
            <button class="btn btn--ghost" id="tlClip" title="裁剪工具">
              ${ICONS.cut} <span>裁剪</span>
              <span id="clipLbl" style="font-family:var(--font-mono);font-size:11px;opacity:0.7;margin-left:4px;"></span>
            </button>
            <div class="dropdown-menu" id="clipMenu" style="right:0;min-width:160px">
              <div class="dropdown-item" id="clipSetStart">
                <span class="emoji">📍</span>起点设为当前位置
              </div>
              <div class="dropdown-item" id="clipSetEnd">
                <span class="emoji">🏁</span>终点设为当前位置
              </div>
              <div class="dropdown-divider"></div>
              <div class="dropdown-item" id="clipReset">
                <span class="emoji">↺</span>重置裁剪区域
              </div>
              <div class="dropdown-item" id="clipApplyExport">
                <span class="emoji">🎬</span>导出裁剪后的视频
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="timeline-track" id="tlTrack">
        <div class="timeline-ruler" id="tlRuler"></div>
        <div class="timeline-waveform" id="tlWaveform"></div>
        <div class="clip-region" id="clipRegion"></div>
        <div class="clip-handle start" id="clipStartHandle" title="拖动调整裁剪起点"></div>
        <div class="clip-handle" id="clipEndHandle" title="拖动调整裁剪终点"></div>
        <div id="bookmarkMarkers"></div>
        <div class="playhead" id="playhead"></div>
      </div>
    `;
  }

  _bind() {
    const $ = (id) => this.el.querySelector('#' + id);

    $('tlPlay').addEventListener('click', () => this.actions.togglePlay());
    $('tlStop').addEventListener('click', () => this.actions.stopPlayback());
    $('tlSkipBack').addEventListener('click', () => this.actions.seekFrames(-5));
    $('tlSkipForward').addEventListener('click', () => this.actions.seekFrames(5));
    $('tlBookmark').addEventListener('click', () => this.actions.addBookmark());

    $('tlSpeed').addEventListener('click', (e) => { e.stopPropagation(); $('speedMenu').classList.toggle('open'); });
    document.addEventListener('click', () => $('speedMenu').classList.remove('open'));
    $('speedMenu').addEventListener('click', (e) => {
      const it = e.target.closest('[data-rate]');
      if (!it) return;
      e.stopPropagation();
      const r = parseFloat(it.dataset.rate);
      this.actions.setPlaybackRate(r);
      $('speedLbl').textContent = r + 'x';
      $('speedMenu').classList.remove('open');
      $('speedMenu').querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', parseFloat(el.dataset.rate) === r));
    });

    $('tlClip').addEventListener('click', (e) => { e.stopPropagation(); $('clipMenu').classList.toggle('open'); });
    document.addEventListener('click', () => $('clipMenu').classList.remove('open'));
    $('clipSetStart').addEventListener('click', () => this.actions.setClipStart(this.currentTime));
    $('clipSetEnd').addEventListener('click', () => this.actions.setClipEnd(this.currentTime));
    $('clipReset').addEventListener('click', () => this.actions.resetClip());
    $('clipApplyExport').addEventListener('click', () => this.actions.exportClipped());

    const track = $('tlTrack');
    track.addEventListener('pointerdown', (e) => this._onTrackPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onTrackPointerMove(e));
    window.addEventListener('pointerup', () => this._onTrackPointerUp());

    const hStart = $('clipStartHandle');
    const hEnd = $('clipEndHandle');
    hStart.addEventListener('pointerdown', (e) => { e.stopPropagation(); this._draggingClip = 'start'; e.currentTarget.setPointerCapture(e.pointerId); });
    hEnd.addEventListener('pointerdown', (e) => { e.stopPropagation(); this._draggingClip = 'end'; e.currentTarget.setPointerCapture(e.pointerId); });

    window.addEventListener('resize', () => this._updateUI());
  }

  _onTrackPointerDown(e) {
    if (this._draggingClip) return;
    const track = this.el.querySelector('#tlTrack');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    this._seeking = true;
    this._seekFromClientX(e.clientX, rect);
    track.setPointerCapture(e.pointerId);
  }

  _onTrackPointerMove(e) {
    const track = this.el.querySelector('#tlTrack');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (this._seeking) {
      this._seekFromClientX(e.clientX, rect);
    } else if (this._draggingClip) {
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = x * this.duration;
      if (this._draggingClip === 'start') this.actions.setClipStart(time);
      else this.actions.setClipEnd(time);
    }
  }

  _onTrackPointerUp() {
    this._seeking = false;
    this._draggingClip = null;
  }

  _seekFromClientX(clientX, rect) {
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    this.actions.seek(x * this.duration, true);
  }

  _updateUI() {
    const $ = (id) => this.el.querySelector('#' + id);
    if (!$) return;

    $('tlPlay').innerHTML = this.isPlaying ? ICONS.pause : ICONS.play;
    $('timeCurrent').textContent = formatTime(this.currentTime, true);
    $('timeDuration').textContent = formatTime(this.duration);

    const track = $('tlTrack');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const dur = Math.max(1, this.duration);

    const x = (this.currentTime / dur) * 100;
    $('playhead').style.left = x + '%';

    if (this.clipEnd > this.clipStart && dur > 0) {
      const leftPct = (this.clipStart / dur) * 100;
      const widthPct = ((this.clipEnd - this.clipStart) / dur) * 100;
      $('clipRegion').style.left = leftPct + '%';
      $('clipRegion').style.width = widthPct + '%';
      $('clipRegion').style.display = 'block';
      $('clipStartHandle').style.left = leftPct + '%';
      $('clipStartHandle').style.display = 'block';
      $('clipEndHandle').style.left = (leftPct + widthPct) + '%';
      $('clipEndHandle').style.display = 'block';
      $('clipLbl').textContent = `[${formatTime(this.clipStart)} ~ ${formatTime(this.clipEnd)}]`;
    } else {
      $('clipRegion').style.display = 'none';
      $('clipStartHandle').style.display = 'none';
      $('clipEndHandle').style.display = 'none';
      $('clipLbl').textContent = '';
    }

    this._renderRuler();
    this._renderWaveform();
    this._renderBookmarks();
  }

  _renderRuler() {
    const ruler = this.el.querySelector('#tlRuler');
    if (!ruler) return;
    const dur = this.duration;
    if (dur <= 0) { ruler.innerHTML = ''; return; }
    if (ruler.dataset.dur === String(dur) && ruler.childElementCount > 0) return;
    ruler.dataset.dur = String(dur);

    const TICK_COUNT = 10;
    let html = '';
    for (let i = 0; i <= TICK_COUNT; i++) {
      const t = (i / TICK_COUNT) * dur;
      html += `<span style="position:relative;left:${(i / TICK_COUNT) * 100}%;transform:translateX(-50%)">${formatTime(t)}</span>`;
    }
    ruler.innerHTML = html;
  }

  _renderWaveform() {
    const wf = this.el.querySelector('#tlWaveform');
    if (!wf) return;
    const dur = this.duration;
    if (dur <= 0) { wf.innerHTML = ''; return; }
    if (wf.dataset.dur === String(dur) && wf.childElementCount > 0) return;
    wf.dataset.dur = String(dur);

    const BAR_COUNT = 120;
    let html = '';
    for (let i = 0; i < BAR_COUNT; i++) {
      const h = 10 + Math.abs(Math.sin(i * 0.7) * 20) + Math.random() * 24;
      const pct = h / 60 * 100;
      html += `<div class="waveform-bar" style="left:${(i / BAR_COUNT) * 100}%;height:${pct}%;opacity:${0.35 + Math.random() * 0.5}"></div>`;
    }
    wf.innerHTML = html;
  }

  _renderBookmarks() {
    const container = this.el.querySelector('#bookmarkMarkers');
    if (!container) return;
    const dur = Math.max(1, this.duration);
    container.innerHTML = this.bookmarks.map(bm => `
      <div class="bookmark-marker" data-id="${bm.id}" title="${bm.label} @ ${formatTime(bm.time)}" style="left:${(bm.time / dur) * 100}%;background:${bm.color};color:${bm.color};"></div>
    `).join('');

    container.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.actions.gotoBookmark(el.dataset.id);
      });
    });
  }
}
