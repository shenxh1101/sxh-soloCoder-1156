import { bus } from './EventBus.js';

const RECORD_STATUS = { IDLE: 'idle', RECORDING: 'recording', PAUSED: 'paused' };

export class Recorder {
  constructor() {
    this.status = RECORD_STATUS.IDLE;
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.startTime = 0;
    this.pausedAt = 0;
    this.totalPaused = 0;
    this.lastPauseStart = 0;
    this.rafId = null;
    this.videoElement = null;
    this.audioEnabled = false;
    this.cursorEnabled = true;
    this.fps = 30;
  }

  get isIdle() { return this.status === RECORD_STATUS.IDLE; }
  get isRecording() { return this.status === RECORD_STATUS.RECORDING; }
  get isPaused() { return this.status === RECORD_STATUS.PAUSED; }

  get currentTime() {
    if (this.isIdle) return 0;
    const now = performance.now();
    const elapsed = (this.isPaused ? this.lastPauseStart : now) - this.startTime - this.totalPaused;
    return Math.max(0, elapsed);
  }

  async start(options = {}) {
    if (!this.isIdle) throw new Error('录制器忙');
    this.audioEnabled = options.audio ?? false;
    this.cursorEnabled = options.cursor ?? true;
    this.fps = options.fps || 30;

    const displayOpts = {
      video: {
        cursor: this.cursorEnabled ? 'always' : 'motion',
        displaySurface: options.displaySurface || 'browser',
      },
    };
    if (this.audioEnabled) displayOpts.audio = true;

    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia(displayOpts);
    } catch (err) {
      if (err.name !== 'NotAllowedError') console.error(err);
      bus.emit('recorder:error', { message: '用户取消或权限不足', error: err });
      return false;
    }

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) {
      bus.emit('recorder:error', { message: '未获取到视频流' });
      return false;
    }
    videoTrack.addEventListener('ended', () => this.stop(true));

    try {
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';
      const recOpts = mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 };
      this.mediaRecorder = new MediaRecorder(this.stream, recOpts);
    } catch (e) {
      bus.emit('recorder:error', { message: 'MediaRecorder 初始化失败', error: e });
      this._cleanupStream();
      return false;
    }

    this.chunks = [];
    this.totalPaused = 0;
    this.mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    this.mediaRecorder.onstop = () => this._onRecorderStop();
    this.mediaRecorder.onerror = (e) => { bus.emit('recorder:error', { message: '录制错误', error: e }); };

    this.mediaRecorder.start(1000);
    this.startTime = performance.now();
    this.status = RECORD_STATUS.RECORDING;

    bus.emit('recorder:started', { time: this.startTime });
    this._startTicker();
    return true;
  }

  pause() {
    if (!this.isRecording) return;
    this.lastPauseStart = performance.now();
    try { this.mediaRecorder.pause(); } catch {}
    this.status = RECORD_STATUS.PAUSED;
    this._stopTicker();
    bus.emit('recorder:paused', { time: this.currentTime });
  }

  resume() {
    if (!this.isPaused) return;
    this.totalPaused += performance.now() - this.lastPauseStart;
    try { this.mediaRecorder.resume(); } catch {}
    this.status = RECORD_STATUS.RECORDING;
    this._startTicker();
    bus.emit('recorder:resumed', { time: this.currentTime });
  }

  togglePause() {
    if (this.isRecording) this.pause();
    else if (this.isPaused) this.resume();
  }

  stop(userInitiated = false) {
    if (this.isIdle) return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    } catch {}
    if (userInitiated) this._cleanupStream();
  }

  _onRecorderStop() {
    this._stopTicker();
    if (this.isPaused) this.totalPaused += performance.now() - this.lastPauseStart;
    const endTime = this.currentTime;

    let videoBlob = null;
    if (this.chunks.length) videoBlob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'video/webm' });

    this._cleanupStream();
    const prevStatus = this.status;
    this.status = RECORD_STATUS.IDLE;
    bus.emit('recorder:stopped', {
      videoBlob,
      duration: endTime,
      wasPaused: prevStatus === RECORD_STATUS.PAUSED,
    });
  }

  _cleanupStream() {
    if (this.stream) {
      try { this.stream.getTracks().forEach(t => t.stop()); } catch {}
      this.stream = null;
    }
    this.mediaRecorder = null;
  }

  _startTicker() {
    const tick = () => {
      if (this.isRecording) {
        bus.emit('recorder:tick', { time: this.currentTime });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  _stopTicker() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  attachVideo(el) {
    this.videoElement = el;
    if (this.stream && el) el.srcObject = this.stream;
    bus.on('recorder:started', () => { if (this.videoElement && this.stream) this.videoElement.srcObject = this.stream; });
  }
}

export { RECORD_STATUS };
