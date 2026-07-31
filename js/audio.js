// GARGANTUA — optional ambient drone. Autoplay-policy safe: if play() is rejected
// before a user gesture, the request is parked and retried on the first gesture.

export class AmbientAudio {
  constructor(url) {
    this.el = new Audio(url);
    this.el.loop = true;
    this.el.preload = 'none'; /* the 2 MB loop is fetched on first enable, not at boot */
    this.el.volume = 0;
    this.target = 0;
    this.pending = false;
    this._raf = null;
    this.available = true;
    this.el.addEventListener('error', () => { this.available = false; });
  }

  get enabled() { return this.target > 0; }

  setEnabled(on) {
    this.target = on ? 0.55 : 0;
    if (on) this._tryPlay();
    this._fade();
  }

  /* call from any user-gesture handler */
  gesture() {
    if (this.pending && this.target > 0) {
      this.pending = false;
      this._tryPlay();
    }
  }

  _tryPlay() {
    const p = this.el.play();
    if (p && p.catch) p.catch(() => { this.pending = true; });
  }

  _fade() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const step = () => {
      const v = this.el.volume;
      const d = this.target - v;
      if (Math.abs(d) < 0.01) {
        this.el.volume = this.target;
        if (this.target === 0 && !this.el.paused) this.el.pause();
        this._raf = null;
        return;
      }
      this.el.volume = v + d * 0.06;
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
}
