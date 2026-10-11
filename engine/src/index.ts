import { CHAR_IDS, CHARS, MILESTONES, PAGE, ROUND_MS, TIERS, VIEW_H, VIEW_W, MAX_SCORE } from './constants';
import { Engine } from './engine';
import type { Host } from './host';

export function createEngine(host: Host, root: HTMLElement): Engine { return new Engine(host, root); }
export const PAGE_IMAGE = { w: 1280, h: 563 };      // size the page canvas must have (aspect of the in-game browser window)
export { CHAR_IDS, CHARS, MILESTONES, PAGE, ROUND_MS, TIERS, VIEW_H, VIEW_W, MAX_SCORE };
export type { Engine, Host };
