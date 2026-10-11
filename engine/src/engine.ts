import { VIEW_H, VIEW_W } from './constants';
import type { Host, Renderer, StartOptions } from './host';
import { InputController, type VKey } from './input';
import { loadPhaser } from './loader';
import { CanvasRenderer } from './render/canvasRenderer';
import { PhaserRenderer } from './render/phaserRenderer';
import { Simulation } from './sim';
import type { GameEvent, Snapshot } from './types';

let phaserPromise: Promise<any | null> | null = null;

/** Owns the simulation, the input and one renderer. Gameplay never waits for the network. */
export class Engine {
  sim: Simulation | null = null; paused = false;
  private renderer: Renderer | null = null; private opts: StartOptions | null = null; private token = 0; private raf = 0; private last = 0; private rname = 'none';
  private input: InputController;
  constructor(private host: Host, private root: HTMLElement) {
    this.input = new InputController(root, { onSwitch: () => this.switchWeapon(), onPause: () => this.host.onPauseRequest(), cam: () => this.sim ? this.sim.camera : { x: 0, y: 0 } });
    this.input.attach();
  }
  get rendererName() { return this.rname; }
  private label() { return this.host.t('mode_' + (this.opts ? this.opts.mode : 'simulation')); }

  async start(opts: StartOptions): Promise<void> {
    const tok = ++this.token; this.stopLoop(); this.teardown(); this.opts = opts; this.paused = false; this.input.reset();
    const sim = new Simulation({ charId: opts.charId, seed: opts.seed ?? (Date.now() & 0xffffff), reducedMotion: this.host.reducedMotion, palette: opts.palette }); this.sim = sim;
    let r: Renderer | null = null; let note = '';
    if (!opts.forceCanvas) {
      phaserPromise = phaserPromise ?? loadPhaser();
      const P = await phaserPromise; if (tok !== this.token) return;
      if (P) {
        try { r = new PhaserRenderer(P, this.host, this.root, sim, opts, () => this.label(), { frame: dt => this.frame(dt), fail: e => this.failToCanvas(e) }); await r.init(); }
        catch (e) { try { r?.destroy(); } catch { /* ignore */ } r = null; note = 'Phaser could not start: ' + String((e as Error)?.message || e); }
        if (tok !== this.token) { r?.destroy(); return; }
      } else { phaserPromise = null; note = 'Phaser could not be loaded (using the Canvas renderer)'; }
    }
    if (!r) { r = new CanvasRenderer(this.host, this.root, sim, opts, () => this.label()); await r.init(); if (tok !== this.token) { r.destroy(); return; } }
    this.renderer = r; this.rname = r.name; this.input.enabled = true; this.host.onRenderer(r.name, note);
    if (!r.drivesLoop) this.loop();
  }
  /** Phaser threw while running: keep the same simulation and continue seamlessly on the Canvas renderer. */
  private failToCanvas(err: unknown) {
    if (!this.sim || !this.opts) return; const sim = this.sim, opts = this.opts, tok = this.token;
    queueMicrotask(async () => {
      try { this.renderer?.destroy(); } catch { /* ignore */ }
      const r = new CanvasRenderer(this.host, this.root, sim, opts, () => this.label()); await r.init(); if (tok !== this.token) { r.destroy(); return; }
      this.renderer = r; this.rname = 'canvas'; this.host.onRenderer('canvas', 'Phaser error: ' + String((err as Error)?.message || err)); this.loop();
    });
  }
  private loop() { this.stopLoop(); this.last = performance.now(); const tok = this.token; const tick = (now: number) => { if (tok !== this.token) return; const dt = now - this.last; this.last = now; try { this.frame(dt); } catch (e) { console.error(e); } if (tok === this.token) this.raf = requestAnimationFrame(tick); }; this.raf = requestAnimationFrame(tick); }
  private stopLoop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  private teardown() { try { this.renderer?.destroy(); } catch { /* ignore */ } this.renderer = null; this.root.querySelectorAll('canvas').forEach(c => c.remove()); }

  frame(dtMs: number) {
    const sim = this.sim; if (!sim) return; const dt = Math.min(dtMs / 1000, 0.1);
    if (!this.paused && dt > 0) { this.input.apply(sim.input); const n = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / n; for (let i = 0; i < n; i++) sim.step(h); }
    this.dispatch(sim.drain()); this.renderer?.render();
  }
  private dispatch(events: GameEvent[]) {
    const h = this.host;
    for (const e of events) {
      switch (e.type) {
        case 'sfx': h.sfx(e.name); break;
        case 'toast': h.onToast(e.key, e.params); break;
        case 'tier': h.onTier(e.tier); break;
        case 'tick': h.onTick(e.sec); if (e.sec === 10) h.setIntensity(1); break;
        case 'phase': h.onPhase(e.phase); if (e.phase === 'victory' || e.phase === 'defeat') this.input.reset(); break;
        case 'end': h.onEnd(e.result); break;
        case 'done': if (this.sim?.result) h.onDone(this.sim.result); break;
      }
    }
  }
  pause() { if (!this.sim || this.paused) return; if (this.sim.phase === 'play' || this.sim.phase === 'ready') { this.paused = true; this.input.reset(); } }
  resume() { this.paused = false; this.last = performance.now(); }
  switchWeapon() { if (!this.paused) this.sim?.switchWeapon(); }
  selectWeapon(n: number) { if (!this.paused) this.sim?.selectWeapon(n); }
  setVirtual(k: VKey, down: boolean) { if (!this.paused) this.input.setVirtual(k, down); }
  snapshot(): Snapshot | null { return this.sim ? this.sim.snapshot(this.paused, this.rname, this.opts?.mode ?? 'simulation') : null; }
  stop() { this.token++; this.stopLoop(); this.teardown(); this.input.reset(); this.input.enabled = false; this.sim = null; }
  destroy() { this.stop(); this.input.detach(); }
}
export const VIEW = { w: VIEW_W, h: VIEW_H };
