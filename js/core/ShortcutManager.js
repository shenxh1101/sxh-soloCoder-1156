export class ShortcutManager {
  constructor() {
    this.bindings = [];
    this.disabledScopes = new Set();
    this.pressedKeys = new Set();
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  register(config) {
    const {
      id,
      keys,
      handler,
      scope = 'global',
      description = '',
      preventDefault = true,
      stopPropagation = false,
      when = null,
    } = config;
    const normalized = this._normalizeKeys(keys);
    const binding = { id, keys: normalized, originalKeys: keys, handler, scope, description, preventDefault, stopPropagation, when };
    this.bindings.push(binding);
    return () => this.unregister(id);
  }

  unregister(id) {
    this.bindings = this.bindings.filter(b => b.id !== id);
  }

  setScopeEnabled(scope, enabled) {
    if (enabled) this.disabledScopes.delete(scope);
    else this.disabledScopes.add(scope);
  }

  getBindingsForScope(scope) {
    return this.bindings.filter(b => b.scope === scope);
  }

  getAllBindings() {
    return this.bindings.map(b => ({
      id: b.id,
      keys: b.originalKeys,
      scope: b.scope,
      description: b.description,
    }));
  }

  _normalizeKeys(keys) {
    if (Array.isArray(keys)) {
      return keys.map(k => this._normalizeKeyCombo(k));
    }
    return [this._normalizeKeyCombo(keys)];
  }

  _normalizeKeyCombo(combo) {
    const parts = combo.split('+').map(p => p.trim().toLowerCase());
    const result = { ctrl: false, meta: false, shift: false, alt: false, key: '' };
    for (const p of parts) {
      switch (p) {
        case 'ctrl': case 'control': result.ctrl = true; break;
        case 'cmd': case 'command': case 'meta': case '⌘': result.meta = true; break;
        case 'shift': case '⇧': result.shift = true; break;
        case 'alt': case 'option': case '⌥': result.alt = true; break;
        default: result.key = p;
      }
    }
    return result;
  }

  _eventToCombo(e) {
    return {
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey,
      key: e.key.toLowerCase(),
    };
  }

  _matches(combo, pattern) {
    return (
      (pattern.ctrl === combo.ctrl) &&
      (pattern.meta === combo.meta) &&
      (pattern.shift === combo.shift) &&
      (pattern.alt === combo.alt) &&
      pattern.key === combo.key
    );
  }

  _isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return !el.readOnly;
    return el.isContentEditable;
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    const target = e.target;
    const combo = this._eventToCombo(e);
    this.pressedKeys.add(combo.key);

    const inEditable = this._isEditable(target);

    for (const b of this.bindings) {
      if (this.disabledScopes.has(b.scope)) continue;
      if (inEditable && !b.id.endsWith(':editable') && !['backspace', 'delete', 'enter', 'escape'].includes(combo.key)) continue;
      if (b.when && !b.when()) continue;
      for (const pattern of b.keys) {
        if (this._matches(combo, pattern)) {
          if (b.preventDefault) e.preventDefault();
          if (b.stopPropagation) e.stopPropagation();
          try { b.handler(e); } catch (err) { console.error('[Shortcut] handler error', err); }
          return;
        }
      }
    }
  }

  _onKeyUp(e) {
    const combo = this._eventToCombo(e);
    this.pressedKeys.delete(combo.key);
  }
}

export function defaultShortcutBindings(ctx) {
  return [
    { id: 'record:toggle', keys: ['Ctrl+R', 'Cmd+R'], scope: 'global', description: '开始/停止录制', handler: () => ctx.actions.toggleRecord() },
    { id: 'record:pause', keys: ['Ctrl+P', 'Cmd+P'], scope: 'recording', description: '暂停/继续录制', handler: () => ctx.actions.togglePauseRecord(), when: () => ctx.state.recording },
    { id: 'draw:undo', keys: ['Ctrl+Z', 'Cmd+Z'], scope: 'drawing', description: '撤销上一笔', handler: () => ctx.actions.undo() },
    { id: 'draw:redo', keys: ['Ctrl+Shift+Z', 'Cmd+Shift+Z', 'Ctrl+Y', 'Cmd+Y'], scope: 'drawing', description: '重做', handler: () => ctx.actions.redo() },
    { id: 'bookmark:add', keys: ['Ctrl+B', 'Cmd+B'], scope: 'global', description: '在当前位置添加书签', handler: () => ctx.actions.addBookmark() },
    { id: 'draw:toggle', keys: ['Ctrl+D', 'Cmd+D'], scope: 'global', description: '切换画笔工具', handler: () => ctx.actions.toggleDraw() },
    { id: 'tool:pen', keys: ['1'], scope: 'drawing', description: '画笔', handler: () => ctx.actions.setTool('pen') },
    { id: 'tool:arrow', keys: ['2'], scope: 'drawing', description: '箭头', handler: () => ctx.actions.setTool('arrow') },
    { id: 'tool:rect', keys: ['3'], scope: 'drawing', description: '矩形', handler: () => ctx.actions.setTool('rect') },
    { id: 'tool:highlight', keys: ['4'], scope: 'drawing', description: '高亮', handler: () => ctx.actions.setTool('highlight') },
    { id: 'tool:eraser', keys: ['5'], scope: 'drawing', description: '橡皮擦', handler: () => ctx.actions.setTool('eraser') },
    { id: 'draw:widthDown', keys: ['['], scope: 'drawing', description: '减小画笔粗细', handler: () => ctx.actions.adjustWidth(-2) },
    { id: 'draw:widthUp', keys: [']'], scope: 'drawing', description: '增大画笔粗细', handler: () => ctx.actions.adjustWidth(2) },
    { id: 'play:toggle', keys: ['Space'], scope: 'editor', description: '播放/暂停', handler: () => ctx.actions.togglePlay(), when: () => ctx.state.hasVideo },
    { id: 'play:prevFrame', keys: ['ArrowLeft'], scope: 'editor', description: '后退5帧', handler: () => ctx.actions.seekFrames(-5), when: () => ctx.state.hasVideo },
    { id: 'play:nextFrame', keys: ['ArrowRight'], scope: 'editor', description: '前进5帧', handler: () => ctx.actions.seekFrames(5), when: () => ctx.state.hasVideo },
    { id: 'play:prevBookmark', keys: ['Shift+ArrowLeft'], scope: 'editor', description: '跳到上一个书签', handler: () => ctx.actions.gotoPrevBookmark(), when: () => ctx.state.hasVideo },
    { id: 'play:nextBookmark', keys: ['Shift+ArrowRight'], scope: 'editor', description: '跳到下一个书签', handler: () => ctx.actions.gotoNextBookmark(), when: () => ctx.state.hasVideo },
  ];
}
