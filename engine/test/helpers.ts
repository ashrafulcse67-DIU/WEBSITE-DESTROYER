import { Simulation, Rng, emptyInput } from '../src/sim';
import { CHAR_IDS, type CharId } from '../src/constants';
export const DT = 1 / 60;
export function advance(sim: Simulation, seconds: number, each?: (sim: Simulation, i: number) => void) { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) { each?.(sim, i); sim.step(DT); } }
export function startPlay(sim: Simulation) { advance(sim, 1.7); if (sim.phase !== 'play') throw new Error('did not enter play: ' + sim.phase); }
/** A simple "human-like" bot: aims with some error, fires ~85% of the time, walks to keep targets on screen. */
export function makeBot(seed: number, opts: { err?: number; duty?: number } = {}) {
  const r = new Rng(seed), err = opts.err ?? 0.03, duty = opts.duty ?? 0.85; let hold = 0, burst = true;
  return (sim: Simulation) => {
    const inp = emptyInput(); sim.input = inp; if (sim.phase !== 'play') return;
    const t = (() => { sim.input.aimActive = false; const a = sim.aimPoint(); return a; })();
    const p = sim.p; const dx = t.x - p.x, dy = t.y - (p.y - 36), ang = Math.atan2(dy, dx) + r.range(-err, err), dist = Math.hypot(dx, dy);
    inp.aimActive = true; inp.aimX = p.x + Math.cos(ang) * dist; inp.aimY = p.y - 36 + Math.sin(ang) * dist;
    hold -= DT; if (hold <= 0) { burst = r.next() < duty; hold = r.range(0.3, 0.9); } inp.fire = burst;
    if (Math.abs(dx) > 520) { inp.right = dx > 0; inp.left = dx < 0; }
    if (dy < -520 && p.onGround) inp.jump = true;
    if (dy < -380 && !p.onGround) { inp.jump = true; }
  };
}
export function playBot(charId: CharId, seed: number, maxSec = 75) {
  const sim = new Simulation({ charId, seed }); const bot = makeBot(seed * 7 + 1); const types: string[] = [];
  let t = 0; while (t < maxSec && sim.phase !== 'done') { bot(sim); sim.step(DT); t += DT; for (const e of sim.drain()) types.push(e.type + (e.type === 'phase' ? ':' + e.phase : '')); }
  return { sim, types, t };
}
export { CHAR_IDS };
