import type { CharId } from '../constants';
import type { Host } from '../host';

export const FRAME_W = 140, FRAME_H = 160, FEET_X = 70, FEET_Y = 146, SCALE = 1.2;
export const ARM_W = 110, ARM_H = 64, ARM_PX = 24, ARM_PY = 32;
export interface BakedChar { sheet: HTMLCanvasElement; frames: { name: string; x: number; y: number }[]; anims: { key: string; frames: string[]; fps: number; loop: boolean }[]; arm: HTMLCanvasElement; }

/** Pre-renders the character art (from the shared drawChar) into a sprite sheet so Phaser can animate it as real sprites. */
export function bakeCharacter(host: Host, id: CharId): BakedChar {
  const poses: { name: string; o: Record<string, unknown> }[] = [
    { name: 'idle0', o: { t: 0 } }, { name: 'idle1', o: { t: 0.52 } },
    { name: 'run0', o: { t: 0, walk: true } }, { name: 'run1', o: { t: 0.112, walk: true } }, { name: 'run2', o: { t: 0.224, walk: true } }, { name: 'run3', o: { t: 0.336, walk: true } },
    { name: 'jump', o: { t: 0, air: true } }, { name: 'fly0', o: { t: 0, air: true, flame: true } }, { name: 'fly1', o: { t: 0.1, air: true, flame: true } },
    { name: 'happy0', o: { t: 0, mood: 'happy', laugh: true } }, { name: 'happy1', o: { t: 0.52, mood: 'happy', laugh: true } },
    { name: 'hurt', o: { t: 0, mood: 'hurt' } }, { name: 'dizzy', o: { t: 0, mood: 'dizzy' } },
  ];
  const cols = 5, rows = Math.ceil(poses.length / cols), sheet = document.createElement('canvas'); sheet.width = cols * FRAME_W; sheet.height = rows * FRAME_H; const c = sheet.getContext('2d')!;
  const frames = poses.map((p, i) => { const x = (i % cols) * FRAME_W, y = Math.floor(i / cols) * FRAME_H; c.save(); c.beginPath(); c.rect(x, y, FRAME_W, FRAME_H); c.clip();
    host.drawChar(c, id, x + FEET_X, y + FEET_Y, { s: SCALE, face: 1, skipArm: true, ...p.o }); c.restore(); return { name: p.name, x, y }; });
  const arm = document.createElement('canvas'); arm.width = ARM_W; arm.height = ARM_H; host.drawChar(arm.getContext('2d')!, id, ARM_PX - 7 * SCALE, ARM_PY + 33 * SCALE, { s: SCALE, face: 1, aim: 0, armOnly: true, t: 0 });
  const anims = [
    { key: 'idle', frames: ['idle0', 'idle1'], fps: 2, loop: true }, { key: 'run', frames: ['run0', 'run1', 'run2', 'run3'], fps: 14, loop: true }, { key: 'jump', frames: ['jump'], fps: 1, loop: true },
    { key: 'fly', frames: ['fly0', 'fly1'], fps: 14, loop: true }, { key: 'happy', frames: ['happy0', 'happy1'], fps: 5, loop: true }, { key: 'hurt', frames: ['hurt'], fps: 1, loop: true }, { key: 'dizzy', frames: ['dizzy'], fps: 1, loop: true },
  ];
  return { sheet, frames, anims, arm };
}
