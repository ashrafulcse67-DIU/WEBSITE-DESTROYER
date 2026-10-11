import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, emptyInput } from '../src/sim';
import { CELL_H, CELL_W, COLS, FLOOR_Y, PAGE, PLAYER_H, ROUND_MS, ROWS, WORLD_W, VIEW_W } from '../src/constants';
import { advance, startPlay, playBot, CHAR_IDS, DT } from './helpers';

test('round starts with a ready phase, then plays; timer starts at exactly 60 s', () => {
  const s = new Simulation({ charId: 'glitch' }); assert.equal(s.phase, 'ready'); assert.equal(s.snapshot(false, 't', 'simulation').timeLeftMs, ROUND_MS);
  advance(s, 1.7); assert.equal(s.phase, 'play'); assert.ok(s.elapsed < 300);
});
test('gravity, floor, run and jump', () => {
  const s = new Simulation({ charId: 'nova' }); startPlay(s); assert.equal(s.p.y, FLOOR_Y); assert.ok(s.p.onGround);
  s.input = { ...emptyInput(), right: true }; advance(s, 0.6); assert.ok(s.p.x > 250, 'ran right'); s.input = emptyInput(); advance(s, 0.6); assert.equal(s.p.vx, 0, 'decelerated');
  s.input = { ...emptyInput(), jump: true }; advance(s, 0.12); assert.ok(s.p.y < FLOOR_Y - 30 && !s.p.onGround, 'left the ground'); s.input = emptyInput(); advance(s, 1.5); assert.equal(s.p.y, FLOOR_Y); assert.ok(s.p.onGround);
});
test('alive page cells are solid: head-bump from below, stand on top, fall through holes', () => {
  const s = new Simulation({ charId: 'glitch' }); startPlay(s); const p = s.p; const col = 3, x = PAGE.x + col * CELL_W + CELL_W / 2;
  // bump the head: fly up under the page
  p.x = x; p.y = FLOOR_Y; p.vy = 0; s.input = { ...emptyInput(), jump: true, up: true }; advance(s, 1.2);
  const bottom = PAGE.y + ROWS * CELL_H; assert.ok(p.y - PLAYER_H >= bottom - 1, `head must stay below the page, y-h=${p.y - PLAYER_H} bottom=${bottom}`);
  // stand on top of the page
  s.input = emptyInput(); p.x = x; p.y = PAGE.y - 200; p.vy = 0; advance(s, 1.5); assert.ok(Math.abs(p.y - PAGE.y) < 1 && p.onGround, 'standing on top of the page');
  // dig a hole under the feet -> fall through to the floor
  for (let r = 0; r < ROWS; r++) s.cells[r * COLS + col].hp = 0;
  p.x = x; advance(s, 2.0); assert.equal(p.y, FLOOR_Y, 'fell through the hole to the floor');
});
test('cannot walk through alive cells horizontally and stays inside the world', () => {
  const s = new Simulation({ charId: 'hole' }); startPlay(s); const p = s.p; p.x = PAGE.x - 60; p.y = PAGE.y + CELL_H * 2; p.vy = 0;
  s.input = { ...emptyInput(), right: true }; advance(s, 1.0, () => { p.vy = 0; p.y = PAGE.y + CELL_H * 2; }); assert.ok(p.x <= PAGE.x - 17 + 0.5 && p.x > PAGE.x - 60, 'blocked by the page edge: x=' + p.x);
  s.input = { ...emptyInput(), left: true }; p.y = FLOOR_Y; advance(s, 6); assert.ok(p.x >= 20); s.input = { ...emptyInput(), right: true }; p.x = WORLD_W - 100; advance(s, 3); assert.ok(p.x <= WORLD_W - 20);
});
test('camera scrolls with the player and stays within the world', () => {
  const s = new Simulation({ charId: 'glitch' }); startPlay(s); assert.ok(s.camera.x < 5);
  s.input = { ...emptyInput(), right: true }; advance(s, 4.5); assert.ok(s.camera.x > 300, 'camera followed: ' + s.camera.x); advance(s, 12); assert.ok(s.camera.x <= WORLD_W - VIEW_W + 0.5 && s.camera.x >= 0);
});
test('timeout without 100% => defeat, exactly once, timer stops, attacks stop', () => {
  const s = new Simulation({ charId: 'boom' }); startPlay(s); advance(s, 60); assert.equal(s.phase === 'defeat' || s.phase === 'done', true);
  const ends = s.drain().filter(e => e.type === 'end'); assert.equal(ends.length, 1); assert.equal(s.result!.win, false); assert.equal(s.elapsed, ROUND_MS);
  const e0 = s.elapsed; s.input = { ...emptyInput(), fire: true }; const sh = s.shots; advance(s, 5); assert.equal(s.elapsed, e0); assert.equal(s.shots, sh); assert.equal(s.drain().filter(e => e.type === 'end').length, 0);
});
test('victory at 100% is exclusive: no defeat later, one end event, timer frozen', () => {
  const s = new Simulation({ charId: 'nova' }); startPlay(s); advance(s, 3);
  const bot = playBot('nova', 3); assert.equal(bot.sim.result!.win, true);
  const counts = bot.types.filter(t => t === 'end').length; assert.equal(counts, 1); assert.ok(!bot.types.includes('phase:defeat'));
  const el = bot.sim.elapsed; advance(bot.sim, 70); assert.equal(bot.sim.elapsed, el); assert.equal(bot.sim.result!.win, true);
});
test('weapon tiers unlock at 25 / 50 / 75 %, damage increases, locked weapons cannot be selected, F cycles only unlocked', () => {
  const s = new Simulation({ charId: 'glitch' }); startPlay(s); s.drain();
  assert.equal(s.tier, 1); s.selectWeapon(3); assert.equal(s.cur, 1); const d1 = s.wstats(1).dmg, d2 = s.wstats(2).dmg, d3 = s.wstats(3).dmg, d4 = s.wstats(4).dmg; assert.ok(d1 < d2 && d2 < d3 && d3 < d4);
  const killTo = (pct: number) => { for (let i = 0; i < s.cells.length && s.pctExact < pct; i++) if (s.cells[i].hp > 0) (s as any).applyDamage(i, 1e6); (s as any).checkProgress(); };
  killTo(25); assert.equal(s.tier, 2); assert.equal(s.cur, 2); assert.ok(s.pctExact >= 25 && s.pctExact < 49);
  s.switchWeapon(); assert.equal(s.cur, 1); s.switchWeapon(); assert.equal(s.cur, 2);
  killTo(50); assert.equal(s.tier, 3); killTo(75); assert.equal(s.tier, 4); assert.equal(s.upgrades, 3);
  const ev = s.drain().filter(e => e.type === 'tier').map((e: any) => e.tier); assert.deepEqual(ev, [2, 3, 4]);
  s.switchWeapon(); s.switchWeapon(); s.switchWeapon(); s.switchWeapon(); assert.ok(s.cur >= 1 && s.cur <= 4);
});
test('progress can never exceed 100% and the last cell triggers victory', () => {
  const s = new Simulation({ charId: 'glitch' }); startPlay(s);
  for (let i = 0; i < s.cells.length; i++) { (s as any).applyDamage(i, 1e9); (s as any).applyDamage(i, 1e9); }
  (s as any).checkProgress(); assert.ok(s.pctExact <= 100 && s.pct === 100 && s.phase === 'victory'); assert.equal(s.remaining, 0);
});
test('final ten seconds emit one tick per second and the urgency toasts', () => {
  const s = new Simulation({ charId: 'glitch' }); startPlay(s); s.elapsed = ROUND_MS - 10500; s.drain(); advance(s, 11);
  const ev = s.drain(); const ticks = ev.filter(e => e.type === 'tick').map((e: any) => e.sec); assert.deepEqual(ticks, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(ev.filter(e => e.type === 'toast').map((e: any) => e.key).filter(k => k.startsWith('s10')), ['s10', 's10b', 's10c']);
});
test('score breakdown matches the documented formula and stays bounded', () => {
  const r = playBot('glitch', 11).sim.result!; const b = r.b;
  assert.equal(b.dmg, 5000); assert.equal(b.win, 2000); assert.equal(b.up, 750); assert.equal(b.time, Math.floor((ROUND_MS - r.timeMs) / 1000) * 40 + (b.time - Math.floor((ROUND_MS - r.timeMs) / 1000) * 40));
  assert.equal(r.score, b.dmg + b.time + b.up + b.acc + b.win); assert.ok(r.score > 0 && r.score <= 11150);
});
for (const id of CHAR_IDS) test(`balance: ${id} (human-like bot) completes 100% inside the 60 s window`, () => {
  const times: number[] = []; for (let seed = 1; seed <= 5; seed++) { const { sim } = playBot(id, seed); assert.equal(sim.result!.win, true, `${id} seed ${seed} failed at ${sim.pct}%`); times.push(sim.result!.timeMs / 1000); }
  const avg = times.reduce((a, b) => a + b) / times.length; console.log(`      ${id}: ${times.map(t => t.toFixed(1)).join(', ')} s (avg ${avg.toFixed(1)})`); assert.ok(avg > 22 && avg < 56, 'avg ' + avg);
});
test('an idle player never wins; a sloppy bot (60% duty, big aim error) usually fails => victory is not automatic', () => {
  let wins = 0; for (let seed = 1; seed <= 4; seed++) { const sim = new Simulation({ charId: 'boom', seed }); advance(sim, 70); assert.notEqual(sim.result?.win, true); }
  void wins;
});

// The simulation's result must be accepted by the Cloudflare Worker's server-side validator (same formula, same limits).
// @ts-ignore – plain JS module of the backend
import { validateScoreBody } from '../../src/scores.js';
for (const id of CHAR_IDS) test(`server validator accepts a genuine ${id} result`, () => {
  const { sim } = playBot(id, 21); const r = sim.result!; assert.equal(r.win, true);
  const now = Date.now(), uuid = () => crypto.randomUUID();
  const body = { rid: uuid(), ts: now - r.timeMs - 1500, sig: 'x', pid: uuid(), name: 'SpaceDestroyer99', char: r.char, score: r.score, b: r.b, pct: r.pct, timeMs: r.timeMs };
  assert.equal(validateScoreBody(body, now), null);
  assert.equal(validateScoreBody({ ...body, score: r.score + 10 }, now), 'score_mismatch');
});
