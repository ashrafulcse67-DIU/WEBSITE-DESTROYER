// Phaser 3 renderer. Phaser provides the game loop, WebGL/Canvas renderer, scaling (FIT), camera, textures, sprites and animations.
// All gameplay state comes from the Simulation; this class only draws it. If anything here throws, the Engine switches to the Canvas renderer.
import { CELL_H, CELL_W, COLS, FLOOR_Y, LEDGES, PAGE, ROWS, VIEW_H, VIEW_W, WORLD_H, WORLD_W, CHARS } from '../constants';
import type { Host, Renderer, StartOptions } from '../host';
import type { Simulation } from '../sim';
import { bakeCharacter, ARM_H, ARM_PX, ARM_PY, ARM_W, FEET_X, FEET_Y, FRAME_H, FRAME_W } from './bake';

const hex = (css: string): number => parseInt(css.replace('#', '').slice(0, 6), 16);
type Any = any;

export class PhaserRenderer implements Renderer {
  readonly name = 'phaser'; readonly drivesLoop = true;
  private game: Any = null; private scene: Any = null; private dead = false;
  private o: Record<string, Any> = {};
  constructor(private P: Any, private host: Host, private root: HTMLElement, private sim: Simulation, private opts: StartOptions, private label: () => string,
    private hooks: { frame(dtMs: number): void; fail(err: unknown): void }) {}

