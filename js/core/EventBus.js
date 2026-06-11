export class EventBus {
  constructor() { this.map = new Map(); }
  on(event, handler) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event).add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) {
    if (!this.map.has(event)) return;
    this.map.get(event).delete(handler);
  }
  emit(event, payload) {
    if (!this.map.has(event)) return;
    for (const h of this.map.get(event)) {
      try { h(payload); } catch (e) { console.error(`[EventBus] handler error for ${event}:`, e); }
    }
  }
  once(event, handler) {
    const unsub = this.on(event, (p) => { unsub(); handler(p); });
    return unsub;
  }
}

export const bus = new EventBus();
