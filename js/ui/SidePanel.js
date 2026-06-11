import { bus } from '../core/EventBus.js';
import { formatTime, formatDuration, formatDate, formatFileSize, getContrastColor } from '../utils/format.js';

export class SidePanel {
  constructor(rootEl, actions) {
    this.el = rootEl;
    this.actions = actions;
    this.activeTab = 'live';
    this.data = {
      roomCode: null,
      role: null,
      viewers: [],
      bookmarks: [],
      notes: [],
      media: [],
    };
    this._render();
    this._bind();
  }

  setState(patch) {
    if ('tab' in patch) this.activeTab = patch.tab;
    Object.assign(this.data, patch);
    this._updateUI();
  }

  _render() {
    const tabs = [
      { id: 'live', label: '直播', icon: '📡' },
      { id: 'bookmarks', label: '书签', icon: '🔖' },
      { id: 'notes', label: '笔记', icon: '📝' },
      { id: 'media', label: '媒体库', icon: '📁' },
    ];
    this.el.innerHTML = `
      <div class="sidepanel__tabs">
        ${tabs.map(t => `
          <button class="sidepanel__tab ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}">
            <span>${t.icon}</span>
            <span>${t.label}</span>
          </button>
        `).join('')}
      </div>
      <div class="sidepanel__content">
        <div class="tab-panel" data-panel="live"></div>
        <div class="tab-panel hidden" data-panel="bookmarks"></div>
        <div class="tab-panel hidden" data-panel="notes"></div>
        <div class="tab-panel hidden" data-panel="media"></div>
      </div>
    `;
  }

