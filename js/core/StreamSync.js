import { bus } from './EventBus.js';
import { generateRoomCode, uuid } from '../utils/format.js';

export const ROLE = { HOST: 'host', VIEWER: 'viewer' };

export class StreamSync {
  constructor() {
    this.role = null;
    this.roomCode = null;
    this.channel = null;
    this.viewers = new Map();
    this.userId = uuid().slice(0, 8);
    this.userName = `用户${this.userId.slice(0, 4).toUpperCase()}`;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.frameInterval = null;
  }

  get inRoom() { return this.role !== null; }

  _heartbeat() {
    if (!this.channel) return;
    if (this.role === ROLE.HOST) {
      this.channel.postMessage({
        type: 'hb:host',
        userId: this.userId,
        userName: this.userName,
        time: Date.now(),
        viewerCount: this.viewers.size,
      });
    } else if (this.role === ROLE.VIEWER) {
      this.channel.postMessage({
        type: 'hb:viewer',
        userId: this.userId,
        userName: this.userName,
        time: Date.now(),
      });
    }
  }

  createRoom() {
    if (this.inRoom) this.leaveRoom();
    this.roomCode = generateRoomCode();
    this.role = ROLE.HOST;
    this._setupChannel();
    this.viewers.clear();

    this.heartbeatTimer = setInterval(() => this._heartbeat(), 2500);

    this.frameInterval = setInterval(() => {
      if (!this.channel) return;
      try {
        const videoEl = document.querySelector('.video-preview');
        const drawCvs = document.querySelector('.draw-canvas');
        if (!videoEl || !drawCvs) return;
        const W = drawCvs.width || 640;
        const H = drawCvs.height || 360;
        if (W === 0 || H === 0) return;
        if (!this._offscreen) {
          this._offscreen = document.createElement('canvas');
        }
        const off = this._offscreen;
        off.width = Math.max(1, Math.floor(W * 0.6));
        off.height = Math.max(1, Math.floor(H * 0.6));
        const octx = off.getContext('2d');
        octx.fillStyle = '#000';
        octx.fillRect(0, 0, off.width, off.height);
        try {
          octx.drawImage(videoEl, 0, 0, off.width, off.height);
        } catch (e) {}
        try {
          octx.drawImage(drawCvs, 0, 0, off.width, off.height);
        } catch (e) {}
        try {
          const url = off.toDataURL('image/jpeg', 0.55);
          if (url && url.length < 400000) {
            this.channel.postMessage({ type: 'frame', url, time: Date.now(), w: off.width, h: off.height });
          }
        } catch (e) {}
      } catch (e) { console.warn('frame broadcast error', e); }
    }, 400);

    bus.emit('stream:roomCreated', { roomCode: this.roomCode, role: this.role });
    return this.roomCode;
  }

  joinRoom(code) {
    if (this.inRoom) this.leaveRoom();
    if (!code || code.length < 4) {
      bus.emit('stream:error', { message: '房间码格式不正确' });
      return false;
    }
    this.roomCode = code.toUpperCase();
    this.role = ROLE.VIEWER;
    this._setupChannel();

    this.heartbeatTimer = setInterval(() => this._heartbeat(), 2000);

    this.channel.postMessage({
      type: 'join',
      userId: this.userId,
      userName: this.userName,
      time: Date.now(),
    });

    this.reconnectTimer = setTimeout(() => {
      if (!this.viewers.size && this.role === ROLE.VIEWER) {
        bus.emit('stream:error', { message: '连接超时：主机无响应，请确认房间码正确且主机在线' });
        this.leaveRoom();
      }
    }, 5000);

    bus.emit('stream:joined', { roomCode: this.roomCode, role: this.role });
    return true;
  }

  _setupChannel() {
    if (!this.roomCode) return;
    this.channel = new BroadcastChannel(`screenstudio:${this.roomCode}`);
    this.channel.onmessage = (ev) => this._handleMessage(ev.data);
    this.channel.onmessageerror = (e) => console.warn('channel msg error', e);
  }

