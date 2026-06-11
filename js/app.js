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
        self.sidePanel.setState({ roomCode: code, role: self.streamSync.role, viewers: self.streamSync.getViewerList() });
        self.toast(`直播房间已创建: ${code}`, 'success');
        self._syncSidePanel();
      },
      joinRoom: (code) => {
        const ok = self.streamSync.joinRoom(code);
        if (ok) {
          self.sidePanel.setState({ roomCode: code, role: self.streamSync.role, viewers: self.streamSync.getViewerList() });
          self._syncSidePanel();
        }
      },
      leaveRoom: () => {
        self.streamSync.leaveRoom();
        self.sidePanel.setState({ roomCode: null, role: null, viewers: [] });
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
    bus.on('stream:frameReceived', ({ url }) => {
      const v = $('videoPreview');
      const img = new Image();
      img.onload = () => {
        const cvs = $('drawCanvas').parentElement.querySelector('.video-preview');
        const off = document.createElement('canvas');
        off.width = img.width; off.height = img.height;
        off.getContext('2d').drawImage(img, 0, 0);
        const u2 = off.toDataURL('image/png');
        if (!v.src.startsWith('blob:') || !this.state.hasVideo) {
          v.poster = u2;
        }
      };
      img.src = url;
    });
    bus.on('stream:strokeReceived', ({ stroke }) => {
      if (!stroke) return;
      this.drawEngine.addExternalStroke(stroke);
      if (this.state.strokesVisible) this.drawEngine.renderStrokesForTime(this.timeline.currentTime);
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
      const url = URL.createObjectURL(file);
      const v = $('videoPreview');
      v.srcObject = null;
      v.src = url;
      await new Promise((resolve, reject) => {
        v.onloadedmetadata = resolve;
        v.onerror = () => reject(new Error('视频加载失败'));
        setTimeout(resolve, 10000);
      });
      this.state.hasVideo = true;
      const dur = isFinite(v.duration) ? v.duration * 1000 : 0;
      this.timeline.setDuration(dur);
      this.timeline.resetClip();
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
        strokes: this.drawEngine.exportStrokes(),
        bookmarks: this.timeline.bookmarks,
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
    const text = prompt('笔记内容（可留空，之后在画布上涂画）：', '');
    if (text === null) return;
    const note = {
      id: uuid(),
      time,
      text: text || '',
      strokes: [],
      createdAt: Date.now(),
    };
    this.viewerNotes.push(note);
    this.viewerNotes.sort((a, b) => a.time - b.time);
    this._persistViewerNotes();
    this.sidePanel.setState({ notes: this.viewerNotes });
    this.toast(`笔记已添加 @ ${formatTime(time)}`, 'success');
  }

  _renderNotePreview(note, canvasEl) {
    if (!note?.strokes?.length) return;
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width, H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);
    for (const s of note.strokes) {
      if (!s.points?.length) continue;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * 0.5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = s.points.map(p => ({ x: p.x * W, y: p.y * H }));
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
