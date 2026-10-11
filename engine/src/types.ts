import type { CharId, WeaponKind } from './constants';

export type Phase = 'ready' | 'play' | 'victory' | 'defeat' | 'done';
export type SfxName = 'laser' | 'heavy' | 'boom' | 'beam' | 'hole' | 'glitch' | 'switch' | 'unlock' | 'jump' | 'land' | 'hurt' | 'tick' | 'win' | 'lose' | 'load' | 'ui';
export type TargetMode = 'capture' | 'simulation';

export interface InputState { left: boolean; right: boolean; up: boolean; down: boolean; jump: boolean; fire: boolean; aimX: number; aimY: number; aimActive: boolean; }
export interface ScoreBreakdown { dmg: number; time: number; up: number; acc: number; win: number; }
export interface RoundResult { win: boolean; score: number; b: ScoreBreakdown; pct: number; timeMs: number; tier: number; char: CharId; }

export type GameEvent =
  | { type: 'sfx'; name: SfxName }
  | { type: 'toast'; key: string; params?: Record<string, string | number> }
  | { type: 'phase'; phase: Phase }
  | { type: 'tier'; tier: number }
  | { type: 'tick'; sec: number }
  | { type: 'end'; result: RoundResult }
  | { type: 'done' };

export interface Player {
  x: number; y: number; vx: number; vy: number; face: 1 | -1; onGround: boolean; jumps: number; coyote: number; jbuf: number; fuel: number; drop: number;
  squash: number; recoil: number; spin: number; spinT: number; flame: number; hide: boolean; scale: number; mood: 'idle' | 'happy' | 'hurt' | 'dizzy'; bubble: number; aim: number; walk: boolean; jumpHeld: boolean;
}
export interface Cell { hp: number; flash: number; glitch: number; }
export interface Projectile { x: number; y: number; vx: number; vy: number; kind: WeaponKind; tier: number; dmg: number; rad: number; life: number; rot: number; trail: number[]; }
export interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; tier: number; }
export interface Hole { x: number; y: number; t: number; dur: number; r: number; }
export interface Debris { x: number; y: number; w: number; h: number; vy: number; landed: boolean; life: number; cell: number; }
/** Visual-only particles. They live in the simulation so every renderer draws exactly the same thing. */
export interface Fx { type: 'spark' | 'shard' | 'ring' | 'text' | 'dust'; x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; size: number; rot: number; vr: number; col: string; cell: number; text: string; }
export interface Portal { x: number; y: number; t: number; }

export interface Snapshot {
  phase: Phase; paused: boolean; timeLeftMs: number; elapsedMs: number; pct: number; pctExact: number; tier: number; cur: number; unlocked: number;
  score: number; alive: number; totalCells: number; weaponDmg: number; nextMilestone: number | null; shots: number; hits: number; fuel: number; final10: boolean; renderer: string; mode: TargetMode;
}
