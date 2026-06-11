import { bus } from './EventBus.js';
import { uuid } from '../utils/format.js';

export class Timeline {
  constructor() {
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this.clipStart = 0;
    this.clipEnd = 0;
    this.bookmarks = [];
    this.fps = 30;
    this.rafId = null;
    this.lastTick = 0;
    this.playbackRate = 1;
    this.videoElement = null;
    this._seeking = false;
  }

  setDuration(ms) {
    this.duration = ms;
    if (this.clipEnd === 0 || this.clipEnd > ms) this.clipEnd = ms;
    if (this.currentTime > ms) this.currentTime = ms;
    bus.emit('timeline:duration', this.duration);
    this._emitTime();
  }

  setVideoElement(video) {
    this.videoElement = video;
    if (video) {
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && isFinite(video.duration)) this.setDuration(video.duration * 1000);
      });
      video.addEventListener('timeupdate', () => {
        if (!this._seeking) {
          this.currentTime = video.currentTime * 1000;
          this._emitTime();
        }
      });
      video.addEventListener('play', () => { this.isPlaying = true; bus.emit('timeline:playState', true); });
      video.addEventListener('pause', () => { this.isPlaying = false; bus.emit('timeline:playState', false); });
      video.addEventListener('ended', () => { this.isPlaying = false; bus.emit('timeline:playState', false); });
    }
  }

  _emitTime() {
    bus.emit('timeline:time', {
      current: this.currentTime,
      duration: this.duration,
      clipStart: this.clipStart,
      clipEnd: this.clipEnd,
      progress: this.duration > 0 ? this.currentTime / this.duration : 0,
    });
  }

  seek(ms, isUserAction = false) {
    ms = Math.max(this.clipStart, Math.min(this.clipEnd || this.duration, ms || 0));
    this.currentTime = ms;
    this._seeking = isUserAction;
    if (this.videoElement && isFinite(ms) && this.duration > 0) {
      try { this.videoElement.currentTime = ms / 1000; } catch {}
    }
    this._emitTime();
    if (isUserAction) setTimeout(() => { this._seeking = false; }, 50);
  }

  seekFrames(deltaFrames) {
    const msPerFrame = 1000 / this.fps;
    this.seek(this.currentTime + deltaFrames * msPerFrame, true);
  }

  play() {
    if (!this.videoElement) return;
    if (this.currentTime >= (this.clipEnd || this.duration)) this.seek(this.clipStart, true);
    try { this.videoElement.play(); } catch (e) { console.warn(e); }
    this.isPlaying = true;
    bus.emit('timeline:playState', true);
  }

  pause() {
    if (this.videoElement) this.videoElement.pause();
    this.isPlaying = false;
    bus.emit('timeline:playState', false);
  }

  togglePlay() {
    if (this.isPlaying) this.pause(); else this.play();
  }

  stopPlayback() {
    this.pause();
    this.seek(this.clipStart, true);
  }

  setClipStart(ms) {
    this.clipStart = Math.max(0, Math.min(ms, this.clipEnd - 100, this.duration - 100));
    if (this.currentTime < this.clipStart) this.seek(this.clipStart);
    bus.emit('timeline:clipChanged', { start: this.clipStart, end: this.clipEnd });
    this._emitTime();
  }

  setClipEnd(ms) {
    this.clipEnd = Math.min(this.duration, Math.max(ms, this.clipStart + 100, 100));
    if (this.currentTime > this.clipEnd) this.seek(this.clipEnd);
    bus.emit('timeline:clipChanged', { start: this.clipStart, end: this.clipEnd });
    this._emitTime();
  }

  resetClip() {
    this.clipStart = 0;
    this.clipEnd = this.duration;
    bus.emit('timeline:clipChanged', { start: this.clipStart, end: this.clipEnd });
    this._emitTime();
  }

  addBookmark(timeMs, label = '', color = '#22D3EE') {
    const upperBound = this.duration > 0 ? this.duration : Math.max(timeMs || 0, 1);
    const bm = {
      id: uuid(),
      time: clamp(timeMs, 0, upperBound),
      label: label || `书签 ${this.bookmarks.length + 1}`,
      color,
      createdAt: Date.now(),
    };
    this.bookmarks.push(bm);
    this.bookmarks.sort((a, b) => a.time - b.time);
    bus.emit('timeline:bookmarkAdded', bm);
    return bm;
  }

  removeBookmark(id) {
    const idx = this.bookmarks.findIndex(b => b.id === id);
    if (idx >= 0) {
      const [removed] = this.bookmarks.splice(idx, 1);
      bus.emit('timeline:bookmarkRemoved', removed);
      return removed;
    }
    return null;
  }

  updateBookmark(id, patch) {
    const bm = this.bookmarks.find(b => b.id === id);
    if (bm) {
      Object.assign(bm, patch);
      this.bookmarks.sort((a, b) => a.time - b.time);
      bus.emit('timeline:bookmarkUpdated', bm);
    }
    return bm;
  }

  gotoBookmark(id) {
    const bm = this.bookmarks.find(b => b.id === id);
    if (bm) this.seek(bm.time, true);
    return bm;
  }

  getNearestBookmark(timeMs) {
    if (!this.bookmarks.length) return null;
    let nearest = this.bookmarks[0];
    let minDiff = Math.abs(nearest.time - timeMs);
    for (const b of this.bookmarks) {
      const d = Math.abs(b.time - timeMs);
      if (d < minDiff) { minDiff = d; nearest = b; }
    }
    return nearest;
  }

  loadBookmarks(bookmarks) {
    this.bookmarks = bookmarks || [];
    this.bookmarks.sort((a, b) => a.time - b.time);
    bus.emit('timeline:bookmarksLoaded', this.bookmarks);
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.videoElement) this.videoElement.playbackRate = rate;
  }

  reset() {
    this.stopPlayback();
    this.duration = 0;
    this.currentTime = 0;
    this.clipStart = 0;
    this.clipEnd = 0;
    this.bookmarks = [];
    this._emitTime();
    bus.emit('timeline:reset');
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
