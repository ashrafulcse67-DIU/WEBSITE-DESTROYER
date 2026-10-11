import { VIEW_H, VIEW_W } from './constants';
import type { InputState } from './types';

const KEYMAP: Record<string, 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire'> = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', Space: 'jump', KeyJ: 'fire' };
export type VKey = 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire';

/** Keyboard (A/D, Space, F, mouse), pointer/touch aiming and the virtual buttons – independent from the renderer. */
export class InputController {
  private keys: Partial<Record<VKey, boolean>> = {};
  private virt: Partial<Record<VKey, boolean>> = {};
  private mouseDown = false; private pointerDown = false; private aim = { x: 0, y: 0, active: false };
  private cb: { onSwitch(): void; onPause(): void; cam(): { x: number; y: number } };
  private handlers: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  enabled = false;
  constructor(private root: HTMLElement, cb: InputController['cb']) { this.cb = cb; }

  attach() {
    if (this.handlers.length) return;
    const on = (t: EventTarget, ev: string, fn: (e: any) => void, opt?: AddEventListenerOptions) => { t.addEventListener(ev, fn as EventListener, opt); this.handlers.push([t, ev, fn as EventListener, opt]); };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.enabled) return; const tag = (e.target as HTMLElement | null)?.tagName || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.code === 'Escape' || (e.code === 'KeyP' && !e.repeat)) { this.cb.onPause(); return; }
      const k = KEYMAP[e.code]; if (k) { e.preventDefault(); this.keys[k] = true; if (k === 'fire') this.aim.active = false; }
      if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); this.cb.onSwitch(); }
    });
    on(window, 'keyup', (e: KeyboardEvent) => { const k = KEYMAP[e.code]; if (k) { this.keys[k] = false; if (this.enabled) e.preventDefault(); } });
    on(window, 'blur', () => { this.reset(); if (this.enabled) this.cb.onPause(); });
    on(window, 'pointerup', () => { this.mouseDown = false; this.pointerDown = false; });
    on(this.root, 'pointermove', (e: PointerEvent) => { if (!this.enabled) return; if (e.pointerType === 'touch' && !this.pointerDown) return; this.setAim(e); });
    on(this.root, 'pointerdown', (e: PointerEvent) => { if (!this.enabled || (e.target as HTMLElement).closest?.('button')) return; e.preventDefault(); this.setAim(e); if (e.pointerType === 'touch') this.pointerDown = true; else this.mouseDown = true; }, { passive: false });
    on(this.root, 'contextmenu', (e: Event) => e.preventDefault());
  }
  detach() { for (const [t, ev, fn, o] of this.handlers) t.removeEventListener(ev, fn, o); this.handlers = []; this.reset(); }
  reset() { this.keys = {}; this.virt = {}; this.mouseDown = false; this.pointerDown = false; this.aim.active = false; }
  setVirtual(k: VKey, down: boolean) { this.virt[k] = down; if (k === 'fire' && down) this.aim.active = false; }
  private setAim(e: PointerEvent) {
    const cv = this.root.querySelector('canvas'); if (!cv) return; const r = cv.getBoundingClientRect(); if (!r.width) return; const c = this.cb.cam();
    this.aim.x = (e.clientX - r.left) / r.width * VIEW_W + c.x; this.aim.y = (e.clientY - r.top) / r.height * VIEW_H + c.y; this.aim.active = true;
  }
  /** fill the simulation's input each frame; aiming stays "live" in world coordinates while the camera scrolls */
  apply(into: InputState) {
    const g = (k: VKey) => !!(this.keys[k] || this.virt[k]);
    into.left = g('left'); into.right = g('right'); into.up = g('up'); into.down = g('down'); into.jump = g('jump');
    into.fire = g('fire') || this.mouseDown || this.pointerDown; into.aimActive = this.aim.active && (this.mouseDown || this.pointerDown || !g('fire')); into.aimX = this.aim.x; into.aimY = this.aim.y;
  }
}
