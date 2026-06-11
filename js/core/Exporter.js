import { bus } from './EventBus.js';
import { formatTime, downloadBlob, uuid } from '../utils/format.js';

export class Exporter {
  constructor() {
    this.videoElement = null;
    this.drawEngine = null;
    this.timeline = null;
    this.fps = 30;
  }

  configure({ videoElement, drawEngine, timeline, fps }) {
    if (videoElement) this.videoElement = videoElement;
    if (drawEngine) this.drawEngine = drawEngine;
    if (timeline) this.timeline = timeline;
    if (fps) this.fps = fps;
  }

  async exportVideo(options = {}) {
    const {
      burnStrokes = true,
      useClipRange = true,
      quality = 'high',
      onProgress,
    } = options;

    if (!this.videoElement || !this.timeline) throw new Error('未准备好导出');

    const startTime = useClipRange ? this.timeline.clipStart : 0;
    const endTime = useClipRange ? (this.timeline.clipEnd || this.timeline.duration) : this.timeline.duration;
    const duration = endTime - startTime;
    if (duration <= 0) throw new Error('导出区间无效');

    onProgress?.(0, '正在准备导出画布...');

    const origWidth = this.videoElement.videoWidth || 1280;
    const origHeight = this.videoElement.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = origWidth;
    canvas.height = origHeight;
    const ctx = canvas.getContext('2d');

    const drawCanvas = this.drawEngine?.canvas;
    const strokesScaleX = origWidth / (drawCanvas?.width || 1);
    const strokesScaleY = origHeight / (drawCanvas?.height || 1);

    const stream = canvas.captureStream(this.fps);
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    const bitrates = { high: 8_000_000, medium: 4_000_000, low: 2_000_000 };
    const rec = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrates[quality] || bitrates.medium,
    });

    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    return new Promise(async (resolve, reject) => {
      const originalTime = this.videoElement.currentTime || 0;
      const wasPaused = this.videoElement.paused;
      let finished = false;
      const cleanup = (restore) => {
        if (finished) return;
        finished = true;
        try { rec.stop(); } catch {}
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        if (restore) {
          try {
            this.videoElement.pause();
            this.videoElement.currentTime = Math.min(originalTime, (this.videoElement.duration || 1) - 0.01);
            if (!wasPaused) this.videoElement.play().catch(() => {});
          } catch (e) {}
        }
      };

      rec.onstop = async () => {
        try {
          onProgress?.(95, '正在生成文件...');
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          const filename = `ScreenStudio_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.webm`;
          cleanup(true);
          onProgress?.(100, '导出完成');
          if (options.download !== false) downloadBlob(blob, filename);
          resolve({ blob, filename, size: blob.size, duration });
        } catch (e) { cleanup(true); reject(e); }
      };
      rec.onerror = (e) => { cleanup(true); reject(e); };

      try {
        this.videoElement.pause();
        rec.start(Math.max(50, Math.floor(500 / this.fps)));
      } catch (e) { cleanup(false); reject(e); return; }

      const doSeek = (timeMs) => new Promise(resolve => {
        const targetSec = Math.max(0, Math.min(timeMs / 1000, (this.videoElement.duration || 1) - 0.02));
        let done = false;
        const handler = () => { if (!done) { done = true; this.videoElement.removeEventListener('seeked', handler); resolve(); } };
        const to = setTimeout(() => { if (!done) { done = true; this.videoElement.removeEventListener('seeked', handler); resolve(); } }, 1200);
        this.videoElement.addEventListener('seeked', handler);
        try { this.videoElement.currentTime = targetSec; }
        catch (e) { clearTimeout(to); handler(); }
      });

      const drawFrame = (curTimeMs) => {
        ctx.drawImage(this.videoElement, 0, 0, origWidth, origHeight);
        if (burnStrokes && this.drawEngine?.strokes) {
          ctx.save();
          for (const s of this.drawEngine.strokes) {
            if (s.visible === false || s.startTime > curTimeMs) continue;
            renderStrokeToContext(ctx, s, origWidth, origHeight, strokesScaleX, strokesScaleY);
          }
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 1, 1);
      };

      try {
        await doSeek(startTime);
        drawFrame(startTime);

        const frameMs = 1000 / this.fps;
        const totalFrames = Math.max(1, Math.round(duration / frameMs));
        let lastPct = 0;
        const perFrameWait = Math.max(16, Math.round(1000 / this.fps));

        for (let f = 1; f < totalFrames - 1; f++) {
          const cur = Math.min(endTime - 2, startTime + f * frameMs);
          await doSeek(cur);
          drawFrame(cur);

          const pct = Math.floor((f / totalFrames) * 88) + 2;
          if (pct - lastPct >= 2) {
            lastPct = pct;
            onProgress?.(pct, `正在处理第 ${f}/${totalFrames} 帧 (${formatTime(cur, true)})`);
          }
          await new Promise(r => setTimeout(r, perFrameWait));
        }

        if (totalFrames > 1) {
          await doSeek(endTime);
          drawFrame(endTime);
        }
        onProgress?.(92, `正在处理最后一帧 (${formatTime(endTime, true)})`);

        for (let i = 0; i < this.fps; i++) {
          drawFrame(endTime);
          await new Promise(r => setTimeout(r, perFrameWait));
        }

        try { rec.requestData(); } catch {}
        await new Promise(r => setTimeout(r, 400));
        try { rec.stop(); } catch (e) { cleanup(true); reject(e); }
      } catch (e) {
        cleanup(true);
        reject(e);
      }
    });
  }

  async exportFrames(options = {}) {
    const {
      intervalMs = 1000,
      useClipRange = true,
      maxFrames = 200,
      burnStrokes = true,
      format = 'png',
      onProgress,
    } = options;

    if (!this.videoElement || !this.timeline) throw new Error('未准备好导出');

    const startTime = useClipRange ? this.timeline.clipStart : 0;
    const endTime = useClipRange ? (this.timeline.clipEnd || this.timeline.duration) : this.timeline.duration;
    const totalFrames = Math.min(maxFrames, Math.ceil((endTime - startTime) / intervalMs) + 1);

    const origWidth = this.videoElement.videoWidth || 1280;
    const origHeight = this.videoElement.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = origWidth;
    canvas.height = origHeight;
    const ctx = canvas.getContext('2d');

    const drawCanvas = this.drawEngine?.canvas;
    const sx = origWidth / (drawCanvas?.width || 1);
    const sy = origHeight / (drawCanvas?.height || 1);

    const blobs = [];
    const originalTime = this.videoElement.currentTime || 0;
    const wasPaused = this.videoElement.paused;
    const restore = () => {
      try {
        this.videoElement.pause();
        this.videoElement.currentTime = Math.min(originalTime, (this.videoElement.duration || 1) - 0.01);
        if (!wasPaused) this.videoElement.play().catch(() => {});
      } catch (e) {}
    };
    this.videoElement.pause();

    const doSeek = (t) => new Promise(resolve => {
      const h = () => { this.videoElement.removeEventListener('seeked', h); resolve(); };
      const to = setTimeout(() => { this.videoElement.removeEventListener('seeked', h); resolve(); }, 800);
      this.videoElement.addEventListener('seeked', h);
      try { this.videoElement.currentTime = Math.max(0, Math.min(t / 1000, (this.videoElement.duration || 1) - 0.02)); }
      catch { clearTimeout(to); h(); }
    });

    try {
      for (let i = 0; i < totalFrames; i++) {
        const t = startTime + i * intervalMs;
        await doSeek(t);
        ctx.drawImage(this.videoElement, 0, 0);
        if (burnStrokes && this.drawEngine?.strokes) {
          ctx.save();
          for (const s of this.drawEngine.strokes) {
            if (s.visible === false || s.startTime > t) continue;
            renderStrokeToContext(ctx, s, origWidth, origHeight, sx, sy);
          }
          ctx.restore();
        }
        const blob = await new Promise(res => canvas.toBlob(res, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92));
        blobs.push({ blob, index: i, time: t });
        onProgress?.(Math.floor((i + 1) / totalFrames * 100), `正在导出第 ${i + 1}/${totalFrames} 帧`);
        await new Promise(r => setTimeout(r, 0));
      }

      restore();

      const filenameBase = `ScreenStudio_Frames_${new Date().toISOString().slice(0,10)}`;
      for (const item of blobs) {
        const padIdx = String(item.index).padStart(String(totalFrames).length, '0');
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        downloadBlob(item.blob, `${filenameBase}_${padIdx}_t${Math.floor(item.time)}ms.${ext}`);
      }
      onProgress?.(100, `已导出 ${blobs.length} 张图片`);
      return { frames: blobs, count: blobs.length };
    } catch (e) {
      restore();
      throw e;
    }
  }

  exportStrokesJSON() {
    if (!this.drawEngine) return;
    const data = {
      version: 1,
      exportedAt: Date.now(),
      fps: this.fps,
      duration: this.timeline?.duration || 0,
      strokes: this.drawEngine.exportStrokes(),
      bookmarks: this.timeline?.bookmarks || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `ScreenStudio_Annotations_${Date.now()}.json`);
    return data;
  }

  async importStrokesJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.strokes)) throw new Error('标注文件格式不正确');
    return data;
  }

  exportNotesJSON(notes, meta = {}) {
    const data = {
      version: 1,
      exportedAt: Date.now(),
      type: 'viewer_notes',
      ...meta,
      notes,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `ScreenStudio_Notes_${Date.now()}.json`);
    return data;
  }
}

