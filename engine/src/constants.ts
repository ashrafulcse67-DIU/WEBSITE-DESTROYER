// Shared constants of the side-scrolling world. Everything here is pure data (no DOM, no Phaser).
export type CharId = 'glitch' | 'boom' | 'nova' | 'hole';
export const CHAR_IDS: CharId[] = ['glitch', 'boom', 'nova', 'hole'];
export type WeaponKind = 'bolt' | 'bomb' | 'beam' | 'hole';

export const VIEW_W = 1440, VIEW_H = 810;            // what the camera shows
export const WORLD_W = 2400, WORLD_H = 1100;         // the whole level
export const FLOOR_Y = 1040;                         // top of the ground
export const PAGE = { x: 255, y: 70, w: 1890, h: 832 };   // the (captured or simulated) web page, aspect 2.27
export const COLS = 18, ROWS = 8;
export const CELL_W = PAGE.w / COLS, CELL_H = PAGE.h / ROWS;   // 105 x 104
export const CELL_HP = 13;
export const ROUND_MS = 60000, READY_MS = 1600;
export const GRAVITY = 2300;
export const PLAYER_W = 34, PLAYER_H = 58;
export const MAX_SCORE = 11150;

export interface CharDef {
  id: CharId; kind: WeaponKind; color: string; accent: string;
  dmg: number; rate: number; rad: number;           // weapon multipliers
  speed: number; jumpV: number; jumps: number;      // movement
  fuel: number; thrust: number;                     // jetpack: seconds of fuel, upward acceleration
}
export const CHARS: Record<CharId, CharDef> = {
  glitch: { id: 'glitch', kind: 'bolt', color: '#2e7bff', accent: '#27e8ff', dmg: 1.0, rate: 1.05, rad: 1.0, speed: 340, jumpV: 760, jumps: 1, fuel: 1.1, thrust: 2500 },
  boom:   { id: 'boom',   kind: 'bomb', color: '#ff9a2e', accent: '#ffd36b', dmg: 1.15, rate: 0.88, rad: 1.3, speed: 290, jumpV: 740, jumps: 1, fuel: 0.95, thrust: 2400 },
  nova:   { id: 'nova',   kind: 'beam', color: '#a35bff', accent: '#ff4fd8', dmg: 1.08, rate: 1.06, rad: 1.0, speed: 330, jumpV: 750, jumps: 2, fuel: 0.9, thrust: 2500 },
  hole:   { id: 'hole',   kind: 'hole', color: '#ff4fd8', accent: '#b06bff', dmg: 1.0, rate: 1.04, rad: 1.15, speed: 370, jumpV: 740, jumps: 2, fuel: 1.0, thrust: 2500 },
};
// weapon tiers (index = tier). Unlocked at 25 / 50 / 75 % destruction.
export const TIERS = [
  null,
  { dmg: 6,  cd: 0.22, rad: 0,   spd: 1100 },
  { dmg: 9,  cd: 0.20, rad: 70,  spd: 1150 },
  { dmg: 14, cd: 0.26, rad: 140, spd: 1200 },
  { dmg: 22, cd: 0.30, rad: 220, spd: 1300 },
] as const;
export const MILESTONES = [0, 0, 25, 50, 75];
// floating ledges in the two side margins so the level can also be climbed without the jetpack.
// plus a classic Mario-style staircase and a floating top bridge surrounding the page on the left, right and top sides
export interface Ledge extends Point { x: number; y: number; w: number; type?: 'mystery' }
export const LEDGES: Ledge[] = [
  // left column (bottom → top)
  { x: 40, y: 900, w: 130 }, { x: 90, y: 760, w: 130 }, { x: 40, y: 620, w: 130 }, { x: 90, y: 480, w: 130 }, { x: 40, y: 340, w: 130 }, { x: 90, y: 200, w: 130 },
  // right column (bottom → top)
  { x: 2230, y: 900, w: 130 }, { x: 2180, y: 760, w: 130 }, { x: 2230, y: 620, w: 130 }, { x: 2180, y: 480, w: 130 }, { x: 2230, y: 340, w: 130 }, { x: 2180, y: 200, w: 130 },
  // left-top staircase climbing toward the top bridge
  { x: 240, y: 165, w: 120 }, { x: 230, y: 130, w: 120 }, { x: 380, y: 95, w: 120 }, { x: 360, y: 60, w: 120 },
  // right-top staircase climbing down into the top bridge
  { x: 2160, y: 165, w: 120 }, { x: 2100, y: 130, w: 120 }, { x: 2040, y: 95, w: 120 }, { x: 2040, y: 0, w: 120 },
  // top floating bridge (y = 0) — classic Mario-style bricks with '?' mystery blocks
  { x: 60, y: 0, w: 120 }, { x: 180, y: 0, w: 120 }, { x: 300, y: 0, w: 40, type: 'mystery' },
  { x: 420, y: 0, w: 120 }, { x: 540, y: 0, w: 120 }, { x: 660, y: 0, w: 40, type: 'mystery' },
  { x: 780, y: 0, w: 120 }, { x: 900, y: 0, w: 120 }, { x: 1020, y: 0, w: 40, type: 'mystery' },
  { x: 1140, y: 0, w: 120 }, { x: 1260, y: 0, w: 120 }, { x: 1380, y: 0, w: 40, type: 'mystery' },
  { x: 1500, y: 0, w: 120 }, { x: 1620, y: 0, w: 120 }, { x: 1740, y: 0, w: 40, type: 'mystery' },
  { x: 1860, y: 0, w: 120 }, { x: 1980, y: 0, w: 120 }, { x: 2100, y: 0, w: 40, type: 'mystery' },
  { x: 2220, y: 0, w: 120 },
];
