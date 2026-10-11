/** Phaser is loaded at runtime: first a self-hosted copy (vendor/phaser.min.js), then a pinned CDN copy. Returns null if neither works. */
export const PHASER_CDN = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
function inject(src: string, ms: number): Promise<boolean> {
  return new Promise(res => {
    const s = document.createElement('script'); s.src = src; s.async = true; let done = false;
    const fin = (ok: boolean) => { if (done) return; done = true; clearTimeout(tm); if (!ok) s.remove(); res(ok); };
    const tm = setTimeout(() => fin(false), ms); s.onload = () => fin(true); s.onerror = () => fin(false); document.head.appendChild(s);
  });
}
export async function loadPhaser(sources: string[] = ['vendor/phaser.min.js', PHASER_CDN], ms = 9000): Promise<any | null> {
  const g = globalThis as any; if (g.Phaser && g.Phaser.Game) return g.Phaser;
  for (const src of sources) { if (await inject(src, ms) && g.Phaser && g.Phaser.Game) return g.Phaser; }
  return null;
}