function renderStrokeToContext(ctx, stroke, W, H, scaleX = 1, scaleY = 1) {
  const pts = stroke.points.map(p => ({ x: p.x * W, y: p.y * H }));
  if (pts.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const effectiveW = stroke.width * Math.max(scaleX, scaleY);
  if (stroke.tool === 'highlight') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = stroke.color.startsWith('rgba') ? stroke.color : hexToRgba(stroke.color, 0.4);
    ctx.lineWidth = effectiveW * 4;
  } else if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = effectiveW * 3;
  } else {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = effectiveW;
  }

  if (stroke.tool === 'pen' || stroke.tool === 'highlight' || stroke.tool === 'eraser') {
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    } else {
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
    }
  } else if (stroke.tool === 'rect') {
    const a = pts[0], b = pts[pts.length - 1];
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.lineWidth = effectiveW;
    ctx.strokeRect(x, y, w, h);
  } else if (stroke.tool === 'arrow') {
    const a = pts[0], b = pts[pts.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = Math.min(24, effectiveW * 5 + 12);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = effectiveW;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(ang - Math.PI / 6), b.y - headLen * Math.sin(ang - Math.PI / 6));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(ang + Math.PI / 6), b.y - headLen * Math.sin(ang + Math.PI / 6));
    ctx.lineWidth = effectiveW;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }
  ctx.restore();
}

function hexToRgba(hex, alpha = 1) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
