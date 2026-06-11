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
      <div class="panel-section" style="border-top:1px solid var(--border-glass);padding-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="panel-title" style="margin:0">💬 讨论区</div>
          <span style="font-size:11px;color:var(--text-muted)">${this.data.chatMessages?.length || 0} 条消息</span>
        </div>
        <div class="chat-list" id="chatList" style="max-height:220px;overflow-y:auto;border:1px solid var(--border-glass);border-radius:8px;padding:8px;background:rgba(15,23,42,0.4);margin-bottom:8px">
          ${(this.data.chatMessages || []).length ? (this.data.chatMessages || []).map(m => `
            <div class="chat-item ${m.userId===this.data.myUserId?'chat-item--mine':''}" data-time="${m.time}" style="padding:6px 8px;margin-bottom:6px;border-radius:8px;background:${m.userId===this.data.myUserId?'rgba(34,211,238,0.08)':'rgba(148,163,184,0.06)'};border-left:3px solid ${m.isHost?'var(--accent-cyan)':'var(--accent-purple)'}">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <div style="font-size:12px;font-weight:600;color:${m.isHost?'var(--accent-cyan)':'var(--text-primary)'}">
                  ${m.isHost?'👑 ':''}${m.userName}
                </div>
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);cursor:pointer;text-decoration:underline" data-chat-jump="${m.time}">
                  ${formatTime(m.time)}
                </div>
              </div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;word-break:break-word">${m.text}</div>
            </div>
          `).join('') : `
            <div class="empty-state" style="padding:20px 0">
              <div style="font-size:24px;margin-bottom:6px">💬</div>
              <div style="font-size:12px;color:var(--text-muted)">还没有消息，发送第一条评论吧</div>
            </div>
          `}
        </div>
        <div style="display:flex;gap:6px">
          <input class="form-input" id="chatInput" placeholder="说点什么，回车发送（带上当前时间）" style="flex:1;font-size:12px;padding:6px 10px">
          <button class="btn btn--primary btn--sm" id="btnChatSend">发送</button>
        </div>
      </div>
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

    const sendChat = () => {
      const input = panel.querySelector('#chatInput');
      const text = input?.value?.trim();
      if (!text) return;
      this.actions.sendChat(text);
      input.value = '';
    };
    panel.querySelector('#btnChatSend')?.addEventListener('click', sendChat);
    panel.querySelector('#chatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    panel.querySelectorAll('[data-chat-jump]').forEach(el => {
      el.addEventListener('click', () => {
        const t = parseInt(el.dataset.chatJump, 10);
        if (!isNaN(t)) this.actions.jumpToTime?.(t);
      });
    });
    const chatList = panel.querySelector('#chatList');
    if (chatList) chatList.scrollTop = chatList.scrollHeight;
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
    const state = this._noteSearch || { q: '', filter: 'all', start: null, end: null, expanded: new Set() };

    const q = state.q.trim().toLowerCase();
    const filtered = notes.filter(n => {
      if (state.filter === 'with-stroke' && !(n.strokes?.length > 0 || n.thumbnail)) return false;
      if (state.filter === 'no-stroke' && (n.strokes?.length > 0 || n.thumbnail)) return false;
      if (state.start != null && n.time < state.start) return false;
      if (state.end != null && n.time > state.end) return false;
      if (!q) return true;
      if (n.text?.toLowerCase().includes(q)) return true;
      if (formatTime(n.time).includes(q)) return true;
      return false;
    });

    const quickRanges = [
      { label: '全部', value: 'all' },
      { label: '有涂鸦', value: 'with-stroke' },
      { label: '无涂鸦', value: 'no-stroke' },
    ];
    const timePresets = [
      { label: '全部', s: null, e: null },
      { label: '前30秒', s: 0, e: 30000 },
      { label: '前1分钟', s: 0, e: 60000 },
      { label: '前5分钟', s: 0, e: 300000 },
    ];

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

      <div class="panel-section" style="border-top:1px solid var(--border-glass);padding-top:12px">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <input class="form-input" id="noteSearchInput" placeholder="🔍 搜索文字或时间，如 01:23" style="flex:1;font-size:12px;padding:6px 10px" value="${state.q}">
          <button class="btn btn--ghost btn--sm" id="btnClearSearch" ${!q && state.filter==='all' && state.start==null ? 'disabled' : ''}>×</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
          ${quickRanges.map(r => `<button class="btn btn--ghost btn--sm ${state.filter===r.value?'is-active':''}" data-nf="${r.value}" style="font-size:11px;padding:3px 8px">${r.label}</button>`).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
          ${timePresets.map((p,i) => `<button class="btn btn--ghost btn--sm ${state.start===p.s && state.end===p.e?'is-active':''}" data-np="${i}" style="font-size:11px;padding:3px 8px">${p.label}</button>`).join('')}
        </div>
        ${q || state.filter!=='all' || state.start!=null ? `
          <div style="font-size:11px;color:var(--accent-cyan);margin-bottom:6px">
            🔍 筛选结果：${filtered.length} / ${notes.length} 条笔记
          </div>
        ` : ''}
      </div>

      ${filtered.length ? `
        <div class="note-list">
          ${filtered.map((n, i) => {
            const realIdx = notes.findIndex(x => x.id === n.id);
            const expanded = state.expanded.has(n.id);
            return `
            <div class="note-item ${expanded?'note-item--expanded':''}" data-id="${n.id}" data-real="${realIdx}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div class="note-time">📍 ${formatTime(n.time)}</div>
                <div class="flex gap-2">
                  <button class="btn btn--ghost btn--sm" data-act="jump" title="跳转到该时间点">跳转</button>
                  <button class="btn btn--ghost btn--sm" data-act="toggle" title="展开/收起">${expanded?'▽':'▷'}</button>
                  <button class="btn btn--ghost btn--sm" data-act="edit" title="编辑文字/涂鸦">✎</button>
                  <button class="btn btn--ghost btn--sm" data-act="del" style="color:var(--accent-red)">✕</button>
                </div>
              </div>
              ${n.text ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;line-height:1.5">${n.text}</div>` : ''}
              ${expanded && ((n.strokes && n.strokes.length) || n.thumbnail) ? `<div class="note-canvas-wrap"><canvas width="320" height="180" data-preview="${realIdx}"></canvas></div>` : ''}
              ${expanded && !n.strokes?.length && !n.thumbnail ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">（无涂鸦）点击 ✎ 添加笔记涂鸦</div>` : ''}
            </div>
          `;}).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">${q || state.filter!=='all' ? '🔍' : '📝'}</div>
          <div class="empty-title">${q || state.filter!=='all' ? '没有找到匹配的笔记' : '还没有笔记'}</div>
          <div class="empty-sub">${q || state.filter!=='all' ? '尝试修改搜索条件' : '点击"新建"在当前时间点添加笔记。'}</div>
        </div>
      `}
    `;

    const apply = () => { this._renderNotes(); };

    panel.querySelector('#btnAddNote')?.addEventListener('click', () => this.actions.addNote());
    panel.querySelector('#btnExportNotes')?.addEventListener('click', () => this.actions.exportNotes());

    const searchInput = panel.querySelector('#noteSearchInput');
    searchInput?.focus();
    searchInput?.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput?.addEventListener('input', (e) => {
      this._noteSearch = { ...this._noteSearch, q: e.target.value };
      apply();
    });
    panel.querySelector('#btnClearSearch')?.addEventListener('click', () => {
      this._noteSearch = { q: '', filter: 'all', start: null, end: null, expanded: new Set() };
      apply();
    });
    panel.querySelectorAll('[data-nf]').forEach(el => {
      el.addEventListener('click', () => {
        this._noteSearch = { ...this._noteSearch, filter: el.dataset.nf };
        apply();
      });
    });
    panel.querySelectorAll('[data-np]').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.np, 10);
        const p = timePresets[i];
        this._noteSearch = { ...this._noteSearch, start: p.s, end: p.e };
        apply();
      });
    });

    panel.querySelectorAll('.note-item').forEach(el => {
      const jumpBtn = el.querySelector('[data-act="jump"]');
      const delBtn = el.querySelector('[data-act="del"]');
      const editBtn = el.querySelector('[data-act="edit"]');
      const toggleBtn = el.querySelector('[data-act="toggle"]');
      jumpBtn?.addEventListener('click', () => {
        this.actions.gotoNote(el.dataset.id);
        if (!this._noteSearch.expanded.has(el.dataset.id)) {
          this._noteSearch.expanded.add(el.dataset.id);
          apply();
        }
      });
      toggleBtn?.addEventListener('click', () => {
        const id = el.dataset.id;
        if (this._noteSearch.expanded.has(id)) this._noteSearch.expanded.delete(id);
        else this._noteSearch.expanded.add(id);
        apply();
      });
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
