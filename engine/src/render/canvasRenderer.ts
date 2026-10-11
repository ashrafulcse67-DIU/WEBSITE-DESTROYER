import { CELL_H, CELL_W, CHARS, COLS, FLOOR_Y, LEDGES, PAGE, ROWS, VIEW_H, VIEW_W, WORLD_W } from '../constants';
import type { Host, Renderer, StartOptions } from '../host';
import type { Simulation } from '../sim';

/** Canvas 2D renderer: the guaranteed fallback (also what the headless tests exercise). Draws exactly what the simulation holds. */
export class CanvasRenderer implements Renderer {
  readonly name = 'canvas'; readonly drivesLoop = false;
  private cv!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D; private bg!: HTMLCanvasElement;
  constructor(private host: Host, private root: HTMLElement, private sim: Simulation, private opts: StartOptions, private label: () => string) {}
  async init() {
    this.cv = document.createElement('canvas'); this.cv.width = VIEW_W; this.cv.height = VIEW_H; this.cv.style.cssText = 'width:100%;height:100%;display:block;object-fit:contain;touch-action:none;cursor:crosshair;background:#05060f';
    this.cv.setAttribute('aria-label', 'Game'); this.root.appendChild(this.cv); this.ctx = this.cv.getContext('2d')!;
    this.bg = document.createElement('canvas'); this.bg.width = 1700; this.bg.height = 960; this.host.drawSpace(this.bg.getContext("2d")!, 1700, 960, 3, false);
  }
  render() {
    const c = this.ctx, s = this.sim, cam = s.camera, cx = cam.x + cam.sx, cy = cam.y + cam.sy, page = this.opts.page;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, VIEW_W, VIEW_H);
    c.drawImage(this.bg, -cam.x * 0.07, -cam.y * 0.07);
    c.save(); c.translate(-cx, -cy);
    // floor
    const gg = c.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 80); gg.addColorStop(0, '#1b2260'); gg.addColorStop(1, '#0b0f33'); c.fillStyle = gg; c.fillRect(-50, FLOOR_Y, WORLD_W + 100, 120);
    c.strokeStyle = '#27e8ff'; c.lineWidth = 4; c.shadowColor = '#27e8ff'; c.shadowBlur = 12; c.beginPath(); c.moveTo(-50, FLOOR_Y); c.lineTo(WORLD_W + 50, FLOOR_Y); c.stroke(); c.shadowBlur = 0;
    // browser chrome + void behind the page
    const a = s.frameAlpha; c.globalAlpha = a;
    c.fillStyle = '#e3e8fb'; c.strokeStyle = '#0a0a1e'; c.lineWidth = 4; c.beginPath(); c.roundRect(PAGE.x - 8, PAGE.y - 58, PAGE.w + 16, PAGE.h + 66, 18); c.fill(); c.stroke();
    ['#ff5f57', '#ffbd2e', '#28c840'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(PAGE.x + 22 + i * 24, PAGE.y - 30, 8, 0, 7); c.fill(); });
    c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(PAGE.x + 110, PAGE.y - 46, PAGE.w - 360, 32, 16); c.fill();
    c.fillStyle = '#3a4270'; c.font = "600 18px 'Fredoka',sans-serif"; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('🔒 ' + this.opts.domain, PAGE.x + 128, PAGE.y - 29, PAGE.w - 400);
    const real = this.opts.mode !== 'simulation'; c.fillStyle = real ? '#17c978' : '#ff9a2e'; c.beginPath(); c.roundRect(PAGE.x + PAGE.w - 236, PAGE.y - 46, 224, 32, 16); c.fill(); c.fillStyle = '#04122a'; c.font = "700 15px 'Fredoka',sans-serif"; c.textAlign = 'center'; c.fillText(this.label(), PAGE.x + PAGE.w - 124, PAGE.y - 29, 210);
    c.save(); c.beginPath(); c.rect(PAGE.x, PAGE.y, PAGE.w, PAGE.h); c.clip(); c.fillStyle = '#04030c'; c.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h); const bx = PAGE.x + PAGE.w / 2, by = PAGE.y + PAGE.h / 2;
    for (let i = 0; i < 5; i++) { c.strokeStyle = `rgba(${120 + i * 30},${60 + i * 20},255,${0.45 - i * 0.07})`; c.lineWidth = 4; c.beginPath(); c.ellipse(bx, by, 150 + i * 90, 50 + i * 36, s.t * 0.9 + i, 0, 7); c.stroke(); }
    c.restore();
    // page cells
    const sw = page.width / COLS, sh = page.height / ROWS;
    for (let i = 0; i < s.cells.length; i++) {
      const cl = s.cells[i]; if (cl.hp <= 0) continue; const col = i % COLS, row = (i / COLS) | 0, x = PAGE.x + col * CELL_W, y = PAGE.y + row * CELL_H;
      if (x + CELL_W < cx - 4 || x > cx + VIEW_W + 4 || y + CELL_H < cy - 4 || y > cy + VIEW_H + 4) continue;
      const jx = cl.glitch > 0 ? (((i * 7919 + Math.floor(s.t * 30)) % 9) - 4) : 0;
      c.drawImage(page, col * sw, row * sh, sw, sh, x + jx, y, CELL_W + 0.6, CELL_H + 0.6);
      const dm = 1 - cl.hp / (s.total / s.cells.length);
      if (dm > 0.001) { c.fillStyle = `rgba(0,0,0,${dm * 0.4})`; c.fillRect(x, y, CELL_W, CELL_H); c.strokeStyle = 'rgba(10,10,30,.8)'; c.lineWidth = 2; c.beginPath(); const n = Math.ceil(dm * 4); for (let k = 0; k < n; k++) { const an = (i * 2.399 + k * 2.1); c.moveTo(x + CELL_W / 2, y + CELL_H / 2); c.lineTo(x + CELL_W / 2 + Math.cos(an) * CELL_W * 0.55, y + CELL_H / 2 + Math.sin(an) * CELL_H * 0.55); } c.stroke(); }
      if (cl.flash > 0) { c.fillStyle = `rgba(255,255,255,${cl.flash * 5})`; c.fillRect(x, y, CELL_W, CELL_H); }
      if (cl.glitch > 0) { c.strokeStyle = 'rgba(39,232,255,.9)'; c.lineWidth = 3; c.strokeRect(x + jx + 3, y, CELL_W, CELL_H); c.strokeStyle = 'rgba(255,79,216,.8)'; c.strokeRect(x - jx - 3, y + 2, CELL_W, CELL_H); }
    }
    c.globalAlpha = 1;
    // ledges + debris (Mario-style floating platforms + mystery blocks)
    const plat = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = '#1b2260'; c.beginPath(); c.roundRect(x, y, w, h, 7); c.fill(); c.strokeStyle = '#0a0a1e'; c.lineWidth = 3; c.stroke(); c.fillStyle = col; c.fillRect(x + 6, y + 1, w - 12, 3); };
    for (const l of LEDGES) {
      if ((l as any).type === 'mystery') {
        // classic Mario "?" block — gold with a bouncing question mark
        const bob = Math.sin(s.t * 3 + l.x * 0.1) * 2;
        c.fillStyle = '#ffd36b'; c.beginPath(); c.roundRect(l.x, l.y - 24 + bob, l.w, 24, 5); c.fill();
        c.strokeStyle = '#0a0a1e'; c.lineWidth = 3; c.stroke();
        c.fillStyle = '#b8860b'; c.fillRect(l.x + 4, l.y - 22 + bob, l.w - 8, 3); c.fillRect(l.x + 4, l.y - 8 + bob, l.w - 8, 3);
        c.fillStyle = '#fff'; c.strokeStyle = '#0a0a1e'; c.lineWidth = 2;
        c.font = "800 16px 'Bangers','Baloo Da 2',cursive"; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('?', l.x + l.w / 2, l.y - 11 + bob); c.strokeText('?', l.x + l.w / 2, l.y - 11 + bob);
      } else {
        plat(l.x, l.y, l.w, 14, '#a35bff');
        // brick pattern on the long platforms
        c.strokeStyle = 'rgba(10,10,30,.45)'; c.lineWidth = 2;
        for (let bx = l.x + 30; bx < l.x + l.w - 10; bx += 30) { c.beginPath(); c.moveTo(bx, l.y + 2); c.lineTo(bx, l.y + 12); c.stroke(); }
      }
    }
    for (const d of s.debris) { c.globalAlpha = Math.min(1, d.life) * 0.95; plat(d.x, d.y, d.w, d.h, s.palette[0]); c.globalAlpha = 1; }
    // black hole of the victory + mini holes
    if (s.blackHole) { const k = Math.min(1, s.blackHole.t / 1.1), r = 30 + k * 260, g = c.createRadialGradient(bx, by, 0, bx, by, r * 1.6); g.addColorStop(0, '#000'); g.addColorStop(0.6, '#150630'); g.addColorStop(1, 'rgba(150,60,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(bx, by, r * 1.6, 0, 7); c.fill(); for (let i = 0; i < 3; i++) { c.strokeStyle = 'rgba(255,154,46,.7)'; c.lineWidth = 4; c.beginPath(); c.ellipse(bx, by, r * (1.2 + i * 0.25), r * (0.4 + i * 0.1), s.blackHole.t * 3 + i, 0, 7); c.stroke(); } }
    for (const h of s.holes) { const k = h.t / h.dur, r = 52 * Math.sin(k * Math.PI) + 10, g = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, r * 2); g.addColorStop(0, '#000'); g.addColorStop(0.5, '#2a0a50'); g.addColorStop(1, 'rgba(176,107,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(h.x, h.y, r * 2, 0, 7); c.fill(); c.strokeStyle = '#ff4fd8'; c.lineWidth = 3; c.beginPath(); c.ellipse(h.x, h.y, r * 1.5, r * 0.55, h.t * 10, 0, 7); c.stroke(); }
    if (s.portal) { const q = s.portal, r = 52 + Math.sin(q.t * 8) * 4, g = c.createRadialGradient(q.x, q.y, 2, q.x, q.y, r * 1.4); g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#27e8ff'); g.addColorStop(1, 'rgba(163,91,255,0)'); c.fillStyle = g; c.beginPath(); c.ellipse(q.x, q.y, r * 0.8, r * 1.3, 0, 0, 7); c.fill(); c.strokeStyle = '#a35bff'; c.lineWidth = 5; c.beginPath(); c.ellipse(q.x, q.y, r * 0.7, r * 1.15, 0, 0, 7); c.stroke(); }
    // beams + projectiles
    const ch = CHARS[s.def.id];
    for (const b of s.beams) { const w = 4 + b.tier * 4, al = b.life / 0.12; c.lineCap = 'round'; c.strokeStyle = `rgba(255,79,216,${al * 0.6})`; c.lineWidth = w * 2.4; c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke(); c.strokeStyle = `rgba(255,255,255,${al})`; c.lineWidth = w; c.stroke(); }
    for (const q of s.projs) {
      const r = 5 + q.tier * 2.4; c.strokeStyle = ch.accent; c.globalAlpha = 0.5; c.lineWidth = r; c.lineCap = 'round'; c.beginPath(); for (let i = 0; i < q.trail.length; i += 2) { if (i) c.lineTo(q.trail[i], q.trail[i + 1]); else c.moveTo(q.trail[i], q.trail[i + 1]); } c.stroke(); c.globalAlpha = 1; c.shadowColor = ch.accent; c.shadowBlur = 16;
      if (q.kind === 'bolt') { c.fillStyle = '#fff'; c.save(); c.translate(q.x, q.y); c.rotate(Math.atan2(q.vy, q.vx)); c.beginPath(); c.roundRect(-r * 2, -r * 0.7, r * 4, r * 1.4, r * 0.6); c.fill(); c.restore(); }
      else if (q.kind === 'bomb') { c.fillStyle = '#2b2f55'; c.strokeStyle = '#0a0a1e'; c.lineWidth = 3; c.beginPath(); c.arc(q.x, q.y, r * 1.6, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#ff3b4f'; c.fillRect(q.x - 3, q.y - 3, 6, 6); }
      else { c.fillStyle = '#14101f'; c.strokeStyle = '#ff4fd8'; c.lineWidth = 3; c.beginPath(); c.arc(q.x, q.y, r * 1.3, 0, 7); c.fill(); c.stroke(); }
      c.shadowBlur = 0; }
    // fx particles
    for (const q of s.fx) {
      const al = Math.max(0, Math.min(1, q.life / q.max)); c.globalAlpha = al;
      if (q.type === 'spark' || q.type === 'dust') { c.fillStyle = q.col; c.beginPath(); c.arc(q.x, q.y, q.size * (0.4 + al * 0.6), 0, 7); c.fill(); }
      else if (q.type === 'shard') { c.save(); c.translate(q.x, q.y); c.rotate(q.rot); const w = CELL_W * q.size * 1.3, h = CELL_H * q.size * 1.3, col = q.cell % COLS, row = (q.cell / COLS) | 0; c.drawImage(page, col * sw, row * sh, sw, sh, -w / 2, -h / 2, w, h); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5; c.strokeRect(-w / 2, -h / 2, w, h); c.restore(); }
      else if (q.type === 'ring') { c.strokeStyle = q.col; c.lineWidth = 5; c.beginPath(); c.arc(q.x, q.y, q.size * (1 - al) + 8, 0, 7); c.stroke(); }
      else if (q.type === 'text') { c.fillStyle = q.col; c.strokeStyle = '#0a0a1e'; c.lineWidth = 6; c.font = `${q.size}px 'Bangers','Baloo Da 2',cursive`; c.textAlign = 'center'; c.strokeText(q.text, q.x, q.y); c.fillText(q.text, q.x, q.y); }
    }
    c.globalAlpha = 1;
    // player
    const p = s.p; const mood = p.bubble > 0 && s.phase === 'play' ? 'happy' : p.mood;
    this.host.drawChar(c, s.def.id, p.x, p.y, { s: 1.2 * p.scale, face: p.face, t: s.t, walk: p.walk, air: !p.onGround, mood, aim: p.aim, spin: p.spin, flame: p.flame > 0, squash: p.squash, hide: p.hide, bubble: p.bubble > 0 ? this.host.laugh(s.def.id) : '', glow: s.cur >= 3, laugh: p.bubble > 0 });
    if (s.input.aimActive && s.phase === 'play') { const x = s.input.aimX, y = s.input.aimY; c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 14, 0, 7); c.moveTo(x - 22, y); c.lineTo(x - 7, y); c.moveTo(x + 7, y); c.lineTo(x + 22, y); c.moveTo(x, y - 22); c.lineTo(x, y - 7); c.moveTo(x, y + 7); c.lineTo(x, y + 22); c.stroke(); }
    c.restore();
    // screen-space overlays
    if (s.phase === 'play' && s.timeLeftMs <= 10000) { const pu = 0.25 + 0.2 * Math.abs(Math.sin(s.t * 6)), g = c.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.4, VIEW_W / 2, VIEW_H / 2, VIEW_H * 1.0); g.addColorStop(0, 'rgba(255,40,60,0)'); g.addColorStop(1, `rgba(255,40,60,${pu})`); c.fillStyle = g; c.fillRect(0, 0, VIEW_W, VIEW_H); }
    if (s.phase === 'ready') { c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(0, 0, VIEW_W, VIEW_H); }
  }
  destroy() { this.cv?.remove(); }
}
