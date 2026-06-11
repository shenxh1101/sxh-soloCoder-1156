import { bus } from './core/EventBus.js';
import { Recorder } from './core/Recorder.js';
import { DrawEngine, TOOLS, DEFAULT_COLORS } from './core/DrawEngine.js';
import { Timeline } from './core/Timeline.js';
import { StreamSync, ROLE } from './core/StreamSync.js';
import { Exporter } from './core/Exporter.js';
import { ShortcutManager, defaultShortcutBindings } from './core/ShortcutManager.js';
import { Toolbar } from './ui/Toolbar.js';
import { Toolbox } from './ui/Toolbox.js';
import { TimelineUI } from './ui/TimelineUI.js';
import { SidePanel } from './ui/SidePanel.js';
import {
  saveBlob, getBlob, saveProject, getProject, listProjects, deleteProject,
  loadSettings, saveSettings, saveViewerNotes, loadViewerNotes,
} from './utils/storage.js';
import {
  uuid, formatTime, formatDuration, formatDate, formatFileSize,
  downloadBlob, clamp,
} from './utils/format.js';

const $ = (id) => document.getElementById(id);
const BM_COLORS = ['#22D3EE', '#F59E0B', '#10B981', '#EF4444', '#A855F7', '#EC4899'];

class App {
  constructor() {
    this.state = {
      recording: false,
      paused: false,
      hasVideo: false,
      recordingStartTime: 0,
      strokesVisible: true,
      currentProjectId: null,
      notes: [],
      hostTimeOffset: 0,
      chatMessages: [],
    };

    this.recorder = new Recorder();
    this.drawEngine = new DrawEngine();
    this.timeline = new Timeline();
    this.streamSync = new StreamSync();
    this.exporter = new Exporter();
    this.shortcuts = new ShortcutManager();

    this.viewerNotes = [];
    this._init();
  }

  async _init() {
    this._initCanvases();
    this._initExporter();
    this._initActions();
    this._initUI();
    this._bindCoreEvents();
    this._initShortcuts();
    this._initCursorTrack();
    await this._loadMediaList();
    this._checkRoomJoin();
    this._setupResize();
    this.toast('ScreenStudio 就绪，按 Ctrl+R 开始录制', 'info', 3500);
  }

