// Deterministic game simulation. No DOM, no Phaser, no network: it only needs dt and an input state.
// That keeps gameplay responsive regardless of latency and lets it be unit-tested in Node.
import {
  CELL_H, CELL_HP, CELL_W, CHARS, COLS, FLOOR_Y, GRAVITY, LEDGES, MAX_SCORE, MILESTONES, PAGE, PLAYER_H, PLAYER_W, READY_MS, ROUND_MS, ROWS,
  TIERS, VIEW_H, VIEW_W, WORLD_H, WORLD_W, type CharDef, type CharId,
} from './constants';
import type { Beam, Cell, Debris, Fx, GameEvent, Hole, InputState, Phase, Player, Portal, Projectile, RoundResult, Snapshot, SfxName } from './types';

export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next(): number { this.a = (this.a + 0x6D2B79F5) | 0; let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const emptyInput = (): InputState => ({ left: false, right: false, up: false, down: false, jump: false, fire: false, aimX: 0, aimY: 0, aimActive: false });

export interface SimOptions { charId: CharId; seed?: number; reducedMotion?: boolean; palette?: string[]; }

export class Simulation {
  readonly events: GameEvent[] = [];
  readonly def: CharDef;
  readonly rng: Rng;
  readonly reduced: boolean;
  readonly palette: string[];
  phase: Phase = 'ready';
  t = 0; elapsed = 0; readyLeft = READY_MS;
  cells: Cell[] = []; alive = COLS * ROWS; remaining = COLS * ROWS * CELL_HP; readonly total = COLS * ROWS * CELL_HP;
  tier = 1; cur = 1; upgrades = 0; shots = 0; hits = 0; kills = 0; fireCd = 0; laughN = 0;
  p!: Player; projs: Projectile[] = []; beams: Beam[] = []; holes: Hole[] = []; debris: Debris[] = []; fx: Fx[] = [];
  portal: Portal | null = null; blackHole: { t: number } | null = null; frameAlpha = 1;
  camera = { x: 0, y: WORLD_H - VIEW_H, shake: 0, sx: 0, sy: 0 };
  input: InputState = emptyInput();
  result: RoundResult | null = null;
  private jumpEdge = false; private lastJump = false; private lastSec = 61; private seqStep = 0; private seqT = 0; private leap: { x0: number; y0: number; t: number; dur: number } | null = null; private doneT = 0;
  private maxFx: number;

  constructor(opts: SimOptions) {
    this.def = CHARS[opts.charId]; this.rng = new Rng(opts.seed ?? 1); this.reduced = !!opts.reducedMotion; this.maxFx = this.reduced ? 250 : 650;
    this.palette = opts.palette && opts.palette.length ? opts.palette : ['#8b5cf6', '#22d3ee', '#ffffff'];
    for (let i = 0; i < COLS * ROWS; i++) this.cells.push({ hp: CELL_HP, flash: 0, glitch: 0 });
    this.p = { x: 160, y: FLOOR_Y, vx: 0, vy: 0, face: 1, onGround: true, jumps: 0, coyote: 0, jbuf: 0, fuel: this.def.fuel, drop: 0, squash: 0, recoil: 0, spin: 0, spinT: 0, flame: 0, hide: false, scale: 1, mood: 'idle', bubble: 0, aim: 0, walk: false, jumpHeld: false };
    this.camera.x = 0; this.camera.y = WORLD_H - VIEW_H;
    this.emit({ type: 'phase', phase: 'ready' });
  }

  // ---------- derived values ----------
  get timeLeftMs(): number { return Math.max(0, ROUND_MS - this.elapsed); }
  get pctExact(): number { return clamp((1 - this.remaining / this.total) * 100, 0, 100); }
  get pct(): number { return this.alive === 0 ? 100 : Math.min(99, Math.floor(this.pctExact)); }
  wstats(tier = this.cur) { const b = TIERS[tier]!; return { dmg: b.dmg * this.def.dmg, cd: b.cd / this.def.rate, rad: b.rad * this.def.rad, spd: b.spd, tier }; }
  liveScore(): number { return this.result ? this.result.score : Math.round(this.pct * 50) + this.upgrades * 250; }
  snapshot(paused: boolean, renderer: string, mode: Snapshot['mode']): Snapshot {
    return { phase: this.phase, paused, timeLeftMs: this.phase === 'ready' ? ROUND_MS : this.timeLeftMs, elapsedMs: this.elapsed, pct: this.pct, pctExact: this.pctExact, tier: this.tier, cur: this.cur, unlocked: this.tier,
      score: this.liveScore(), alive: this.alive, totalCells: COLS * ROWS, weaponDmg: Math.round(this.wstats().dmg), nextMilestone: this.tier < 4 ? MILESTONES[this.tier + 1] : null, shots: this.shots, hits: this.hits, fuel: this.p.fuel / this.def.fuel,
      final10: this.phase === 'play' && this.timeLeftMs <= 10000, renderer, mode };
  }
  private emit(e: GameEvent) { this.events.push(e); }
  private sfx(name: SfxName) { this.emit({ type: 'sfx', name }); }
  drain(): GameEvent[] { return this.events.splice(0, this.events.length); }

  // ---------- grid helpers ----------
  cellIndexAt(x: number, y: number): number { const c = Math.floor((x - PAGE.x) / CELL_W), r = Math.floor((y - PAGE.y) / CELL_H); return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : r * COLS + c; }
  cellCenter(i: number) { return { x: PAGE.x + (i % COLS) * CELL_W + CELL_W / 2, y: PAGE.y + Math.floor(i / COLS) * CELL_H + CELL_H / 2 }; }
  private solidCellsHit(l: number, t: number, r: number, b: number): { i: number } | null {
    const c0 = Math.max(0, Math.floor((l - PAGE.x) / CELL_W)), c1 = Math.min(COLS - 1, Math.floor((r - 0.001 - PAGE.x) / CELL_W));
    const r0 = Math.max(0, Math.floor((t - PAGE.y) / CELL_H)), r1 = Math.min(ROWS - 1, Math.floor((b - 0.001 - PAGE.y) / CELL_H));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) { const i = rr * COLS + cc; if (this.cells[i].hp > 0) return { i }; }
    return null;
  }

  // ---------- damage: the ONE authoritative path ----------
  private applyDamage(i: number, amt: number): number {
    if (this.phase !== 'play') return 0;
    const c = this.cells[i]; if (!c || c.hp <= 0 || amt <= 0) return 0;
    const a = Math.min(c.hp, amt); c.hp -= a; this.remaining = Math.max(0, this.remaining - a); c.flash = 0.12; if (this.def.id === 'glitch') c.glitch = 0.7;
    if (c.hp <= 1e-6) { c.hp = 0; this.alive--; this.kills++; this.destroyCell(i); }
    return a;
  }
  private destroyCell(i: number) {
    const p = this.cellCenter(i);
    const n = this.fx.length > 420 ? 2 : 5;
    for (let k = 0; k < n; k++) this.addFx({ type: 'shard', x: p.x + this.rng.range(-40, 40), y: p.y + this.rng.range(-35, 35), vx: this.rng.range(-260, 260), vy: this.rng.range(-420, -60), g: 1500, life: this.rng.range(1.6, 2.8), size: this.rng.range(0.25, 0.45), rot: this.rng.range(0, 6), vr: this.rng.range(-9, 9), cell: i });
    this.burst(p.x, p.y, 4, this.palette, 300, 0.7, 900);
    if (this.debris.length < 9 && this.rng.next() < 0.3) this.debris.push({ x: p.x - 20, y: p.y, w: 40, h: 24, vy: 0, landed: false, life: 11, cell: i });
    this.sfx(this.def.id === 'glitch' ? 'glitch' : 'land');
  }
  private splash(x: number, y: number, ci: number, w: { dmg: number; rad: number }) {
    if (ci >= 0) this.applyDamage(ci, w.dmg);
    if (w.rad > 0) { const R = w.rad + 60; for (let i = 0; i < this.cells.length; i++) { if (i === ci || this.cells[i].hp <= 0) continue; const c = this.cellCenter(i), d = Math.hypot(c.x - x, c.y - y); if (d <= R) this.applyDamage(i, w.dmg * (1 - 0.6 * d / R)); } }
  }
  private checkProgress() {
    if (this.phase !== 'play') return;
    if (this.alive <= 0) { this.remaining = 0; this.finish(true); return; }
    const pc = this.pctExact, nt = pc >= 75 ? 4 : pc >= 50 ? 3 : pc >= 25 ? 2 : 1;
    if (nt > this.tier) {
      this.tier = nt; this.cur = nt; this.upgrades++; this.sfx('unlock'); this.shake(8);
      this.emit({ type: 'tier', tier: nt }); this.emit({ type: 'toast', key: nt === 4 ? 'upUlt' : nt === 2 ? 'up' : 'upMs', params: { p: MILESTONES[nt] } });
      this.addFx({ type: 'ring', x: this.p.x, y: this.p.y - 30, vx: 0, vy: 0, g: 0, life: 0.6, size: 90, rot: 0, vr: 0, col: this.def.accent });
      this.burst(this.p.x, this.p.y - 30, 24, [this.def.accent, '#ffffff', this.def.color], 420, 0.8, 300);
    }
  }

  // ---------- fx helpers ----------
  addFx(o: Partial<Fx> & { type: Fx['type'] }) {
    if (this.fx.length >= this.maxFx) return;
    const life = o.life ?? 0.6;
    this.fx.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, size: 3, rot: 0, vr: 0, col: '#ffffff', cell: -1, text: '', ...o, life, max: life });
  }
  burst(x: number, y: number, n: number, cols: string[], sp: number, life: number, g: number) {
    n = Math.ceil(n * (this.reduced ? 0.4 : 1));
    for (let i = 0; i < n; i++) { const a = this.rng.range(0, 6.283), v = this.rng.range(sp * 0.2, sp); this.addFx({ type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.15, g, life: life * this.rng.range(0.6, 1.2), size: this.rng.range(2.5, 6), col: cols[Math.floor(this.rng.next() * cols.length)] }); }
  }
  shake(a: number) { if (!this.reduced) this.camera.shake = Math.max(this.camera.shake, a); }

  // ---------- weapons ----------
  selectWeapon(n: number) { if (this.phase !== 'play' || n < 1 || n > this.tier || n === this.cur) return; this.cur = n; this.sfx('switch'); this.emit({ type: 'toast', key: 'sw', params: { n } }); }
  switchWeapon() { if (this.phase !== 'play') return; if (this.tier === 1) { this.sfx('ui'); return; } this.selectWeapon((this.cur % this.tier) + 1); }
  /** where the character aims: the mouse/touch point, or an assist target (nearest alive page cell on screen) */
  aimPoint(): { x: number; y: number } {
    if (this.input.aimActive) return { x: this.input.aimX, y: this.input.aimY };
    const p = this.p, ox = p.x, oy = p.y - 36; let best = -1, bd = 1e12, bestAny = -1, bdAny = 1e12;
    const vx0 = this.camera.x - 60, vx1 = this.camera.x + VIEW_W + 60, vy0 = this.camera.y - 60, vy1 = this.camera.y + VIEW_H + 60;
    for (let i = 0; i < this.cells.length; i++) { if (this.cells[i].hp <= 0) continue; const c = this.cellCenter(i), d = (c.x - ox) ** 2 + (c.y - oy) ** 2;
      if (d < bdAny) { bdAny = d; bestAny = i; } if (c.x >= vx0 && c.x <= vx1 && c.y >= vy0 && c.y <= vy1 && d < bd) { bd = d; best = i; } }
    const k = best >= 0 ? best : bestAny; if (k >= 0) return this.cellCenter(k);
    return { x: ox + p.face * 400, y: oy };
  }
  private fire() {
    const w = this.wstats(), p = this.p, kind = this.def.kind; this.fireCd = w.cd; this.shots++;
    const ap = this.aimPoint(), ox = p.x + 7 * p.face, oy = p.y - 33; let ang = Math.atan2(ap.y - oy, ap.x - ox);
    p.face = Math.cos(ang) >= 0 ? 1 : -1; p.aim = ang; p.recoil = 0.1;
    const mx = ox + Math.cos(ang) * 36, my = oy + Math.sin(ang) * 36; ang += this.rng.range(-0.02, 0.02);
    if (kind === 'beam') {
      const dx = Math.cos(ang), dy = Math.sin(ang); let hx = mx, hy = my, ci = -1;
      for (let d = 0; d < 2600; d += 8) { hx = mx + dx * d; hy = my + dy * d; const i = this.cellIndexAt(hx, hy); if (i >= 0 && this.cells[i].hp > 0) { ci = i; break; } if (hy >= FLOOR_Y || hx < 0 || hx > WORLD_W || hy < 0) break; }
      this.beams.push({ x1: mx, y1: my, x2: hx, y2: hy, life: 0.12, tier: this.cur }); this.sfx('beam');
      if (ci >= 0) { this.hits++; const k0 = this.kills; this.splash(hx, hy, ci, w); this.hitFx(hx, hy, w); if (this.kills - k0 >= 3 && p.spinT <= 0) p.spinT = 0.45; this.checkProgress(); }
      return;
    }
    const v = w.spd * (kind === 'bomb' ? 0.8 : 1);
    this.projs.push({ x: mx, y: my, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, kind, tier: this.cur, dmg: w.dmg, rad: w.rad, life: 2.4, rot: 0, trail: [] });
    if (kind === 'bolt') this.sfx(this.cur >= 3 ? 'heavy' : 'laser'); else if (kind === 'bomb') { this.sfx('heavy'); p.bubble = 0.5; } else this.sfx('hole');
    if (this.cur === 4) this.shake(3);
    this.burst(mx, my, 3, [this.def.accent, '#ffffff'], 200, 0.2, 0);
  }
  private hitFx(x: number, y: number, w: { rad: number; tier: number }) {
    const ch = this.def; this.burst(x, y, 6 + w.tier * 3, [ch.accent, ch.color, '#ffffff'], 240 + w.tier * 50, 0.5, 600);
    if (w.rad > 0) this.addFx({ type: 'ring', x, y, life: 0.35, size: w.rad + 24, col: ch.accent });
    if (w.tier >= 3) { this.sfx('boom'); this.shake(3 + w.tier); }
    if (ch.id === 'glitch') { this.laughN++; if (this.laughN % 6 === 0) { this.p.mood = 'happy'; this.p.bubble = 0.7; } }
  }
  private stepProjectiles(dt: number) {
    for (let k = this.projs.length - 1; k >= 0; k--) {
      const q = this.projs[k]; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; q.rot += dt * 12; q.trail.push(q.x, q.y); if (q.trail.length > 12) q.trail.splice(0, 2);
      const i = this.cellIndexAt(q.x, q.y); let gone = false;
      if (i >= 0 && this.cells[i].hp > 0) {
        gone = true; this.hits++; this.splash(q.x, q.y, i, q); this.hitFx(q.x, q.y, { rad: q.rad, tier: q.tier });
        if (q.kind === 'hole') this.holes.push({ x: q.x, y: q.y, t: 0, dur: 0.9, r: q.rad + 160 });
        if (q.kind === 'bomb') { this.sfx('boom'); this.shake(4); }
        this.checkProgress();
      } else if (q.y >= FLOOR_Y) { gone = true; this.burst(q.x, FLOOR_Y, 5, ['#9aa6d6', '#ffffff'], 180, 0.3, 500); }
      if (gone || q.life <= 0 || q.x < -40 || q.x > WORLD_W + 40 || q.y < -40) this.projs.splice(k, 1);
      if (this.phase !== 'play') { this.projs.length = 0; break; }
    }
    for (let k = this.beams.length - 1; k >= 0; k--) { this.beams[k].life -= dt; if (this.beams[k].life <= 0) this.beams.splice(k, 1); }
    for (let k = this.holes.length - 1; k >= 0; k--) { const h = this.holes[k]; h.t += dt; if (h.t >= h.dur) this.holes.splice(k, 1); }
  }

  // ---------- player physics ----------
  private platformsForPlayer() { const L: { x: number; y: number; w: number }[] = LEDGES.map(l => ({ x: l.x, y: l.y, w: l.w })); for (const d of this.debris) if (d.landed) L.push({ x: d.x, y: d.y, w: d.w }); return L; }
  stepPlayer(dt: number) {
    const p = this.p, ch = this.def, inp = this.input, hw = PLAYER_W / 2;
    const ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (ax) { p.vx += ax * (p.onGround ? 3400 : 2400) * dt; p.face = ax as 1 | -1; } else { const fr = (p.onGround ? 3000 : 500) * dt; p.vx = Math.abs(p.vx) <= fr ? 0 : p.vx - Math.sign(p.vx) * fr; }
    p.vx = clamp(p.vx, -ch.speed, ch.speed);
    // jump (edge) + coyote + buffer, double jump, then hold-to-fly jetpack
    if (inp.jump && !this.lastJump) this.jumpEdge = true; this.lastJump = inp.jump;
    p.jbuf -= dt; p.coyote -= dt; if (this.jumpEdge) { p.jbuf = 0.12; this.jumpEdge = false; } if (p.onGround) p.coyote = 0.09;
    if (p.jbuf > 0 && p.coyote > 0) { p.vy = -ch.jumpV; p.onGround = false; p.jumps = 1; p.jbuf = 0; p.coyote = 0; this.sfx('jump'); this.burst(p.x, p.y, 5, ['#9aa6d6'], 140, 0.3, 200); }
    else if (p.jbuf > 0 && !p.onGround && p.jumps < ch.jumps) { p.vy = -ch.jumpV * 0.88; p.jumps++; p.jbuf = 0; this.sfx('jump'); p.flame = 0.3; if (ch.id === 'nova') p.spinT = 0.45; this.burst(p.x, p.y - 10, 10, [ch.accent, '#ffffff'], 220, 0.4, 100); }
    const wantFly = (inp.jump || inp.up) && !p.onGround && p.vy > -180 && p.fuel > 0;
    if (wantFly) { p.vy = Math.max(p.vy - ch.thrust * dt, -430); p.fuel = Math.max(0, p.fuel - dt); p.flame = 0.12; if (this.rng.next() < 0.6) this.addFx({ type: 'spark', x: p.x - 8 * p.face, y: p.y - 18, vx: this.rng.range(-30, 30), vy: 220, g: 0, life: 0.3, size: 5, col: '#ff9a2e' }); }
    let g = GRAVITY; if (p.vy < 0 && !inp.jump && !inp.up) g *= 1.7; if (inp.down && !p.onGround) g *= 1.8; p.vy = Math.min(p.vy + g * dt, 1300);
    // --- X axis against page cells
    const wasGround = p.onGround; p.onGround = false;
    p.x += p.vx * dt; p.x = clamp(p.x, 20, WORLD_W - 20);
    let hit = this.solidCellsHit(p.x - hw, p.y - PLAYER_H + 2, p.x + hw, p.y - 2);
    if (hit) { const c = this.cellCenter(hit.i); if (p.vx > 0 || (p.vx === 0 && p.x < c.x)) p.x = c.x - CELL_W / 2 - hw - 0.01; else p.x = c.x + CELL_W / 2 + hw + 0.01; p.vx = 0; }
    // --- Y axis
    const prevY = p.y; p.y += p.vy * dt; p.drop -= dt;
    if (inp.down && wasGround && p.y < FLOOR_Y - 1 && p.drop <= 0) { p.drop = 0.22; p.y += 3; }
    hit = this.solidCellsHit(p.x - hw, p.y - PLAYER_H, p.x + hw, p.y);
    if (hit) { const c = this.cellCenter(hit.i); if (p.vy >= 0) { p.y = c.y - CELL_H / 2; if (p.vy > 380) this.land(); p.vy = 0; p.onGround = true; } else { p.y = c.y + CELL_H / 2 + PLAYER_H + 0.01; p.vy = 0; } }
    if (p.y >= FLOOR_Y) { p.y = FLOOR_Y; if (p.vy > 380) this.land(); p.vy = 0; p.onGround = true; }
    else if (p.vy >= 0 && p.drop <= 0 && !p.onGround) {
      for (const pl of this.platformsForPlayer()) if (p.x > pl.x - 8 && p.x < pl.x + pl.w + 8 && prevY <= pl.y + 3 && p.y >= pl.y) { p.y = pl.y; if (p.vy > 380) this.land(); p.vy = 0; p.onGround = true; break; }
    }
    if (p.y < PLAYER_H + 2) { p.y = PLAYER_H + 2; p.vy = Math.max(0, p.vy); }
    if (p.onGround) { p.jumps = 0; p.fuel = Math.min(ch.fuel, p.fuel + dt * 0.8); }
    p.squash = Math.max(0, p.squash - dt * 6); p.recoil = Math.max(0, p.recoil - dt); p.flame = Math.max(0, p.flame - dt);
    if (p.spinT > 0) { p.spinT -= dt; p.spin = (1 - Math.max(0, p.spinT) / 0.45) * 6.283; if (p.spinT <= 0) p.spin = 0; }
    if (p.bubble > 0) { p.bubble -= dt; if (p.bubble <= 0 && p.mood === 'happy' && this.phase === 'play') p.mood = 'idle'; }
    p.walk = p.onGround && Math.abs(p.vx) > 30;
  }
  private land() { this.sfx('land'); this.p.squash = 0.9; this.burst(this.p.x, this.p.y, 6, ['#9aa6d6', '#ffffff'], 160, 0.35, 300); }

  // ---------- world objects ----------
  private stepWorld(dt: number) {
    const wells = [...this.holes.map(h => ({ x: h.x, y: h.y, r: h.r, s: 2200 })), ...(this.blackHole ? [{ x: PAGE.x + PAGE.w / 2, y: PAGE.y + PAGE.h / 2, r: 2000, s: 3200 }] : [])];
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i];
      if (q.type !== 'ring' && q.type !== 'text') for (const w of wells) { const dx = w.x - q.x, dy = w.y - q.y, d = Math.hypot(dx, dy) + 1; if (d < w.r) { q.vx += dx / d * w.s * dt; q.vy += dy / d * w.s * dt; q.vx *= 0.985; q.vy *= 0.985; if (d < 18 && this.blackHole) q.life = 0; } }
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt; q.life -= dt;
      if ((q.type === 'shard') && q.y > FLOOR_Y && q.g > 0) { q.y = FLOOR_Y; q.vy *= -0.3; q.vx *= 0.7; }
      if (q.life <= 0) this.fx.splice(i, 1);
    }
    for (const d of this.debris) { d.life -= dt; if (!d.landed) { d.vy += 1700 * dt; const ny = d.y + d.vy * dt; const hitCell = this.solidCellsHit(d.x, ny + d.h - 2, d.x + d.w, ny + d.h);
      if (ny + d.h >= FLOOR_Y) { d.y = FLOOR_Y - d.h; d.landed = true; } else if (hitCell && d.vy > 0) { d.y = this.cellCenter(hitCell.i).y - CELL_H / 2 - d.h; d.landed = true; } else d.y = ny; } }
    this.debris = this.debris.filter(d => d.life > 0);
    for (const c of this.cells) { if (c.flash > 0) c.flash -= dt; if (c.glitch > 0) c.glitch -= dt; }
    this.camera.shake = Math.max(0, this.camera.shake - dt * 18);
  }
  private stepCamera(dt: number) {
    const p = this.p, cam = this.camera;
    const tx = clamp(p.x - VIEW_W / 2 + p.face * 90, 0, WORLD_W - VIEW_W), ty = clamp(p.y - VIEW_H * 0.62, 0, WORLD_H - VIEW_H), k = 1 - Math.exp(-6 * dt);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    cam.sx = cam.shake > 0 ? this.rng.range(-cam.shake, cam.shake) : 0; cam.sy = cam.shake > 0 ? this.rng.range(-cam.shake, cam.shake) : 0;
  }

  // ---------- round flow ----------
  step(dtRaw: number) {
    const dt = clamp(dtRaw, 0, 1 / 30); if (dt <= 0) return; this.t += dt;
    if (this.phase === 'ready') {
      this.stepPlayer(dt); this.stepWorld(dt); this.stepCamera(dt); this.readyLeft -= dt * 1000;
      if (this.readyLeft <= 0) { this.phase = 'play'; this.emit({ type: 'phase', phase: 'play' }); this.emit({ type: 'toast', key: 'go' }); }
      return;
    }
    if (this.phase === 'play') {
      this.elapsed += dt * 1000; this.fireCd -= dt; this.stepPlayer(dt);
      if ((this.input.fire) && this.fireCd <= 0) this.fire();
      this.stepProjectiles(dt);
      const sec = Math.ceil(this.timeLeftMs / 1000);
      if (this.phase === 'play' && sec <= 10 && sec !== this.lastSec) { if (sec >= 1) { this.sfx('tick'); this.emit({ type: 'tick', sec }); } if (sec === 10) this.emit({ type: 'toast', key: 's10' }); if (sec === 7) this.emit({ type: 'toast', key: 's10b' }); if (sec === 4) this.emit({ type: 'toast', key: 's10c' }); }
      this.lastSec = sec; this.stepWorld(dt);
      if (this.phase === 'play' && this.timeLeftMs <= 0) this.finish(false);
      this.stepCamera(dt); return;
    }
    this.stepProjectiles(dt); this.stepWorld(dt); this.stepSequence(dt); this.stepCamera(dt);
  }
  private computeResult(win: boolean): RoundResult {
    const pct = win ? 100 : Math.min(99, Math.floor(this.pctExact));
    const b = { dmg: Math.round(pct * 50), time: win ? Math.floor(this.timeLeftMs / 1000) * 40 : 0, up: this.upgrades * 250, acc: Math.round(clamp(this.shots ? this.hits / this.shots : 0, 0, 1) * 1000), win: win ? 2000 : 0 };
    return { win, score: clamp(b.dmg + b.time + b.up + b.acc + b.win, 0, MAX_SCORE), b, pct, timeMs: win ? Math.round(this.elapsed) : ROUND_MS, tier: this.tier, char: this.def.id };
  }
  /** Single entry for both terminal states. The phase guard makes victory and defeat mutually exclusive and idempotent. */
  private finish(win: boolean) {
    if (this.phase !== 'play') return;
    this.phase = win ? 'victory' : 'defeat'; this.seqStep = 0; this.seqT = 0; this.fireCd = 1e9; this.projs.length = 0; this.input.fire = false; this.p.vx = 0;
    if (!win) this.elapsed = ROUND_MS;
    this.result = this.computeResult(win);
    this.emit({ type: 'phase', phase: this.phase });
    if (win) {
      this.alive = 0; this.remaining = 0; this.blackHole = { t: 0 }; this.sfx('win'); this.emit({ type: 'toast', key: 'victory' }); this.shake(14);
      for (let i = 0; i < 6; i++) this.burst(PAGE.x + this.rng.range(100, PAGE.w - 100), PAGE.y + this.rng.range(60, PAGE.h - 60), 28, [...this.palette, '#ffd36b', '#ffffff'], 520, 1, 500);
    } else { this.sfx('hurt'); this.sfx('lose'); this.emit({ type: 'toast', key: 'defeat' }); this.p.mood = 'hurt'; this.shake(8); }
    this.emit({ type: 'end', result: this.result });
  }
  private stepSequence(dt: number) {
    if (this.phase === 'done') return;
    this.seqT += dt; const p = this.p, s = this.seqT;
    if (this.phase === 'victory') {
      if (this.blackHole) this.blackHole.t += dt;
      this.frameAlpha = Math.max(0, 1 - (this.blackHole ? this.blackHole.t / 1.3 : 0));
      if (this.seqStep === 0) {
        p.mood = 'happy'; p.bubble = 0.3; p.vy += GRAVITY * dt; p.y = Math.min(FLOOR_Y, p.y + p.vy * dt); if (p.y >= FLOOR_Y) { p.y = FLOOR_Y; p.vy = 0; p.onGround = true; if (s % 0.9 < dt * 2) { p.vy = -520; p.onGround = false; this.sfx('jump'); } }
        if (s > 1.8) { this.seqStep = 1; this.portal = { x: WORLD_W - 110, y: FLOOR_Y - 60, t: 0 }; this.sfx('load'); }
      } else if (this.seqStep === 1) { this.portal!.t += dt; if (s > 2.2) { this.seqStep = 2; this.leap = { x0: p.x, y0: p.y, t: 0, dur: 1.5 }; p.face = 1; this.sfx('jump'); } }
      else if (this.seqStep === 2 && this.leap) {
        this.portal!.t += dt; const L = this.leap; L.t += dt; const k = clamp(L.t / L.dur, 0, 1);
        p.x = L.x0 + (this.portal!.x - L.x0) * k; p.y = L.y0 + (this.portal!.y + 40 - L.y0) * k - Math.sin(k * Math.PI) * 260; p.flame = 0.2; p.onGround = false; p.scale = 1 - k * 0.7; p.aim = 0;
        if (this.rng.next() < 0.7) this.addFx({ type: 'spark', x: p.x - 12, y: p.y - 18, vy: 140, life: 0.35, size: 5, col: '#ff9a2e' });
        if (k >= 1) { this.seqStep = 3; this.doneT = 0; p.hide = true; this.addFx({ type: 'ring', x: this.portal!.x, y: this.portal!.y, life: 0.6, size: 90, col: '#27e8ff' }); this.burst(this.portal!.x, this.portal!.y, 24, ['#27e8ff', '#a35bff', '#ffffff'], 340, 0.7, 0); this.sfx('boom'); }
      } else if (this.seqStep === 3) { this.portal!.t += dt; this.doneT += dt; if (this.doneT > 0.7) { this.seqStep = 4; this.phase = 'done'; this.emit({ type: 'phase', phase: 'done' }); this.emit({ type: 'done' }); } }
    } else if (this.phase === 'defeat') {
      if (this.seqStep === 0) { p.mood = 'hurt'; if (s > 0.45) { this.seqStep = 1; this.sfx('hurt'); } }
      else if (this.seqStep === 1) { p.mood = 'dizzy'; p.spin += dt * 14; p.y -= 80 * dt; p.onGround = false; if (s > 1.7) { this.seqStep = 2; p.hide = true; const ch = this.def; this.burst(p.x, p.y - 30, 60, [ch.color, ch.accent, '#ffffff', '#ff3b4f'], 560, 1.2, 900); this.addFx({ type: 'ring', x: p.x, y: p.y - 30, life: 0.6, size: 130, col: '#ff9a2e' }); this.addFx({ type: 'text', x: p.x, y: p.y - 80, vy: -40, life: 1.2, size: 40, col: '#ffd36b', text: 'BONK!' }); this.sfx('boom'); this.shake(12); } }
      else if (this.seqStep === 2) { if (s > 2.9) { this.seqStep = 3; this.phase = 'done'; this.emit({ type: 'phase', phase: 'done' }); this.emit({ type: 'done' }); } }
    }
  }
}
