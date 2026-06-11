import { bus } from './EventBus.js';
import { uuid, hexToRgba, clamp } from '../utils/format.js';

export const TOOLS = {
  NONE: 'none',
  PEN: 'pen',
  ARROW: 'arrow',
  RECT: 'rect',
  HIGHLIGHT: 'highlight',
  ERASER: 'eraser',
};

export const DEFAULT_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#22D3EE', '#A855F7', '#FFFFFF'];

export class DrawEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.bufferCanvas = document.createElement('canvas');
    this.bufferCtx = this.bufferCanvas.getContext('2d');
    this.width = 0;
    this.height = 0;

    this.tool = TOOLS.PEN;
    this.color = DEFAULT_COLORS[0];
    this.width_ = 4;
    this.enabled = true;

    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.currentStroke = null;
    this.isDrawing = false;
    this.startDrawTime = 0;
    this.getTime = () => performance.now();

    this.pointerId = null;
    this._boundEvents = {};
  }

  setStrokeTimeProvider(fn) { this.getTime = fn; }

  get penWidth() { return this.width_; }
  set penWidth(v) { this.width_ = clamp(v, 1, 40); bus.emit('draw:widthChanged', this.width_); }

  setTool(t) {
    this.tool = t;
    bus.emit('draw:toolChanged', t);
    if (this.canvas) {
      const map = {
        [TOOLS.PEN]: 'crosshair', [TOOLS.ARROW]: 'crosshair', [TOOLS.RECT]: 'crosshair',
        [TOOLS.HIGHLIGHT]: 'cell', [TOOLS.ERASER]: 'cell',
      };
      this.canvas.style.cursor = map[t] || 'default';
    }
  }

  setColor(c) { this.color = c; bus.emit('draw:colorChanged', c); }

  setEnabled(v) {
    this.enabled = v;
    if (this.canvas) {
      this.canvas.style.pointerEvents = v ? 'auto' : 'none';
      this.canvas.parentElement?.classList.toggle('drawing', v);
    }
    bus.emit('draw:enabledChanged', v);
  }

  attachCanvas(drawCanvas, overlayCanvas) {
    this.canvas = drawCanvas;
    this.overlayCanvas = overlayCanvas;
    this.ctx = drawCanvas.getContext('2d');
    this.overlayCtx = overlayCanvas?.getContext('2d') || null;
    this._bindEvents();
    this.resize();
  }

  resize(w, h) {
    const parent = this.canvas?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const W = w || Math.floor(rect.width);
    const H = h || Math.floor(rect.height);
    if (W === 0 || H === 0) return;
    [this.canvas, this.overlayCanvas, this.bufferCanvas].forEach(c => {
      if (!c) return;
      c.width = W; c.height = H;
    });
    this.width = W; this.height = H;
    this.redrawAll();
  }

  _bindEvents() {
    if (!this.canvas) return;
    const start = (e) => this._onPointerDown(e);
    const move = (e) => this._onPointerMove(e);
    const up = (e) => this._onPointerUp(e);
    const cancel = (e) => this._onPointerUp(e);
    this.canvas.addEventListener('pointerdown', start);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', cancel);
    this.canvas.addEventListener('pointerleave', up);
    this._boundEvents = { start, move, up, cancel };
  }

  _getRelPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    return { x, y };
  }

  _onPointerDown(e) {
    if (!this.enabled || this.tool === TOOLS.NONE) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointerId = e.pointerId;
    this.isDrawing = true;
    this.startDrawTime = performance.now();

    const p = this._getRelPoint(e);
    const ts = this.getTime();
    this.currentStroke = {
      id: uuid(),
      tool: this.tool,
      color: this.color,
      width: this.width_,
      points: [{ ...p, timestamp: ts, pressure: e.pressure || 1 }],
      startTime: ts,
      endTime: ts,
      visible: true,
    };
  }

  _onPointerMove(e) {
    if (!this.isDrawing || !this.currentStroke) return;
    const p = this._getRelPoint(e);
    const ts = this.getTime();
    const pts = this.currentStroke.points;
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.001 && Math.abs(last.y - p.y) < 0.001) return;
    pts.push({ ...p, timestamp: ts, pressure: e.pressure || 1 });
    this.currentStroke.endTime = ts;
    this._renderLiveStroke();
  }

  _onPointerUp(e) {
    if (!this.isDrawing || !this.currentStroke) return;
    if (this.canvas.hasPointerCapture?.(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
    this.isDrawing = false;

    const stroke = this.currentStroke;
    stroke.endTime = this.getTime();

    if (stroke.points.length >= 1) {
      this.strokes.push(stroke);
      this.undoStack.push({ type: 'add', strokeId: stroke.id });
      this.redoStack.length = 0;
      bus.emit('draw:strokeAdded', stroke);
    }
    this.currentStroke = null;
    this.redrawAll();
  }

  _renderLiveStroke() {
    if (!this.overlayCtx || !this.currentStroke) return;
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
    this._drawStroke(this.overlayCtx, this.currentStroke, true);
  }

  _drawStroke(ctx, stroke, isLive = false) {
    if (!stroke || !stroke.visible || stroke.points.length === 0) return;
    const W = this.width, H = this.height;
    const toPx = (p) => ({ x: p.x * W, y: p.y * H });
    const pts = stroke.points.map(toPx);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === TOOLS.HIGHLIGHT) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = hexToRgba(stroke.color, 0.4);
      ctx.lineWidth = stroke.width * 4;
    } else if (stroke.tool === TOOLS.ERASER) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = stroke.width * 3;
    } else {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
    }

    if (stroke.tool === TOOLS.PEN || stroke.tool === TOOLS.HIGHLIGHT || stroke.tool === TOOLS.ERASER) {
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    } else if (stroke.tool === TOOLS.RECT) {
      const a = pts[0], b = pts[pts.length - 1];
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.lineWidth = stroke.width;
      ctx.strokeRect(x, y, w, h);
    } else if (stroke.tool === TOOLS.ARROW) {
      const a = pts[0], b = pts[pts.length - 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = Math.min(20, stroke.width * 5 + 10);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = stroke.width;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
    ctx.restore();
  }

  redrawAll() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.overlayCtx?.clearRect(0, 0, this.width, this.height);
    for (const s of this.strokes) this._drawStroke(this.ctx, s);
    bus.emit('draw:redrawn');
  }

  renderStrokesForTime(timeMs) {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.overlayCtx?.clearRect(0, 0, this.width, this.height);
    for (const s of this.strokes) {
      if (s.visible !== false && s.startTime <= timeMs) {
        this._drawStroke(this.ctx, s);
      }
    }
  }

  undo() {
    const act = this.undoStack.pop();
    if (!act) return;
    if (act.type === 'add') {
      const idx = this.strokes.findIndex(s => s.id === act.strokeId);
      if (idx >= 0) {
        const [removed] = this.strokes.splice(idx, 1);
        this.redoStack.push({ type: 'add', stroke: removed });
      }
    }
    this.redrawAll();
    bus.emit('draw:undo', { remaining: this.undoStack.length });
  }

  redo() {
    const act = this.redoStack.pop();
    if (!act) return;
    if (act.type === 'add') {
      this.strokes.push(act.stroke);
      this.undoStack.push({ type: 'add', strokeId: act.stroke.id });
    }
    this.redrawAll();
    bus.emit('draw:redo', { remaining: this.redoStack.length });
  }

  clearAll() {
    if (this.strokes.length) {
      const copy = [...this.strokes];
      this.undoStack.push({ type: 'bulkClear', prev: copy });
      this.redoStack.length = 0;
      this.strokes = [];
      this.redrawAll();
      bus.emit('draw:cleared');
    }
  }

  loadStrokes(strokes) {
    this.strokes = strokes || [];
    this.undoStack = []; this.redoStack = [];
    this.redrawAll();
  }

  exportStrokes() { return JSON.parse(JSON.stringify(this.strokes)); }

  addExternalStroke(stroke) {
    this.strokes.push(stroke);
    this.redrawAll();
  }

  toDataURL() {
    const out = document.createElement('canvas');
    out.width = this.width; out.height = this.height;
    const octx = out.getContext('2d');
    octx.drawImage(this.canvas, 0, 0);
    if (this.overlayCanvas) octx.drawImage(this.overlayCanvas, 0, 0);
    return out.toDataURL('image/png');
  }
}