  init(): Promise<void> {
    const self = this, P = this.P;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Phaser did not start in time')), 7000);
      class GameScene extends P.Scene {
        constructor() { super({ key: 'game' }); }
        create() { try { self.scene = this; self.build(this); clearTimeout(timer); resolve(); } catch (e) { clearTimeout(timer); reject(e); } }
        update(_t: number, delta: number) { if (self.dead) return; try { self.hooks.frame(delta); } catch (e) { self.dead = true; self.hooks.fail(e); } }
      }
      try {
        this.game = new P.Game({
          type: P.AUTO, parent: this.root, width: VIEW_W, height: VIEW_H, backgroundColor: '#05060f', banner: false, audio: { noAudio: true },
          scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH }, input: { keyboard: false, mouse: false, touch: false, gamepad: false },
          render: { antialias: true, roundPixels: false }, scene: [GameScene],
        });
      } catch (e) { clearTimeout(timer); reject(e); }
    });
  }

  private build(sc: Any) {
    const o = this.o, sim = this.sim, page = this.opts.page, host = this.host;
    // --- background (parallax, screen-space)
    const bgC = document.createElement('canvas'); bgC.width = 1700; bgC.height = 960; host.drawSpace(bgC.getContext('2d')!, 1700, 960, 3, false);
    sc.textures.addCanvas('bg', bgC); o.bg = sc.add.image(0, 0, 'bg').setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    // --- static world: floor, ledges (Mario-style floating platforms + mystery blocks)
    const g = sc.add.graphics().setDepth(1); g.fillStyle(0x151a4d, 1); g.fillRect(-50, FLOOR_Y, WORLD_W + 100, 120); g.lineStyle(4, 0x27e8ff, 1); g.lineBetween(-50, FLOOR_Y, WORLD_W + 50, FLOOR_Y);
    for (const l of LEDGES) {
      if ((l as any).type === 'mystery') {
        // classic Mario "?" block — gold with a question mark
        g.fillStyle(0xffd36b, 1); g.fillRoundedRect(l.x, l.y - 24, l.w, 24, 5);
        g.lineStyle(3, 0x0a0a1e, 1); g.strokeRoundedRect(l.x, l.y - 24, l.w, 24, 5);
        g.fillStyle(0xb8860b, 1); g.fillRect(l.x + 4, l.y - 22, l.w - 8, 3); g.fillRect(l.x + 4, l.y - 8, l.w - 8, 3);
        o.mysteryTexts = o.mysteryTexts || [];
        o.mysteryTexts.push(sc.add.text(l.x + l.w / 2, l.y - 12, '?', { fontFamily: "'Bangers','Baloo Da 2',cursive", fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#0a0a1e', strokeThickness: 3 }).setOrigin(0.5, 0.5).setDepth(1.1));
      } else {
        g.fillStyle(0x1b2260, 1); g.fillRoundedRect(l.x, l.y, l.w, 14, 6); g.lineStyle(3, 0x0a0a1e, 1); g.strokeRoundedRect(l.x, l.y, l.w, 14, 6);
        g.fillStyle(0xa35bff, 1); g.fillRect(l.x + 6, l.y + 1, l.w - 12, 3);
        g.lineStyle(2, 0x0a0a1e, 0.45);
        for (let bx = l.x + 30; bx < l.x + l.w - 10; bx += 30) g.lineBetween(bx, l.y + 2, bx, l.y + 12);
      }
    }
    // --- browser chrome
    o.chrome = sc.add.graphics().setDepth(1.2); o.chrome.fillStyle(0xe3e8fb, 1); o.chrome.fillRoundedRect(PAGE.x - 8, PAGE.y - 58, PAGE.w + 16, PAGE.h + 66, 18); o.chrome.lineStyle(4, 0x0a0a1e, 1); o.chrome.strokeRoundedRect(PAGE.x - 8, PAGE.y - 58, PAGE.w + 16, PAGE.h + 66, 18);
    [0xff5f57, 0xffbd2e, 0x28c840].forEach((col, i) => { o.chrome.fillStyle(col, 1); o.chrome.fillCircle(PAGE.x + 22 + i * 24, PAGE.y - 30, 8); });
    o.chrome.fillStyle(0xffffff, 1); o.chrome.fillRoundedRect(PAGE.x + 110, PAGE.y - 46, PAGE.w - 360, 32, 16);
    o.chrome.fillStyle(this.opts.mode !== 'simulation' ? 0x17c978 : 0xff9a2e, 1); o.chrome.fillRoundedRect(PAGE.x + PAGE.w - 236, PAGE.y - 46, 224, 32, 16);
    o.url = sc.add.text(PAGE.x + 128, PAGE.y - 45, '🔒 ' + this.opts.domain, { fontFamily: 'Fredoka, sans-serif', fontSize: '18px', color: '#3a4270', fixedWidth: PAGE.w - 400 }).setDepth(1.3);
    o.lbl = sc.add.text(PAGE.x + PAGE.w - 124, PAGE.y - 29, this.label(), { fontFamily: 'Fredoka, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#04122a' }).setOrigin(0.5, 0.5).setDepth(1.3);
    o.void = sc.add.graphics().setDepth(1.5); o.voidMask = null;
    // --- page cells (frames of the page texture)
    sc.textures.addCanvas('page', page); const tex = sc.textures.get('page'), sw = page.width / COLS, sh = page.height / ROWS; o.cells = [];
    for (let i = 0; i < COLS * ROWS; i++) { tex.add('c' + i, 0, (i % COLS) * sw, Math.floor(i / COLS) * sh, sw, sh); o.cells.push(sc.add.image(PAGE.x + (i % COLS) * CELL_W, PAGE.y + Math.floor(i / COLS) * CELL_H, 'page', 'c' + i).setOrigin(0, 0).setDisplaySize(CELL_W + 0.6, CELL_H + 0.6).setDepth(2)); }
    o.dmg = sc.add.graphics().setDepth(3); o.world = sc.add.graphics().setDepth(4); o.fx = sc.add.graphics().setDepth(8); o.shards = []; o.over = sc.add.graphics().setScrollFactor(0).setDepth(20);
    // --- player: baked sprite sheet + animations, separate aiming arm
    const baked = bakeCharacter(host, sim.def.id), key = 'ch_' + sim.def.id; sc.textures.addCanvas(key, baked.sheet); const ct = sc.textures.get(key);
    for (const f of baked.frames) ct.add(f.name, 0, f.x, f.y, FRAME_W, FRAME_H);
    for (const a of baked.anims) sc.anims.create({ key: key + '_' + a.key, frames: a.frames.map(n => ({ key, frame: n })), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
    sc.textures.addCanvas(key + '_arm', baked.arm);
    o.key = key; o.body = sc.add.sprite(0, 0, key, 'idle0').setOrigin(FEET_X / FRAME_W, FEET_Y / FRAME_H).setDepth(6); o.body.play(key + '_idle');
    o.arm = sc.add.image(0, 0, key + '_arm').setOrigin(ARM_PX / ARM_W, ARM_PY / ARM_H).setDepth(6.1);
    o.bubble = sc.add.text(0, 0, '', { fontFamily: 'Fredoka, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#0a0a1e', backgroundColor: '#ffffff', padding: { x: 8, y: 4 } }).setOrigin(0.5, 1).setDepth(9).setVisible(false);
    o.pop = sc.add.text(0, 0, '', { fontFamily: 'Bangers, cursive', fontSize: '44px', color: '#ffd36b', stroke: '#0a0a1e', strokeThickness: 7 }).setOrigin(0.5, 0.5).setDepth(9).setVisible(false);
    o.anim = ''; sc.cameras.main.setScroll(0, WORLD_H - VIEW_H);
  }

  render() {
    const sc = this.scene; if (!sc || this.dead) return; const o = this.o, s = this.sim, cam = s.camera, p = s.p, def = CHARS[s.def.id];
    sc.cameras.main.setScroll(cam.x + cam.sx, cam.y + cam.sy);
    o.bg.setPosition(-cam.x * 0.07, -cam.y * 0.07);
    // Mario "?" blocks bounce gently
    if (o.mysteryTexts) { let mi = 0; for (const l of LEDGES) { if ((l as any).type !== 'mystery' || !o.mysteryTexts[mi]) continue; o.mysteryTexts[mi].y = l.y - 12 + Math.sin(s.t * 3 + l.x * 0.1) * 2; mi++; } }
    const a = s.frameAlpha; o.chrome.setAlpha(a); o.url.setAlpha(a); o.lbl.setAlpha(a);
    // void swirl behind the page
    const v = o.void; v.clear(); v.fillStyle(0x04030c, a); v.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h); const bx = PAGE.x + PAGE.w / 2, by = PAGE.y + PAGE.h / 2;
    for (let i = 0; i < 5; i++) { v.lineStyle(4, 0x7a3cff, Math.max(0, 0.45 - i * 0.07) * a); v.strokeEllipse(bx, by, (150 + i * 90) * 2, (50 + i * 36) * 2); }
    // cells
    const d = o.dmg; d.clear(); const maxHp = s.total / s.cells.length;
    for (let i = 0; i < s.cells.length; i++) {
      const cl = s.cells[i], im = o.cells[i]; if (cl.hp <= 0) { if (im.visible) im.setVisible(false); continue; } if (!im.visible) im.setVisible(true); im.setAlpha(a);
      const x = PAGE.x + (i % COLS) * CELL_W, y = PAGE.y + Math.floor(i / COLS) * CELL_H, jx = cl.glitch > 0 ? ((i * 7919 + Math.floor(s.t * 30)) % 9) - 4 : 0; im.x = x + jx;
      const dm = 1 - cl.hp / maxHp; if (dm > 0.001) { d.fillStyle(0x000000, dm * 0.4); d.fillRect(x, y, CELL_W, CELL_H); d.lineStyle(2, 0x0a0a1e, 0.8); const n = Math.ceil(dm * 4); for (let k = 0; k < n; k++) { const an = i * 2.399 + k * 2.1; d.lineBetween(x + CELL_W / 2, y + CELL_H / 2, x + CELL_W / 2 + Math.cos(an) * CELL_W * 0.55, y + CELL_H / 2 + Math.sin(an) * CELL_H * 0.55); } }
      if (cl.flash > 0) { d.fillStyle(0xffffff, Math.min(1, cl.flash * 5)); d.fillRect(x, y, CELL_W, CELL_H); }
      if (cl.glitch > 0) { d.lineStyle(3, 0x27e8ff, 0.9); d.strokeRect(x + jx + 3, y, CELL_W, CELL_H); d.lineStyle(3, 0xff4fd8, 0.8); d.strokeRect(x - jx - 3, y + 2, CELL_W, CELL_H); }
    }
    // dynamic world: debris, holes, portal, beams, projectiles
    const w = o.world; w.clear();
    for (const db of s.debris) { w.fillStyle(0x1b2260, Math.min(1, db.life) * 0.95); w.fillRoundedRect(db.x, db.y, db.w, db.h, 6); w.fillStyle(hex(s.palette[0]), Math.min(1, db.life)); w.fillRect(db.x + 5, db.y + 1, db.w - 10, 3); }
    if (s.blackHole) { const k = Math.min(1, s.blackHole.t / 1.1), r = 30 + k * 260; w.fillStyle(0x000000, 0.95); w.fillCircle(bx, by, r); w.lineStyle(4, 0xff9a2e, 0.7); for (let i = 0; i < 3; i++) w.strokeEllipse(bx, by, r * (1.2 + i * 0.25) * 2, r * (0.4 + i * 0.1) * 2); }
    for (const h of s.holes) { const r = 52 * Math.sin(h.t / h.dur * Math.PI) + 10; w.fillStyle(0x000000, 0.95); w.fillCircle(h.x, h.y, r); w.lineStyle(3, 0xff4fd8, 1); w.strokeEllipse(h.x, h.y, r * 3, r * 1.1); }
    if (s.portal) { const q = s.portal, r = 52 + Math.sin(q.t * 8) * 4; w.fillStyle(0x27e8ff, 0.8); w.fillEllipse(q.x, q.y, r * 1.6, r * 2.6); w.fillStyle(0xffffff, 0.9); w.fillEllipse(q.x, q.y, r * 0.7, r * 1.4); w.lineStyle(5, 0xa35bff, 1); w.strokeEllipse(q.x, q.y, r * 1.4, r * 2.3); }
    for (const b of s.beams) { const ww = 4 + b.tier * 4, al = b.life / 0.12; w.lineStyle(ww * 2.4, 0xff4fd8, al * 0.6); w.lineBetween(b.x1, b.y1, b.x2, b.y2); w.lineStyle(ww, 0xffffff, al); w.lineBetween(b.x1, b.y1, b.x2, b.y2); }
    for (const q of s.projs) { const r = 5 + q.tier * 2.4; w.lineStyle(r, hex(def.accent), 0.5); for (let i = 2; i < q.trail.length; i += 2) w.lineBetween(q.trail[i - 2], q.trail[i - 1], q.trail[i], q.trail[i + 1]);
      if (q.kind === 'bolt') { w.fillStyle(0xffffff, 1); w.fillCircle(q.x, q.y, r * 1.1); } else if (q.kind === 'bomb') { w.fillStyle(0x2b2f55, 1); w.fillCircle(q.x, q.y, r * 1.6); w.fillStyle(0xff3b4f, 1); w.fillRect(q.x - 3, q.y - 3, 6, 6); } else { w.fillStyle(0x14101f, 1); w.fillCircle(q.x, q.y, r * 1.3); w.lineStyle(3, 0xff4fd8, 1); w.strokeCircle(q.x, q.y, r * 1.3); } }
    // fx (shards use real page frames as images, the rest are vector shapes)
    const f = o.fx; f.clear(); let si = 0, popShown = false;
    for (const q of s.fx) { const al = Math.max(0, Math.min(1, q.life / q.max));
      if (q.type === 'shard') { let im = o.shards[si]; if (!im) { im = sc.add.image(0, 0, 'page', 'c' + q.cell).setDepth(7); o.shards[si] = im; } si++; im.setVisible(true).setFrame('c' + q.cell).setPosition(q.x, q.y).setRotation(q.rot).setAlpha(al).setDisplaySize(CELL_W * q.size * 1.3, CELL_H * q.size * 1.3); }
      else if (q.type === 'spark' || q.type === 'dust') { f.fillStyle(hex(q.col), al); f.fillCircle(q.x, q.y, q.size * (0.4 + al * 0.6)); }
      else if (q.type === 'ring') { f.lineStyle(5, hex(q.col), al); f.strokeCircle(q.x, q.y, q.size * (1 - al) + 8); }
      else if (q.type === 'text') { popShown = true; o.pop.setText(q.text).setPosition(q.x, q.y).setAlpha(al).setVisible(true); } }
    for (let i = si; i < o.shards.length; i++) if (o.shards[i].visible) o.shards[i].setVisible(false);
    if (!popShown && o.pop.visible) o.pop.setVisible(false);
    // player
    const body = o.body, arm = o.arm; const sc2 = 1.0 * p.scale;
    body.setVisible(!p.hide).setPosition(p.x, p.y).setScale(sc2 * (1 + p.squash * 0.25), sc2 * (1 - p.squash * 0.25)).setFlipX(p.face < 0).setRotation(p.spin);
    const flying = !p.onGround && (s.input.jump || s.input.up) && p.fuel > 0 && p.vy < 0 || p.flame > 0;
    const want = p.mood === 'hurt' ? 'hurt' : p.mood === 'dizzy' ? 'dizzy' : (s.phase === 'victory' || (p.bubble > 0 && s.phase === 'play')) ? 'happy' : flying ? 'fly' : !p.onGround ? 'jump' : p.walk ? 'run' : 'idle';
    if (o.anim !== want) { o.anim = want; body.play(o.key + '_' + want, true); }
    const showArm = !p.hide && p.mood !== 'dizzy' && p.mood !== 'hurt'; arm.setVisible(showArm);
    if (showArm) { const k = sc2 * 1.0, f1 = p.face; arm.setPosition(p.x + 7 * 1.2 * k * f1, p.y - 33 * 1.2 * k).setScale(k).setFlipX(f1 < 0); const ang = Math.atan2(Math.sin(p.aim), Math.cos(p.aim) * f1); arm.setRotation(f1 < 0 ? -ang : ang); }
    if (p.bubble > 0 && !p.hide) o.bubble.setText(this.host.laugh(s.def.id)).setPosition(p.x, p.y - 100).setVisible(true); else o.bubble.setVisible(false);
    // screen-space overlays
    const ov = o.over; ov.clear();
    if (s.phase === 'play' && s.timeLeftMs <= 10000) { const pu = 0.3 + 0.25 * Math.abs(Math.sin(s.t * 6)); for (const [x, y, w2, h2, up] of [[0, 0, VIEW_W, 110, true], [0, VIEW_H - 110, VIEW_W, 110, false]] as [number, number, number, number, boolean][]) { if (up) ov.fillGradientStyle(0xff2840, 0xff2840, 0xff2840, 0xff2840, pu, pu, 0, 0); else ov.fillGradientStyle(0xff2840, 0xff2840, 0xff2840, 0xff2840, 0, 0, pu, pu); ov.fillRect(x, y, w2, h2); } }
    if (s.phase === 'ready') { ov.fillStyle(0x000000, 0.3); ov.fillRect(0, 0, VIEW_W, VIEW_H); }
  }
  destroy() { this.dead = true; try { this.game?.destroy(true); } catch { /* ignore */ } this.game = null; this.scene = null; }
}