  _handleMessage(msg) {
    if (!msg || !msg.type) return;
    const { type, userId } = msg;
    if (userId === this.userId) return;

    switch (type) {
      case 'join':
        if (this.role === ROLE.HOST) {
          this.viewers.set(userId, { name: msg.userName, lastSeen: Date.now() });
          bus.emit('stream:viewerJoined', { userId, userName: msg.userName });
          bus.emit('stream:viewerList', this.getViewerList());
          this.channel.postMessage({
            type: 'welcome',
            hostName: this.userName,
            toUserId: userId,
          });
        }
        break;

      case 'welcome':
        if (this.role === ROLE.VIEWER) {
          clearTimeout(this.reconnectTimer);
          this.viewers.set('host', { name: msg.hostName, lastSeen: Date.now(), isHost: true });
          bus.emit('stream:connectedToHost', { hostName: msg.hostName });
          bus.emit('stream:viewerList', this.getViewerList());
        }
        break;

      case 'leave':
        if (this.viewers.has(userId)) {
          const info = this.viewers.get(userId);
          this.viewers.delete(userId);
          bus.emit('stream:viewerLeft', { userId, userName: info?.name });
          bus.emit('stream:viewerList', this.getViewerList());
        }
        break;

      case 'hb:host':
        if (this.role === ROLE.VIEWER) {
          this.viewers.set('host', { name: msg.userName, lastSeen: Date.now(), isHost: true });
        }
        break;

      case 'hb:viewer':
        if (this.role === ROLE.HOST) {
          if (this.viewers.has(userId)) {
            const info = this.viewers.get(userId);
            info.name = msg.userName; info.lastSeen = Date.now();
          } else {
            this.viewers.set(userId, { name: msg.userName, lastSeen: Date.now() });
            bus.emit('stream:viewerJoined', { userId, userName: msg.userName });
            bus.emit('stream:viewerList', this.getViewerList());
          }
        }
        break;

      case 'stroke':
        bus.emit('stream:strokeReceived', { stroke: msg.stroke, authorId: msg.authorId });
        break;

      case 'strokeLive':
        bus.emit('stream:strokeLiveReceived', { stroke: msg.stroke, authorId: msg.authorId });
        break;

      case 'strokeLiveEnd':
        bus.emit('stream:strokeLiveEndReceived', { strokeId: msg.strokeId, authorId: msg.authorId });
        break;

      case 'bookmark':
        bus.emit('stream:bookmarkReceived', msg.bookmark);
        break;

      case 'frame':
        if (this.role === ROLE.VIEWER) {
          bus.emit('stream:frameReceived', { url: msg.url, time: msg.time });
        }
        break;

      case 'chat':
        bus.emit('stream:chat', { userId, userName: msg.userName, text: msg.text, time: msg.time });
        break;
    }
  }

  broadcastStroke(stroke) {
    if (!this.channel || this.role !== ROLE.HOST) return;
    this.channel.postMessage({ type: 'stroke', stroke, authorId: this.userId });
  }

  broadcastLiveStroke(stroke) {
    if (!this.channel || this.role !== ROLE.HOST) return;
    this.channel.postMessage({ type: 'strokeLive', stroke, authorId: this.userId });
  }

  broadcastLiveStrokeEnd(strokeId) {
    if (!this.channel || this.role !== ROLE.HOST) return;
    this.channel.postMessage({ type: 'strokeLiveEnd', strokeId, authorId: this.userId });
  }

  broadcastBookmark(bookmark) {
    if (!this.channel || this.role !== ROLE.HOST) return;
    this.channel.postMessage({ type: 'bookmark', bookmark });
  }

  getViewerList() {
    const list = [];
    if (this.role === ROLE.HOST) {
      list.push({ id: this.userId, name: this.userName + ' (我)', isHost: true });
    }
    for (const [id, info] of this.viewers) {
      list.push({ id, name: info.name, isHost: !!info.isHost });
    }
    return list.sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0));
  }

  leaveRoom() {
    if (this.channel) {
      try {
        this.channel.postMessage({ type: 'leave', userId: this.userId, time: Date.now() });
      } catch {}
      try { this.channel.close(); } catch {}
      this.channel = null;
    }
    clearInterval(this.heartbeatTimer); this.heartbeatTimer = null;
    clearInterval(this.frameInterval); this.frameInterval = null;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    this.viewers.clear();
    this.role = null;
    const code = this.roomCode;
    this.roomCode = null;
    bus.emit('stream:leftRoom', { roomCode: code });
  }

  setUserName(name) {
    this.userName = name || this.userName;
    bus.emit('stream:userNameChanged', this.userName);
  }
}
