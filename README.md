# WEBSITE DESTROYER v2 – side-scrolling 2D arcade 

Paste a link → the Worker opens the **real page** in a headless browser → the game turns that picture into a **side-scrolling level**
(the page is made of destructible blocks, the floor and ledges are platforms) and you have 60 seconds to destroy it:
run (A/D), jump and hold **Space** to fly with the jetpack, aim with the **mouse/touch**, switch weapons with **F**.
Original astronauts, art and sounds – inspired only by the *concept* of destroy.spritefusion.com, no assets or code copied.

## Architecture
```
engine/src (TypeScript)
  constants.ts types.ts   world, characters, weapon tiers (25/50/75 %), events
  sim.ts                  Simulation: physics, tile collision, camera, jetpack, weapons, destruction, timer, score, victory/defeat
                          – pure TS: no DOM / Phaser / network  => deterministic, unit-tested, independent of latency
  input.ts                keyboard (A/D/Space/F/Esc), mouse + touch aiming, virtual buttons
  engine.ts               owns Simulation + Input + one Renderer, runs the loop (fixed ≤1/60 s sub-steps)
  render/phaserRenderer   Phaser 3 scene: FIT scaling, camera, textures, sprite sheet + animations, 144 page-block images, shards, overlays
  render/canvasRenderer   Canvas 2D renderer = guaranteed fallback (used if Phaser cannot load or throws – the round continues seamlessly)
  render/bake.ts          bakes each astronaut into an animated sprite sheet (idle/run/jump/fly/happy/hurt/dizzy) + separate aiming arm
  loader.ts               loads Phaser from public/vendor (self-hosted) → pinned jsDelivr copy → else Canvas fallback
public/index.html         menus, character select (4 astronauts), nickname, URL entry, HUD (DOM overlay, EN/বাংলা, accessible), share, leaderboard
src/ (Worker)             /api/snapshot  Browser Rendering capture      /api/round + /api/score + /api/leaderboard  (D1)
```
The server is used **only** for capture, round tokens and the leaderboard; gameplay never waits for the network.

## Deploy
```bash
npm install                     # also copies phaser.min.js to public/vendor (self-hosted Phaser)
npx wrangler login
npx wrangler d1 create website-destroyer     # paste the database_id into wrangler.jsonc
npm run db:migrate
npx wrangler secret put SCORE_SECRET         # e.g. output of: openssl rand -hex 32
npm run deploy                               # builds the engine bundle, then wrangler deploy
```
Local checks: `npm run typecheck` · `npm test` (engine 20 tests + worker 16 tests).  The prebuilt `public/assets/wd-engine.js` is included, so deploying works even before `npm run build`.

## Controls
| Desktop | Phone / tablet |
|---|---|
| **A / D** run · **Space** jump (hold = jetpack; Nova & Miss Blackhole also double-jump) · **F** switch weapon · **mouse** aim + click/hold to shoot · **J** shoot with aim assist · **Esc / P** pause | ◀ ▶ run (hold) · ⤒ jump / hold to fly · 💥 shoot (aim assist) · **F** switch · touch & drag on the page to aim and shoot · ❚❚ pause |

## Rules implemented (and covered by tests)
* Exactly **60 s** of play after a 1.6 s "get ready"; the HUD reads the simulation's own clock (pause freezes it). Last 10 s: red pulsing timer + screen vignette, a tick sound per second, three urgency messages, music intensity ×.
* **Victory (100 %) and defeat (timeout) are mutually exclusive** – one guarded `finish()`; exactly one `end` event; timer and attacks stop; no second terminal state is possible.
* **Weapon tiers** unlock at 25 / 50 / 75 %: more damage (6 → 9 → 14 → 22), bigger splash, heavier effects/sounds; `F` only cycles unlocked tiers; locked tiers cannot be selected.
* Victory → character celebrates, black-hole absorbs the page, portal appears, character leaps in → next URL screen (reduced-motion: results panel instead of the automatic jump). Defeat → character spins, "BONK!", comedic jingle.
* Score = damage 5000 + time bonus (≤ 2400) + upgrades 750 + accuracy (≤ 1000) + victory 2000 – verified server-side. Only completed rounds reach the global Top 10 (best per anonymous device, ties → faster time → earlier).
* Balance (human-like bot, 5 seeds each): Glitch ≈ 46 s · Boombyte ≈ 41 s · Nova ≈ 47 s · Blackhole ≈ 44 s; an idle player never wins.

## Safety
Destruction exists only in the game's own rendering layer; the real site is never modified or attacked. `/api/snapshot` returns only a rendered JPEG, accepts http/https on ports 80/443/8080/8443, refuses private / loopback / metadata hosts (DNS-over-HTTPS, re-checked on redirects), rate-limits per IP. Scores: signed rounds (HMAC), formula + wall-clock checks, duplicate protection, D1 CHECK constraints, no public edit/delete route. A client-side game can never be fully cheat-proof.

## Fallbacks (clearly labelled in the HUD)
* 🟢 **LIVE CAPTURE** (Browser Rendering, 5–20 s) · 🟠 **SIMULATION** (a full-width look-alike page generated from the domain: name, colours, hero, cards) – shown in the URL-screen preview, on the in-game browser window *and* in the HUD.
* The URL screen shows a look-alike page immediately while the real page is captured, then swaps in the real capture. Capture failure / timeout / blocked site / no backend → the preview stays on the labelled simulation and the player accepts it explicitly ("Play with this simulation"). The game never fakes a capture, and there is no iframe preview (no more blank sad-face boxes).
* 🎮 badge shows the active renderer (**Phaser 3** or **Canvas (fallback)**); the pause menu prints the reason if Phaser could not start.

## Honest status
Verified here: TypeScript strict type-check of `engine/`; 20 engine tests + 16 worker tests; headless-browser end-to-end runs of the whole flow through the **Canvas renderer** (capture → round → camera scroll → mouse aim → pause/resume → defeat overlay → victory → next URL screen → score accepted by the Worker → leaderboard; phone landscape with touch buttons); a deliberately broken `Phaser` global correctly fell back to Canvas.
**Not verified:** the *Phaser renderer itself* (`render/phaserRenderer.ts`, `bake.ts`) has **never been executed** – my build environment has no network, so Phaser could not be installed. It is written against stable Phaser 3 APIs and guarded (any error → automatic switch to the Canvas renderer, same simulation), but expect to fix small API mistakes on first run; check the 🎮 badge / pause-menu diagnostics. Also unverified: `wrangler.jsonc` fields, `@cloudflare/puppeteer`, real D1, real Browser Rendering limits/pricing (check current Cloudflare docs; free plans have small daily browser-time limits), `tsc` against the real Phaser typings (Phaser objects are typed `any`), and real touch devices / Bangla font rendering.