  _initCanvases() {
    const draw = $('drawCanvas');
    const overlay = $('overlayCanvas');
    const video = $('videoPreview');
    this.drawEngine.attachCanvas(draw, overlay);
    this.drawEngine.setStrokeTimeProvider(() => this.recorder.currentTime || this.timeline.currentTime || 0);
    this.recorder.attachVideo(video);
    this.timeline.setVideoElement(video);
    video.addEventListener('loadedmetadata', () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        const container = $('canvasContainer');
        if (container) container.style.aspectRatio = `${vw}/${vh}`;
        this.drawEngine.resize();
      }
    });
  }

  _initExporter() {
    this.exporter.configure({
      videoElement: $('videoPreview'),
      drawEngine: this.drawEngine,
      timeline: this.timeline,
      fps: 30,
    });
  }

  _initUI() {
    this.toolbar = new Toolbar($('toolbar'), this.actions);
    this.toolbox = new Toolbox($('toolbox'), this.actions);
    this.timelineUI = new TimelineUI($('timelineWrap'), this.actions);
    this.sidePanel = new SidePanel($('sidepanel'), this.actions);
    this._syncAllUI();
  }

  _syncAllUI() {
    this.toolbar.setState({
      recording: this.state.recording,
      paused: this.state.paused,
      currentTime: this.state.recording ? this.recorder.currentTime : this.timeline.currentTime,
      duration: this.timeline.duration,
      hasVideo: this.state.hasVideo,
      drawEnabled: this.drawEngine.enabled,
      strokesVisible: this.state.strokesVisible,
    });
    this.toolbox.setState({
      tool: this.drawEngine.tool,
      color: this.drawEngine.color,
      width: this.drawEngine.penWidth,
    });
    this.timelineUI.setState({
      duration: this.timeline.duration,
      currentTime: this.timeline.currentTime,
      clipStart: this.timeline.clipStart,
      clipEnd: this.timeline.clipEnd,
      isPlaying: this.timeline.isPlaying,
      bookmarks: this.timeline.bookmarks,
      playbackRate: this.timeline.playbackRate,
    });
    this.sidePanel.setState({
      tab: this.sidePanel.activeTab,
      roomCode: this.streamSync.roomCode,
      role: this.streamSync.role,
      viewers: this.streamSync.getViewerList(),
      bookmarks: this.timeline.bookmarks,
      notes: this.viewerNotes,
      media: this._mediaList || [],
    });
  }

  _initActions() {
    const self = this;
    this.actions = {
      toggleRecord: () => self._actionToggleRecord(),
      togglePauseRecord: () => self._actionTogglePause(),
      toggleDraw: () => self._actionToggleDraw(),
      setStrokesVisible: (v) => self._actionSetStrokesVisible(v),
      setTool: (t) => { self.drawEngine.setTool(t); self.toolbox.setState({ tool: t }); },
      setColor: (c) => { self.drawEngine.setColor(c); self.toolbox.setState({ color: c }); },
      setWidth: (w) => { self.drawEngine.penWidth = w; self.toolbox.setState({ width: w }); },
      undo: () => self.drawEngine.undo(),
      redo: () => self.drawEngine.redo(),
      clear: () => self.drawEngine.clearAll(),
      adjustWidth: (delta) => {
        const w = clamp(self.drawEngine.penWidth + delta, 1, 40);
        self.actions.setWidth(w);
        self.toast(`画笔粗细: ${w}px`, 'info', 1000);
      },
      addBookmark: (time, label) => self._actionAddBookmark(time, label),
      deleteBookmark: (id) => {
        self.timeline.removeBookmark(id);
        self.timelineUI.setState({ bookmarks: self.timeline.bookmarks });
        self.sidePanel.setState({ bookmarks: self.timeline.bookmarks });
        self.toast('书签已删除', 'success');
      },
      gotoBookmark: (id) => {
        self.timeline.gotoBookmark(id);
        self._syncTimeUI();
      },
      gotoPrevBookmark: () => self._actionGotoAdjBookmark(-1),
      gotoNextBookmark: () => self._actionGotoAdjBookmark(1),
      togglePlay: () => self.timeline.togglePlay(),
      stopPlayback: () => self.timeline.stopPlayback(),
      seekFrames: (n) => self.timeline.seekFrames(n),
      seek: (t, user) => self.timeline.seek(t, user),
      setPlaybackRate: (r) => { self.timeline.setPlaybackRate(r); self.toast(`播放速度: ${r}x`, 'info', 1200); },
      setClipStart: (t) => {
        self.timeline.setClipStart(t);
        self._syncClipUI();
        self.toast(`裁剪起点: ${formatTime(t)}`, 'info', 1500);
      },
      setClipEnd: (t) => {
        self.timeline.setClipEnd(t);
        self._syncClipUI();
        self.toast(`裁剪终点: ${formatTime(t)}`, 'info', 1500);
      },
      resetClip: () => {
        self.timeline.resetClip();
        self._syncClipUI();
        self.toast('已重置裁剪区域', 'success');
      },
      exportClipped: () => self._actionExportVideo({ useClipRange: true, burnStrokes: true }),
      exportVideo: (opts) => self._actionExportVideo(opts),
      exportFrames: () => self._actionExportFrames(),
      exportAnnotations: () => {
        self.exporter.exportStrokesJSON();
        self.toast('标注JSON已导出', 'success');
      },
      exportNotes: () => {
        if (!self.viewerNotes.length) { self.toast('暂无笔记可导出', 'info'); return; }
        self.exporter.exportNotesJSON(self.viewerNotes, {
          roomCode: self.streamSync.roomCode,
          projectId: self.state.currentProjectId,
        });
        self.toast(`已导出 ${self.viewerNotes.length} 条笔记`, 'success');
      },
      handleFileUpload: (files) => self._actionHandleFiles(files),
      openSettings: () => self._openSettingsModal(),
      createRoom: () => {
        const code = self.streamSync.createRoom();
        self.state.chatMessages = [];
        self.sidePanel.setState({ roomCode: code, role: self.streamSync.role, viewers: self.streamSync.getViewerList(), chatMessages: self.state.chatMessages, myUserId: self.streamSync.userId });
        self.toast(`直播房间已创建: ${code}`, 'success');
        self._syncSidePanel();
      },
      joinRoom: (code) => {
        const ok = self.streamSync.joinRoom(code);
        if (ok) {
          self.state.chatMessages = [];
          self.sidePanel.setState({ roomCode: code, role: self.streamSync.role, viewers: self.streamSync.getViewerList(), chatMessages: self.state.chatMessages, myUserId: self.streamSync.userId });
          self._syncSidePanel();
        }
      },
      leaveRoom: () => {
        self.streamSync.leaveRoom();
        self.state.chatMessages = [];
        self.sidePanel.setState({ roomCode: null, role: null, viewers: [], chatMessages: [], myUserId: null });
        self._syncSidePanel();
        self.toast('已退出房间', 'success');
      },
      syncToHost: () => {
        if (self.state.hostTimeOffset > 0) {
          self.timeline.seek(self.state.hostTimeOffset, true);
          self.toast('已同步到主持人时间', 'success');
        }
      },
      addNote: () => self._actionAddNote(),
      editNote: (id) => {
        const note = self.viewerNotes.find(n => n.id === id);
        if (!note) return;
        self._openNoteEditor(note, (saved) => {
          if (!saved) return;
          note.text = saved.text || '';
          note.strokes = saved.strokes || [];
          if (saved.thumbnail) note.thumbnail = saved.thumbnail;
          if (saved.thumbMeta) note.thumbMeta = saved.thumbMeta;
          self._persistViewerNotes();
          self.sidePanel.setState({ notes: self.viewerNotes });
          self.toast('笔记已更新', 'success');
        });
      },
      deleteNote: (id) => {
        self.viewerNotes = self.viewerNotes.filter(n => n.id !== id);
        self._persistViewerNotes();
        self.sidePanel.setState({ notes: self.viewerNotes });
        self.toast('笔记已删除', 'success');
      },
      gotoNote: (id) => {
        const note = self.viewerNotes.find(n => n.id === id);
        if (note) { self.timeline.seek(note.time, true); self._syncTimeUI(); }
      },
      renderNotePreview: (note, canvasEl) => self._renderNotePreview(note, canvasEl),
      refreshMedia: () => self._loadMediaList(),
      loadMedia: (id) => self._actionLoadProject(id),
      downloadMedia: (id) => self._actionDownloadProject(id),
      deleteMedia: (id) => self._actionDeleteProject(id),
      toast: (m, t, d) => self.toast(m, t, d),
      sendChat: (text) => {
        const t = self.timeline.currentTime || self.recorder.currentTime || 0;
        self.streamSync.broadcastChat(text, t);
        const msg = {
          id: uuid(),
          userId: self.streamSync.userId,
          userName: self.streamSync.userName,
          text,
          time: t,
          isHost: self.streamSync.role === ROLE.HOST,
          createdAt: Date.now(),
        };
        self.state.chatMessages.push(msg);
        self.sidePanel.setState({ chatMessages: self.state.chatMessages, myUserId: self.streamSync.userId });
      },
      jumpToTime: (t) => {
        if (!isFinite(t)) return;
        self.timeline.seek(t, true);
        self._syncTimeUI();
        self.toast(`跳转到 ${formatTime(t)}`, 'info');
      },
    };
  }

  _initShortcuts() {
    const bindings = defaultShortcutBindings(this);
    for (const b of bindings) this.shortcuts.register(b);
    this.shortcuts.setScopeEnabled('recording', true);
    this.shortcuts.setScopeEnabled('drawing', true);
    this.shortcuts.setScopeEnabled('editor', true);
  }

  _initCursorTrack() {
    const highlight = $('cursorHighlight');
    const container = $('canvasContainer');
    const canvas = $('drawCanvas');

    let raf = null;
    let target = { x: -1, y: -1, visible: false };
    let current = { x: -1, y: -1, visible: false };

    const tick = () => {
      if (target.visible && this.state.recording) {
        current.x += (target.x - current.x) * 0.35;
        current.y += (target.y - current.y) * 0.35;
        current.visible = true;
        highlight.classList.add('active');
        highlight.style.transform = `translate(${current.x}px, ${current.y}px)`;
      } else {
        highlight.classList.remove('active');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    container.addEventListener('mousemove', (e) => {
      if (!this.state.recording) return;
      const rect = canvas.getBoundingClientRect();
      target.x = e.clientX - rect.left;
      target.y = e.clientY - rect.top;
      target.visible = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    });
    container.addEventListener('mouseleave', () => { target.visible = false; });
  }

  _setupResize() {
    const ro = new ResizeObserver(() => {
      this.drawEngine.resize();
      this._syncAllUI();
    });
    ro.observe($('canvasContainer'));
  }

  _bindCoreEvents() {
    bus.on('recorder:started', () => {
      this.state.recording = true;
      this.state.paused = false;
      $('placeholder').classList.add('hidden');
      $('canvasContainer').classList.add('recording');
      this.toolbar.setState({ recording: true, paused: false, currentTime: 0 });
      this.toast('录制已开始', 'success');
    });

    bus.on('recorder:tick', ({ time }) => {
      this.toolbar.setState({ currentTime: time });
      this.timeline.currentTime = time;
      if (this.timeline.duration < time) this.timeline.duration = time;
    });

    bus.on('recorder:paused', ({ time }) => {
      this.state.paused = true;
      this.toolbar.setState({ paused: true, currentTime: time });
      this.toast('录制已暂停', 'info');
    });

    bus.on('recorder:resumed', ({ time }) => {
      this.state.paused = false;
      this.toolbar.setState({ paused: false, currentTime: time });
      this.toast('录制已恢复', 'info');
    });

    bus.on('recorder:stopped', async ({ videoBlob, duration }) => {
      this.state.recording = false;
      this.state.paused = false;
      $('canvasContainer').classList.remove('recording');
      try {
        if (!videoBlob || videoBlob.size < 1000) {
          this.toast('录制文件为空，未保存', 'error');
          return;
        }
        const videoUrl = URL.createObjectURL(videoBlob);
        const v = $('videoPreview');
        v.srcObject = null;
        v.src = videoUrl;
        await new Promise(res => { v.onloadedmetadata = () => res(); setTimeout(res, 3000); });
        this.state.hasVideo = true;
        const realDuration = isFinite(v.duration) ? v.duration * 1000 : duration;
        this.timeline.setDuration(realDuration);
        this.timeline.resetClip();
        this.timeline.seek(0);
        const project = await this._saveNewProject(videoBlob, realDuration);
        this.state.currentProjectId = project.id;
        this._syncAllUI();
        await this._loadMediaList();
        this.toast(`录制完成 (${formatDuration(realDuration)})，已保存`, 'success', 4000);
      } catch (err) {
        console.error(err);
        this.toast('录制处理失败：' + err.message, 'error');
      }
    });

    bus.on('recorder:error', ({ message }) => this.toast(message, 'error'));

    bus.on('draw:strokeAdded', (stroke) => {
      if (this.streamSync.role === ROLE.HOST) this.streamSync.broadcastStroke(stroke);
    });

    bus.on('draw:strokeLive', (stroke) => {
      if (this.streamSync.role === ROLE.HOST) this.streamSync.broadcastLiveStroke(stroke);
    });

    bus.on('draw:strokeLiveEnd', ({ id }) => {
      if (this.streamSync.role === ROLE.HOST) this.streamSync.broadcastLiveStrokeEnd(id);
    });

    bus.on('timeline:time', ({ current }) => {
      if (this.state.strokesVisible) this.drawEngine.renderStrokesForTime(current);
      else {
        const c = this.drawEngine.ctx;
        if (c) c.clearRect(0, 0, this.drawEngine.width, this.drawEngine.height);
      }
      this.timelineUI.setState({ currentTime: current });
      this.toolbar.setState({ currentTime: current });
    });

    bus.on('timeline:clipChanged', () => this._syncClipUI());
    bus.on('timeline:bookmarkAdded', (bm) => {
      if (this.streamSync.role === ROLE.HOST) this.streamSync.broadcastBookmark(bm);
      this.toast(`书签已添加 @ ${formatTime(bm.time)}`, 'success', 2000);
      this._syncBookmarks();
    });
    bus.on('timeline:playState', (playing) => {
      this.timelineUI.setState({ isPlaying: playing });
    });

    bus.on('stream:error', ({ message }) => this.toast(message, 'error'));
    bus.on('stream:viewerList', () => this._syncSidePanel());
    bus.on('stream:viewerJoined', ({ userName }) => this.toast(`${userName} 加入了房间`, 'info'));
    bus.on('stream:viewerLeft', ({ userName }) => this.toast(`${userName} 离开了房间`, 'info'));
    bus.on('stream:frameReceived', ({ url, w, h }) => {
      $('placeholder').classList.add('hidden');
      const v = $('videoPreview');
      const viewerFrame = $('viewerFrame');
      if (!viewerFrame) return;
      if (!this._viewerImg) this._viewerImg = new Image();
      const img = this._viewerImg;
      const drawFrame = () => {
        const W = viewerFrame.width = viewerFrame.parentElement.clientWidth || 1280;
        const H = viewerFrame.height = viewerFrame.parentElement.clientHeight || 720;
        const ctx = viewerFrame.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        try {
          const ratio = Math.min(W / img.width, H / img.height);
          const dw = img.width * ratio;
          const dh = img.height * ratio;
          const dx = (W - dw) / 2;
          const dy = (H - dh) / 2;
          ctx.drawImage(img, dx, dy, dw, dh);
        } catch (e) {}
      };
      img.onload = drawFrame;
      try { img.src = url; } catch {}
      if (v.src) { try { v.removeAttribute('src'); v.load && v.load(); } catch {} v.src = ''; }
      if (v.srcObject) { try { v.srcObject.getTracks().forEach(t => t.stop()); } catch {} v.srcObject = null; }
      v.style.display = 'none';
      viewerFrame.style.display = 'block';
      this.state.hasVideo = true;
      this.timeline.setDuration(Math.max(this.timeline.duration, 3600 * 1000));
      this.toolbar.setState({ hasVideo: true });
    });
    bus.on('stream:strokeReceived', ({ stroke }) => {
      if (!stroke) return;
      this.drawEngine.addExternalStroke(stroke);
      this.drawEngine.redrawAll();
    });
    bus.on('stream:strokeLiveReceived', ({ stroke }) => {
      if (!stroke) return;
      this.drawEngine.renderOverlayStroke(stroke);
    });
    bus.on('stream:strokeLiveEndReceived', () => {
      this.drawEngine.clearOverlay();
    });
    bus.on('stream:chat', ({ userId, userName, text, time, isHost }) => {
      const exists = this.state.chatMessages.find(m => m.userId === userId && m.text === text && m.time === time && Math.abs(m.createdAt - Date.now()) < 5000);
      if (exists) return;
      const msg = {
        id: uuid(),
        userId,
        userName,
        text,
        time,
        isHost,
        createdAt: Date.now(),
      };
      this.state.chatMessages.push(msg);
      this.sidePanel.setState({ chatMessages: this.state.chatMessages, myUserId: this.streamSync.userId });
      this.toast(`💬 ${userName}: ${text.slice(0, 30)}${text.length > 30 ? '...' : ''}`, 'info', 2500);
    });
    bus.on('stream:bookmarkReceived', (bm) => {
      this.timeline.bookmarks.push(bm);
      this.timeline.bookmarks.sort((a, b) => a.time - b.time);
      this._syncBookmarks();
      this.toast(`收到主持人书签 @ ${formatTime(bm.time)}`, 'info');
    });
  }

  _checkRoomJoin() {
    const params = new URLSearchParams(location.search);
    const code = params.get('room');
    if (code && code.length >= 4) {
      setTimeout(() => this.actions.joinRoom(code), 500);
    }
  }

  _syncTimeUI() {
    this.toolbar.setState({ currentTime: this.timeline.currentTime });
    this.timelineUI.setState({ currentTime: this.timeline.currentTime });
  }

  _syncClipUI() {
    this.timelineUI.setState({
      clipStart: this.timeline.clipStart,
      clipEnd: this.timeline.clipEnd,
      duration: this.timeline.duration,
    });
  }

  _syncBookmarks() {
    this.timelineUI.setState({ bookmarks: this.timeline.bookmarks });
    this.sidePanel.setState({ bookmarks: this.timeline.bookmarks });
  }

  _syncSidePanel() {
    this.sidePanel.setState({
      roomCode: this.streamSync.roomCode,
      role: this.streamSync.role,
      viewers: this.streamSync.getViewerList(),
    });
  }

  _persistViewerNotes() {
    if (this.streamSync.roomCode) saveViewerNotes(this.streamSync.roomCode, this.viewerNotes);
  }

  _actionToggleRecord() {
    if (this.recorder.isIdle) {
      this._startRecording();
    } else {
      this.recorder.stop(true);
    }
  }

  async _startRecording() {
    if (!('getDisplayMedia' in navigator.mediaDevices)) {
      this.toast('当前浏览器不支持屏幕录制功能', 'error');
      return;
    }
    this.drawEngine.loadStrokes([]);
    this.timeline.reset();
    const ok = await this.recorder.start({
      audio: false,
      cursor: true,
      fps: 30,
    });
    if (!ok) return;
    this.state.currentProjectId = null;
  }

  _actionTogglePause() {
    if (this.recorder.isIdle) return;
    this.recorder.togglePause();
  }

  _actionToggleDraw() {
    const next = !this.drawEngine.enabled;
    this.drawEngine.setEnabled(next);
    this.toolbar.setState({ drawEnabled: next });
    this.toast(next ? '画笔已启用，可在画布上标注' : '画笔已关闭', 'info', 1500);
  }

  _actionSetStrokesVisible(v) {
    this.state.strokesVisible = v;
    if (!v) {
      const c = this.drawEngine.ctx;
      if (c) c.clearRect(0, 0, this.drawEngine.width, this.drawEngine.height);
      if (this.drawEngine.overlayCtx) this.drawEngine.overlayCtx.clearRect(0, 0, this.drawEngine.width, this.drawEngine.height);
    } else {
      this.drawEngine.renderStrokesForTime(this.timeline.currentTime);
    }
    this.toast(v ? '显示标注层' : '隐藏标注层（不影响原视频）', 'info', 1500);
  }

  _actionAddBookmark(time, label) {
    const t = time ?? (this.state.recording ? this.recorder.currentTime : this.timeline.currentTime);
    const color = BM_COLORS[this.timeline.bookmarks.length % BM_COLORS.length];
    const lbl = label || prompt('书签名称：', `书签 ${this.timeline.bookmarks.length + 1}`);
    if (lbl === null) return;
    this.timeline.addBookmark(t, lbl || `书签 ${this.timeline.bookmarks.length + 1}`, color);
  }

  _actionGotoAdjBookmark(dir) {
    const bms = this.timeline.bookmarks;
    if (!bms.length) return;
    const cur = this.timeline.currentTime;
    if (dir > 0) {
      const next = bms.find(b => b.time > cur + 50) || bms[0];
      this.timeline.gotoBookmark(next.id);
    } else {
      let prev = bms[bms.length - 1];
      for (let i = bms.length - 1; i >= 0; i--) {
        if (bms[i].time < cur - 50) { prev = bms[i]; break; }
      }
      this.timeline.gotoBookmark(prev.id);
    }
    this._syncTimeUI();
  }

  async _actionExportVideo(opts = {}) {
    if (!this.state.hasVideo) { this.toast('暂无视频可导出', 'error'); return; }
    const modal = this._openProgressModal('正在导出视频...');
    try {
      const result = await this.exporter.exportVideo({
        ...opts,
        onProgress: (pct, msg) => modal.update(pct, msg),
      });
      modal.close();
      this.toast(`导出完成！大小：${formatFileSize(result.size)}，时长：${formatDuration(result.duration)}`, 'success', 4000);
    } catch (e) {
      console.error(e);
      modal.close();
      this.toast('导出失败：' + (e.message || '未知错误'), 'error');
    }
  }

  async _actionExportFrames() {
    if (!this.state.hasVideo) { this.toast('暂无视频可导出', 'error'); return; }
    const interval = parseInt(prompt('帧间隔（毫秒，默认 1000 = 1秒/张）：', '1000'), 10);
    if (!interval || interval < 50) { this.toast('间隔过小或已取消', 'info'); return; }
    const modal = this._openProgressModal('正在导出帧序列...');
    try {
      const res = await this.exporter.exportFrames({
        intervalMs: interval,
        onProgress: (pct, msg) => modal.update(pct, msg),
        burnStrokes: this.state.strokesVisible,
      });
      modal.close();
      this.toast(`已导出 ${res.count} 张图片，请检查下载列表`, 'success', 4000);
    } catch (e) {
      console.error(e);
      modal.close();
      this.toast('导出失败：' + (e.message || '未知错误'), 'error');
    }
  }

  async _actionHandleFiles(files) {
    const arr = Array.from(files);
    for (const f of arr) {
      if (f.type.startsWith('video/')) {
        await this._importVideo(f);
      } else if (f.name.endsWith('.json') || f.type === 'application/json') {
        await this._importJSON(f);
      } else {
        this.toast(`不支持的文件：${f.name}`, 'error');
      }
    }
  }

  async _importVideo(file) {
    const modal = this._openProgressModal('正在加载视频...');
    try {
      this.drawEngine.loadStrokes([]);
      this.timeline.reset();
      const url = URL.createObjectURL(file);
      const v = $('videoPreview');
      v.srcObject = null;
      v.src = url;
      const viewerFrame = $('viewerFrame');
      if (viewerFrame) { viewerFrame.style.display = 'none'; viewerFrame.getContext('2d').clearRect(0, 0, viewerFrame.width, viewerFrame.height); }
      v.style.display = '';
      await new Promise((resolve, reject) => {
        v.onloadedmetadata = resolve;
        v.onerror = () => reject(new Error('视频加载失败'));
        setTimeout(resolve, 10000);
      });
      this.state.hasVideo = true;
      const dur = isFinite(v.duration) ? v.duration * 1000 : 0;
      this.timeline.setDuration(dur);
      this.timeline.resetClip();
      this.timeline.seek(0);
      $('placeholder').classList.add('hidden');

      const blobId = uuid();
      await saveBlob(blobId, file);
      const project = {
        id: uuid(),
        title: `导入 - ${file.name}`,
        createdAt: Date.now(),
        duration: dur,
        videoBlobId: blobId,
        videoSize: { width: v.videoWidth, height: v.videoHeight },
        strokes: [],
        bookmarks: [],
        clipStart: 0,
        clipEnd: dur,
        settings: { fps: 30, includeAudio: true, cursorHighlight: false },
        size: file.size,
      };
      await saveProject(project);
      this.state.currentProjectId = project.id;
      await this._loadMediaList();
      modal.close();
      this._syncAllUI();
      this.toast(`视频已加载 (${formatDuration(dur)})`, 'success', 4000);
    } catch (e) {
      console.error(e);
      modal.close();
      this.toast('视频加载失败：' + e.message, 'error');
    }
  }

  async _importJSON(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.type === 'viewer_notes' && Array.isArray(data.notes)) {
        this.viewerNotes = data.notes;
        this._persistViewerNotes();
        this.sidePanel.setState({ notes: this.viewerNotes });
        this.toast(`已导入 ${this.viewerNotes.length} 条笔记`, 'success');
      } else if (Array.isArray(data.strokes)) {
        this.drawEngine.loadStrokes(data.strokes);
        if (Array.isArray(data.bookmarks)) {
          this.timeline.loadBookmarks(data.bookmarks);
          this._syncBookmarks();
        }
        this.toast(`已导入 ${data.strokes.length} 条标注`, 'success');
      } else {
        this.toast('无法识别的JSON格式', 'error');
      }
    } catch (e) {
      console.error(e);
      this.toast('JSON解析失败：' + e.message, 'error');
    }
  }

  _actionAddNote() {
    const time = this.timeline.currentTime || this.recorder.currentTime || 0;
    this._openNoteEditor({ time, text: '', strokes: [] }, (saved) => {
      if (!saved) return;
      const note = {
        id: uuid(),
        time,
        text: saved.text || '',
        strokes: saved.strokes || [],
        thumbnail: saved.thumbnail || '',
        thumbMeta: saved.thumbMeta || null,
        createdAt: Date.now(),
      };
      this.viewerNotes.push(note);
      this.viewerNotes.sort((a, b) => a.time - b.time);
      this._persistViewerNotes();
      this.sidePanel.setState({ notes: this.viewerNotes });
      this.toast(`笔记已添加 @ ${formatTime(time)}`, 'success');
    });
  }

  _openNoteEditor(note, onDone) {
    const root = $('modalRoot');
    const time = note.time ?? 0;

    const captureThumb = () => {
      try {
        const v = $('videoPreview');
        const vf = $('viewerFrame');
        const src = (!v.src && !v.srcObject && vf && vf.style.display !== 'none') ? vf : v;
        if (!src || (src.tagName === 'VIDEO' && !src.src && !src.srcObject)) return { dataUrl: '', meta: null };
        let vw = 1280, vh = 720;
        if (src.tagName === 'VIDEO') { vw = src.videoWidth || 1280; vh = src.videoHeight || 720; }
        else { vw = src.videoWidth || src.width || 1280; vh = src.videoHeight || src.height || 720; }
        const tw = 480, th = 270;
        const off = document.createElement('canvas');
        off.width = tw; off.height = th;
        const octx = off.getContext('2d');
        octx.fillStyle = '#050810';
        octx.fillRect(0, 0, tw, th);
        try {
          const r = Math.min(tw / vw, th / vh);
          const dw = vw * r, dh = vh * r;
          octx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
        } catch (e) {}
        return { dataUrl: off.toDataURL('image/jpeg', 0.7), meta: { vw, vh, tw, th } };
      } catch (e) { return { dataUrl: '', meta: null }; }
    };

    const initial = note.thumbnail ? { dataUrl: note.thumbnail, meta: note.thumbMeta || null } : captureThumb();
    const initialThumb = initial.dataUrl;
    const initialMeta = initial.meta;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="width:min(760px,94vw)">
        <div class="modal-header">
          <div class="modal-title">📝 笔记编辑器 · <span style="font-family:var(--font-mono);color:var(--accent-cyan);font-size:14px">${formatTime(time)}</span></div>
          <button class="modal-close" data-action="close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-label">文字笔记</div>
            <textarea class="form-input" data-field="text" rows="3" style="resize:vertical;font-family:var(--font-display)">${note.text || ''}</textarea>
          </div>
          <div class="form-row">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div class="form-label" style="margin:0">涂鸦区域（在当前视频帧上标注）</div>
              <div style="display:flex;gap:6px;align-items:center">
                <div style="display:flex;gap:4px">
                  ${['#EF4444','#F59E0B','#10B981','#22D3EE','#A855F7','#FFFFFF'].map((c,i)=>`<div class="ne-swatch" data-color="${c}" style="width:22px;height:22px;border-radius:50%;cursor:pointer;background:${c};border:2px solid ${i===0?'white':'transparent'};box-shadow:${i===0?'0 0 0 2px var(--accent-cyan)':'none'}"></div>`).join('')}
                </div>
                <div style="width:1px;height:22px;background:var(--border-glass);margin:0 4px"></div>
                <div style="display:flex;gap:6px;align-items:center">
                  ${[2,4,8,14].map((s,i)=>`<div class="ne-width" data-width="${s}" style="width:${s+8}px;height:${s+8}px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center"><div style="width:${s}px;height:${s}px;border-radius:50%;background:${i===1?'var(--accent-cyan)':'var(--text-secondary)'}"></div></div>`).join('')}
                </div>
                <div style="width:1px;height:22px;background:var(--border-glass);margin:0 4px"></div>
                <button class="btn btn--ghost btn--sm" data-action="undo">↶</button>
                <button class="btn btn--ghost btn--sm" data-action="clear">清空</button>
              </div>
            </div>
            <div style="width:100%;aspect-ratio:16/9;border-radius:10px;background:#050810;border:1px solid var(--border-glass);overflow:hidden;position:relative;cursor:crosshair">
              <canvas id="neCanvas" style="width:100%;height:100%;display:block"></canvas>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px">提示：底图为笔记创建时的视频帧，涂鸦叠加在上方。笔迹、时间点、文字随 JSON 导出/导入。</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" data-action="cancel">取消</button>
          <button class="btn btn--primary" data-action="save">保存笔记</button>
        </div>
      </div>
    `;
    root.appendChild(overlay);

    const canvas = overlay.querySelector('#neCanvas');
    const ctx = canvas.getContext('2d');
    let thumbImg = null;
    const loadThumb = () => new Promise(resolve => {
      if (!initialThumb) { resolve(null); return; }
      const im = new Image();
      im.onload = () => { thumbImg = im; resolve(im); };
      im.onerror = () => resolve(null);
      im.src = initialThumb;
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      redrawAll();
    };

    let strokes = (note.strokes || []).map(s => JSON.parse(JSON.stringify(s)));
    let undoStack = [];
    let drawing = false;
    let curStroke = null;
    let curColor = '#EF4444';
    let curWidth = 4;

    const getTransform = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const vw = initialMeta?.vw || 16, vh = initialMeta?.vh || 9;
      const r = Math.min(w / vw, h / vh);
      const dw = vw * r, dh = vh * r;
      const dx = (w - dw) / 2, dy = (h - dh) / 2;
      return { w, h, vw, vh, r, dx, dy, dw, dh };
    };

    const redrawAll = () => {
      const { w, h, r, dx, dy, dw, dh } = getTransform();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, w, h);
      if (thumbImg) {
        try {
          ctx.drawImage(thumbImg, dx, dy, dw, dh);
        } catch (e) {}
      }
      for (const s of strokes) drawStroke(s);
    };

    const drawStroke = (s) => {
      if (!s.points?.length) return;
      const { vw, vh, r, dx, dy } = getTransform();
      const toPx = (p) => ({ x: p.x * vw * r + dx, y: p.y * vh * r + dy });
      const pts = s.points.map(toPx);
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, s.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      }
      ctx.restore();
    };

    const getRel = (e) => {
      const { vw, vh, r, dx, dy, dw, dh } = getTransform();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left - dx;
      const py = e.clientY - rect.top - dy;
      return {
        x: Math.max(0, Math.min(1, px / (vw * r))),
        y: Math.max(0, Math.min(1, py / (vh * r))),
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      const p = getRel(e);
      curStroke = { id: uuid(), tool: 'pen', color: curColor, width: curWidth, points: [p], startTime: 0, endTime: 0, visible: true };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !curStroke) return;
      const p = getRel(e);
      const last = curStroke.points[curStroke.points.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.002 && Math.abs(last.y - p.y) < 0.002) return;
      curStroke.points.push(p);
      redrawAll();
      drawStroke(curStroke);
    });
    const up = () => {
      if (!drawing) return;
      drawing = false;
      if (curStroke && curStroke.points.length) {
        strokes.push(curStroke);
        undoStack.push(curStroke.id);
      }
      curStroke = null;
      redrawAll();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);

    overlay.querySelectorAll('.ne-swatch').forEach(el => {
      el.addEventListener('click', () => {
        curColor = el.dataset.color;
        overlay.querySelectorAll('.ne-swatch').forEach(x => { x.style.border = '2px solid transparent'; x.style.boxShadow = 'none'; });
        el.style.border = '2px solid white';
        el.style.boxShadow = '0 0 0 2px var(--accent-cyan)';
      });
    });
    overlay.querySelectorAll('.ne-width').forEach(el => {
      el.addEventListener('click', () => {
        curWidth = parseInt(el.dataset.width, 10);
        overlay.querySelectorAll('.ne-width > div').forEach((x, i) => {
          x.style.background = i === [...overlay.querySelectorAll('.ne-width')].indexOf(el) ? 'var(--accent-cyan)' : 'var(--text-secondary)';
        });
      });
    });

    overlay.querySelector('[data-action="undo"]').addEventListener('click', () => {
      if (strokes.length) {
        strokes.pop();
        redrawAll();
      }
    });
    overlay.querySelector('[data-action="clear"]').addEventListener('click', () => {
      if (strokes.length && confirm('清空画布？')) { strokes = []; redrawAll(); }
    });

    const close = () => { window.removeEventListener('resize', resize); overlay.remove(); };
    overlay.querySelector('[data-action="close"]').addEventListener('click', () => { close(); onDone(null); });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => { close(); onDone(null); });
    overlay.querySelector('[data-action="save"]').addEventListener('click', () => {
      const text = overlay.querySelector('[data-field="text"]').value;
      close();
      onDone({ text, strokes, thumbnail: initialThumb, thumbMeta: initialMeta });
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onDone(null); } });

    loadThumb().then(() => {
      requestAnimationFrame(resize);
      window.addEventListener('resize', resize);
    });
  }

  _renderNotePreview(note, canvasEl) {
    if (!note || !canvasEl) return;
    if (!note.thumbnail && !note.strokes?.length) return;
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width, H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);

    const vw = note.thumbMeta?.vw || 16, vh = note.thumbMeta?.vh || 9;
    const r = Math.min(W / vw, H / vh);
    const dw = vw * r, dh = vh * r;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;

    const drawStrokes = () => {
      for (const s of (note.strokes || [])) {
        if (!s.points?.length) continue;
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.width * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const toPx = (p) => ({ x: p.x * vw * r + dx, y: p.y * vh * r + dy });
        const pts = s.points.map(toPx);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.restore();
      }
    };

    if (note.thumbnail) {
      if (!this._noteThumbCache) this._noteThumbCache = new Map();
      let img = this._noteThumbCache.get(note.thumbnail.slice(0, 80));
      const drawImg = () => {
        if (img) {
          try {
            ctx.drawImage(img, dx, dy, dw, dh);
          } catch (e) {}
        }
        drawStrokes();
      };
      if (img) { drawImg(); return; }
      img = new Image();
      img.onload = () => { this._noteThumbCache.set(note.thumbnail.slice(0, 80), img); drawImg(); };
      img.src = note.thumbnail;
      return;
    }
    drawStrokes();
  }

  async _saveNewProject(videoBlob, duration) {
    const blobId = uuid();
    await saveBlob(blobId, videoBlob);
    const v = $('videoPreview');
    const project = {
      id: uuid(),
      title: `录制 ${formatDate(Date.now())}`,
      createdAt: Date.now(),
      duration,
      videoBlobId: blobId,
      videoSize: { width: v.videoWidth || 1280, height: v.videoHeight || 720 },
      strokes: this.drawEngine.exportStrokes(),
      bookmarks: this.timeline.bookmarks,
      clipStart: 0,
      clipEnd: duration,
      settings: { fps: 30, includeAudio: false, cursorHighlight: true },
      size: videoBlob.size,
    };
    await saveProject(project);
    return project;
  }

  async _loadMediaList() {
    try {
      const list = await listProjects();
      this._mediaList = list.map(p => ({
        id: p.id,
        title: p.title,
        duration: p.duration,
        createdAt: p.createdAt,
        size: p.size || 0,
      }));
      this.sidePanel.setState({ media: this._mediaList });
    } catch (e) {
      console.error(e);
      this._mediaList = [];
    }
  }

  async _actionLoadProject(id) {
    const modal = this._openProgressModal('正在加载项目...');
    try {
      const p = await getProject(id);
      if (!p) throw new Error('项目不存在');
      const blob = await getBlob(p.videoBlobId);
      if (!blob) throw new Error('视频数据丢失');
      const url = URL.createObjectURL(blob);
      const v = $('videoPreview');
      v.srcObject = null;
      v.src = url;
      await new Promise((res) => { v.onloadedmetadata = res; setTimeout(res, 3000); });
      this.state.hasVideo = true;
      const dur = isFinite(v.duration) ? v.duration * 1000 : p.duration;
      this.timeline.setDuration(dur);
      this.timeline.loadBookmarks(p.bookmarks || []);
      this.drawEngine.loadStrokes(p.strokes || []);
      if (p.clipStart !== undefined && p.clipEnd !== undefined) {
        this.timeline.setClipStart(p.clipStart);
        this.timeline.setClipEnd(p.clipEnd || dur);
      }
      $('placeholder').classList.add('hidden');
      this.state.currentProjectId = p.id;
      modal.close();
      this._syncAllUI();
      this.toast(`项目已加载：${p.title}`, 'success', 3000);
    } catch (e) {
      console.error(e);
      modal.close();
      this.toast('加载失败：' + e.message, 'error');
    }
  }

  async _actionDownloadProject(id) {
    try {
      const p = await getProject(id);
      if (!p) throw new Error('项目不存在');
      const blob = await getBlob(p.videoBlobId);
      if (!blob) throw new Error('视频数据丢失');
      const filename = `${p.title || 'recording'}_${formatDate(p.createdAt).replace(/[:\- ]/g,'')}.webm`;
      downloadBlob(blob, filename);
      this.toast('开始下载视频...', 'success');
    } catch (e) {
      console.error(e);
      this.toast('下载失败：' + e.message, 'error');
    }
  }

  async _actionDeleteProject(id) {
    try {
      await deleteProject(id);
      await this._loadMediaList();
      if (this.state.currentProjectId === id) this.state.currentProjectId = null;
      this.toast('项目已删除', 'success');
    } catch (e) {
      console.error(e);
      this.toast('删除失败：' + e.message, 'error');
    }
  }

  toast(message, type = 'info', duration = 2500) {
    const container = $('toastContainer');
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || '📌'}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 400);
    }, duration);
  }

  _openProgressModal(title) {
    const root = $('modalRoot');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="width:min(480px,92vw)">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
        </div>
        <div class="modal-body">
          <div style="height:8px;border-radius:999px;background:rgba(148,163,184,0.1);overflow:hidden;margin-bottom:14px">
            <div id="progressBar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent-cyan),var(--accent-purple));transition:width 0.2s var(--ease-smooth)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div id="progressText" style="font-size:13px;color:var(--text-secondary)">准备中...</div>
            <div id="progressPct" style="font-family:var(--font-mono);font-weight:600;color:var(--accent-cyan)">0%</div>
          </div>
        </div>
      </div>
    `;
    root.appendChild(overlay);
    const bar = overlay.querySelector('#progressBar');
    const text = overlay.querySelector('#progressText');
    const pct = overlay.querySelector('#progressPct');
    return {
      update: (p, msg) => {
        p = clamp(p, 0, 100);
        if (bar) bar.style.width = p + '%';
        if (pct) pct.textContent = Math.floor(p) + '%';
        if (text && msg) text.textContent = msg;
      },
      close: () => { overlay.remove(); },
    };
  }

  _openSettingsModal() {
    const root = $('modalRoot');
    const shortcuts = this.shortcuts.getAllBindings();
    const settings = loadSettings({ cursorHighlight: true, fps: 30 });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">⚙️ 设置</div>
          <button class="modal-close" id="modalClose">✕</button>
        </div>
        <div class="modal-body">
          <div class="panel-section">
            <div class="panel-title">录制参数</div>
            <div class="form-row-inline">
              <input type="checkbox" id="setCursor" ${settings.cursorHighlight ? 'checked' : ''}>
              <label for="setCursor">录制时显示光标高亮圆环</label>
            </div>
          </div>
          <div class="panel-section">
            <div class="panel-title">快捷键</div>
            <div>
              ${shortcuts.slice(0, 16).map(s => `
                <div class="shortcut-row">
                  <span class="sc-desc">${s.description}</span>
                  <div class="sc-keys">
                    ${(Array.isArray(s.keys) ? s.keys : [s.keys]).map(k => `<span class="kbd-badge">${k}</span>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="panel-section">
            <div class="panel-title">关于</div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.7">
              <p><strong style="color:var(--text-secondary)">ScreenStudio</strong> · 纯前端屏幕录制与涂鸦协作工具</p>
              <p style="margin-top:6px">功能亮点：屏幕录制 / 实时涂鸦 / 时间轴书签 / 帧级裁剪 / 帧序列导出 / 多标签页直播 / 笔记导出</p>
              <p style="margin-top:6px">技术栈：MediaRecorder · Canvas 2D · BroadcastChannel · IndexedDB · 零框架依赖</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--primary" id="saveSettings">保存并关闭</button>
        </div>
      </div>
    `;
    root.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#modalClose').addEventListener('click', close);
    overlay.querySelector('#saveSettings').addEventListener('click', () => {
      const cursorOn = overlay.querySelector('#setCursor').checked;
      saveSettings({ ...settings, cursorHighlight: cursorOn });
      $('cursorHighlight').style.display = cursorOn ? '' : 'none';
      close();
      this.toast('设置已保存', 'success');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