  _bind() {
    this.el.querySelectorAll('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    });
  }

  _switchTab(id) {
    this.activeTab = id;
    this.el.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    this.el.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== id));
    this._updateUI();
  }

  _updateUI() {
    switch (this.activeTab) {
      case 'live': this._renderLive(); break;
      case 'bookmarks': this._renderBookmarks(); break;
      case 'notes': this._renderNotes(); break;
      case 'media': this._renderMedia(); break;
    }
  }

  _renderLive() {
    const panel = this.el.querySelector('[data-panel="live"]');
    if (!panel) return;
    const { roomCode, role, viewers } = this.data;

    const avatarColor = (name) => {
      const colors = ['#EF4444', '#F59E0B', '#10B981', '#22D3EE', '#A855F7', '#EC4899', '#8B5CF6', '#14B8A6'];
      let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return colors[h % colors.length];
    };

    if (!roomCode) {
      panel.innerHTML = `
        <div class="panel-section">
          <div class="panel-title">开始直播</div>
          <button class="btn btn--primary w-full" id="btnCreateRoom">
            🎥 创建直播房间
          </button>
        </div>
        <div class="panel-section">
          <div class="panel-title">加入直播</div>
          <div class="join-box">
            <input type="text" class="code-input" id="joinCode" placeholder="输入6位房间码" maxlength="6">
            <button class="btn w-full mt-2" id="btnJoinRoom">加入直播</button>
          </div>
        </div>
        <div class="empty-state" style="padding-top:20px">
          <div class="empty-icon">📡</div>
          <div class="empty-title">尚未加入直播</div>
          <div class="empty-sub">创建房间获取分享码，<br/>邀请他人实时观看你的录屏。</div>
        </div>
      `;
      panel.querySelector('#btnCreateRoom')?.addEventListener('click', () => this.actions.createRoom());
      panel.querySelector('#btnJoinRoom')?.addEventListener('click', () => {
        const code = panel.querySelector('#joinCode').value.trim();
        if (code) this.actions.joinRoom(code);
      });
      panel.querySelector('#joinCode')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') panel.querySelector('#btnJoinRoom').click();
      });
      return;
    }

    const isHost = role === 'host';
    panel.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">房间信息</div>
        <div class="room-box">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px">
            <span>${isHost ? '你是主持人' : '你是观众'}</span>
            <span style="color:${isHost ? 'var(--accent-cyan)' : 'var(--accent-purple)'}">● 在线</span>
          </div>
          <div class="room-code" id="roomCodeDisplay">${roomCode}</div>
          <div style="display:flex;gap:6px">
            <button class="btn btn--sm flex-1" id="btnCopyCode">📋 复制</button>
            ${isHost ? '' : `<button class="btn btn--sm flex-1" id="btnOpenHost">🔗 新标签打开</button>`}
            <button class="btn btn--sm" id="btnLeaveRoom" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.3);color:var(--accent-red)">退出</button>
          </div>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-title">参与者 (${viewers.length})</div>
        <div class="viewer-list" id="viewerList">
          ${viewers.map(v => `
            <div class="viewer-item">
              <div class="viewer-avatar" style="background:${avatarColor(v.name)};color:${getContrastColor(avatarColor(v.name))}">${v.name.charAt(0).toUpperCase()}</div>
              <div class="viewer-meta">
                <div class="viewer-name">${v.name}</div>
                <div class="viewer-role">${v.isHost ? '主持人' : '观众'}</div>
              </div>
              ${v.isHost ? '<span style="color:var(--accent-cyan);font-size:18px">👑</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
      ${!isHost ? `
        <div class="panel-section">
          <div class="panel-title">同步控制</div>
          <button class="btn w-full" id="btnSyncHost">⏱ 同步到主持人时间</button>
        </div>
      ` : ''}
      <div class="panel-section">
        <div class="panel-title">提示</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
          ${isHost
            ? '将房间码分享给他人，他们可以实时观看你的录屏和涂鸦。在同源的新标签页中打开即可加入（用于测试）。'
            : '你可以在右侧笔记区域独立记录想法，不会影响主持人和其他人。笔记可导出为JSON。'
          }
        </div>
      </div>
    `;
    panel.querySelector('#btnCopyCode')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(roomCode);
        this.actions.toast('房间码已复制', 'success');
      } catch {
        this.actions.toast('复制失败，请手动复制', 'error');
      }
    });
    panel.querySelector('#btnLeaveRoom')?.addEventListener('click', () => {
      if (confirm('确定退出直播房间？')) this.actions.leaveRoom();
    });
    panel.querySelector('#btnOpenHost')?.addEventListener('click', () => {
      window.open(window.location.pathname + '?room=' + roomCode, '_blank', 'width=1200,height=800');
    });
    panel.querySelector('#btnSyncHost')?.addEventListener('click', () => this.actions.syncToHost());
  }

  _renderBookmarks() {
    const panel = this.el.querySelector('[data-panel="bookmarks"]');
    if (!panel) return;
    const list = this.data.bookmarks || [];
    panel.innerHTML = `
      <div class="panel-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="panel-title" style="margin:0">书签 (${list.length})</div>
          <button class="btn btn--ghost btn--sm" id="btnAddBM">＋添加</button>
        </div>
      </div>
      ${list.length ? `
        <div class="bookmark-list">
          ${list.map(bm => `
            <div class="bookmark-item" data-id="${bm.id}">
              <div class="bookmark-dot" style="background:${bm.color};color:${bm.color}"></div>
              <div class="bookmark-time">${formatTime(bm.time)}</div>
              <div class="bookmark-label">${bm.label}</div>
              <button class="bookmark-del" title="删除">✕</button>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">🔖</div>
          <div class="empty-title">暂无书签</div>
          <div class="empty-sub">在播放/录制时按 <span class="kbd-badge">Ctrl+B</span> 添加标记。</div>
        </div>
      `}
    `;
    panel.querySelector('#btnAddBM')?.addEventListener('click', () => this.actions.addBookmark());
    panel.querySelectorAll('.bookmark-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-del')) {
          this.actions.deleteBookmark(el.dataset.id);
        } else {
          this.actions.gotoBookmark(el.dataset.id);
        }
      });
    });
  }

  _renderNotes() {
    const panel = this.el.querySelector('[data-panel="notes"]');
    if (!panel) return;
    const notes = this.data.notes || [];
    panel.innerHTML = `
      <div class="panel-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="panel-title" style="margin:0">我的笔记 (${notes.length})</div>
          <div class="flex gap-2">
            <button class="btn btn--ghost btn--sm" id="btnAddNote" title="在当前时间点添加笔记">＋ 新建</button>
            <button class="btn btn--ghost btn--sm" id="btnExportNotes" title="导出为JSON">📤 导出</button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.5;margin-bottom:10px">
          独立于录制者标注，仅在本地保存。可随时添加和导出。
        </div>
      </div>
      ${notes.length ? `
        <div class="note-list">
          ${notes.map((n, i) => `
            <div class="note-item" data-id="${n.id}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div class="note-time">📍 ${formatTime(n.time)}</div>
                <div class="flex gap-2">
                  <button class="btn btn--ghost btn--sm" data-act="jump">跳转</button>
                  <button class="btn btn--ghost btn--sm" data-act="edit" title="编辑文字/涂鸦">✎</button>
                  <button class="btn btn--ghost btn--sm" data-act="del" style="color:var(--accent-red)">✕</button>
                </div>
              </div>
              ${n.text ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;line-height:1.5">${n.text}</div>` : ''}
              ${n.strokes && n.strokes.length ? `<div class="note-canvas-wrap"><canvas width="320" height="80" data-preview="${i}"></canvas></div>` : `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">（无涂鸦）点击 ✎ 添加笔记涂鸦</div>`}
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <div class="empty-title">还没有笔记</div>
          <div class="empty-sub">点击"新建"在当前时间点添加笔记。</div>
        </div>
      `}
    `;
    panel.querySelector('#btnAddNote')?.addEventListener('click', () => this.actions.addNote());
    panel.querySelector('#btnExportNotes')?.addEventListener('click', () => this.actions.exportNotes());
    panel.querySelectorAll('.note-item').forEach(el => {
      const jumpBtn = el.querySelector('[data-act="jump"]');
      const delBtn = el.querySelector('[data-act="del"]');
      const editBtn = el.querySelector('[data-act="edit"]');
      jumpBtn?.addEventListener('click', () => this.actions.gotoNote(el.dataset.id));
      editBtn?.addEventListener('click', () => this.actions.editNote(el.dataset.id));
      delBtn?.addEventListener('click', () => {
        if (confirm('删除这条笔记？')) this.actions.deleteNote(el.dataset.id);
      });
      const preview = el.querySelector('[data-preview]');
      if (preview) {
        const idx = parseInt(preview.dataset.preview, 10);
        this.actions.renderNotePreview?.(notes[idx], preview);
      }
    });
  }

  _renderMedia() {
    const panel = this.el.querySelector('[data-panel="media"]');
    if (!panel) return;
    const media = this.data.media || [];
    panel.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">导入</div>
        <label class="upload-zone">
          <div style="font-size:28px;margin-bottom:6px">📂</div>
          <div>拖拽或点击上传视频 / 标注JSON</div>
          <div style="font-size:10px;opacity:0.6;margin-top:4px">支持 .webm / .mp4 / .json</div>
          <input type="file" id="mediaUpload" accept="video/*,.json" multiple style="display:none">
        </label>
      </div>
      <div class="panel-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="panel-title" style="margin:0">本地录制 (${media.length})</div>
          <button class="btn btn--ghost btn--sm" id="btnRefreshMedia">↻</button>
        </div>
        ${media.length ? `
          <div class="media-list">
            ${media.map(m => `
              <div class="media-item" data-id="${m.id}">
                <div style="display:flex;justify-content:space-between;align-items:start;">
                  <div class="media-title" style="flex:1">${m.title}</div>
                  <button class="btn btn--ghost btn--sm" data-act="del" title="删除" style="color:var(--accent-red);padding:4px 6px">✕</button>
                </div>
                <div class="media-meta">
                  <span>${formatDuration(m.duration)}</span>
                  <span>${formatDate(m.createdAt)}</span>
                  <span>${formatFileSize(m.size || 0)}</span>
                </div>
                <div style="display:flex;gap:6px;margin-top:8px">
                  <button class="btn btn--sm btn--primary flex-1" data-act="load">加载</button>
                  <button class="btn btn--sm flex-1" data-act="download">下载</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-icon">📁</div>
            <div class="empty-title">暂无录制</div>
            <div class="empty-sub">录制完成的视频会自动保存到此。</div>
          </div>
        `}
      </div>
    `;
    panel.querySelector('#mediaUpload')?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) this.actions.handleFileUpload(e.target.files);
      e.target.value = '';
    });
    panel.querySelector('#btnRefreshMedia')?.addEventListener('click', () => this.actions.refreshMedia());
    panel.querySelectorAll('.media-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-act="load"]')?.addEventListener('click', () => this.actions.loadMedia(id));
      el.querySelector('[data-act="download"]')?.addEventListener('click', () => this.actions.downloadMedia(id));
      el.querySelector('[data-act="del"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('永久删除此录制？此操作不可恢复。')) this.actions.deleteMedia(id);
      });
    });
  }
}
