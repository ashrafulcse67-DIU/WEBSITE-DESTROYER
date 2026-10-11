// Copies the Phaser build installed by npm into public/vendor so the game can self-host it (no CDN needed).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/phaser/dist/phaser.min.js';
if (existsSync(src)) { mkdirSync('public/vendor', { recursive: true }); copyFileSync(src, 'public/vendor/phaser.min.js'); console.log('Phaser copied to public/vendor/phaser.min.js'); }
else console.warn('phaser not installed – the game will load Phaser from the CDN or fall back to the Canvas renderer.');
