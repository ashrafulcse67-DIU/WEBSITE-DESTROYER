import type { CharId } from './constants';
import type { Phase, RoundResult, SfxName, TargetMode } from './types';

export interface DrawOpts { s?: number; face?: number; t?: number; walk?: boolean; air?: boolean; mood?: string; aim?: number; spin?: number; flame?: boolean; squash?: number; hide?: boolean; bubble?: string; glow?: boolean; laugh?: boolean; skipArm?: boolean; armOnly?: boolean; }

/** Everything the engine needs from the page (UI, audio, art, i18n). The engine never touches the DOM outside its own root. */
export interface Host {
  reducedMotion: boolean;
  sfx(name: SfxName): void;
  setIntensity(level: number): void;
  t(key: string, params?: Record<string, string | number>): string;
  laugh(char: CharId): string;
  drawChar(ctx: CanvasRenderingContext2D, id: CharId, x: number, y: number, o: DrawOpts): void;
  drawSpace(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, withBlackHole: boolean): void;
  onToast(key: string, params?: Record<string, string | number>): void;
  onTier(tier: number): void;
  onTick(sec: number): void;
  onPhase(phase: Phase): void;
  onEnd(result: RoundResult): void;        // the round is decided (victory or defeat) – submit the score now
  onDone(result: RoundResult): void;       // the victory / defeat animation finished – open the next screen
  onPauseRequest(): void;                  // Esc / P / window lost focus
  onRenderer(name: string, note?: string): void;
}
export interface StartOptions { charId: CharId; domain: string; mode: TargetMode; page: HTMLCanvasElement; seed?: number; palette?: string[]; forceCanvas?: boolean; }
export interface Renderer {
  readonly name: string;
  readonly drivesLoop: boolean;           // true when the renderer calls engine.frame() itself (Phaser); false = engine uses requestAnimationFrame
  init(): Promise<void>;
  render(): void;
  destroy(): void;
}
