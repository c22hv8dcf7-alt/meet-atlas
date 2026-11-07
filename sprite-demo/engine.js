"use strict";
(function () {
/* =====================================================================
   Atlas Presence — sprite + spring-physics stage engine.
   Shared by the spike player (index.html) and the website live demo
   (site-demo/demo.html). No dependencies, no network calls: every asset
   is a same-origin file.

   SPRING TUNING (the Presence Rig Standard's physics law, restated for
   rigid layers): motion must settle in ~0.5–1 s with slight overshoot —
   never "underwater". Each spring is parameterized by natural frequency
   omega (rad/s) and damping ratio zeta; settle time ~= 4/(zeta*omega),
   overshoot grows as zeta drops. Current values:
     body      omega 11.0  zeta 0.55  settle ~0.66 s  (the driver layer)
     bust      omega  9.0  zeta 0.42  settle ~1.05 s  overshoot ~22%,
                        travel CLAMPED to +/-7 px — the dictionary's
                        phys_bust law: present and alive, restrained
     hairBack  omega  9.5  zeta 0.42  settle ~1.00 s  lags the head most
     hairFront omega 10.5  zeta 0.46  settle ~0.83 s
     ribbon    omega  9.5  zeta 0.40  settle ~1.05 s  + free rotation swing
     face      LOCKED to the body spring (no facial sliding, ever)
   Gains multiply the shared performance target per layer; rotation is
   driven by each spring's own x-velocity (pendulum read).

   PRESENTATION SMOOTHING (not physics — the springs above are the law
   and are untouched): face swaps crossfade over ~90 ms (45 ms for
   blinks) on a two-plate stack whose opacity is driven from this
   engine's own tick, never a CSS transition, so the fade follows the
   stage clock frame-for-frame; the RMS lip-sync envelope is one-pole
   smoothed (fast attack ~15 ms, release ~120 ms) so the mouth no
   longer jitters bucket-to-bucket and talk state holds through
   syllable gaps; the speech bounce reads that smoothed envelope
   through a further ~70 ms ease, so it has no linear segments.
   ===================================================================== */
const SPRING_TUNING = {
  body:      { omega: 11.0, zeta: 0.55, gainX: 1.00, gainY: 1.00, rot: 0.00 },
  bust:      { omega:  9.0, zeta: 0.42, gainX: 0.35, gainY: 0.55, rot: 0.00, clamp: 7 },
  hairBack:  { omega:  9.5, zeta: 0.42, gainX: 1.50, gainY: 1.35, rot: 0.55, lift: 0.20 },
  hairFront: { omega: 10.5, zeta: 0.46, gainX: 1.15, gainY: 1.10, rot: 0.30, lift: 0.35 },
  ribbon:    { omega:  9.5, zeta: 0.40, gainX: 1.90, gainY: 1.60, rot: 1.60 },
  tail:      { omega: 10.0, zeta: 0.45, gainX: 0.90, gainY: 0.80, rot: 0.00 },
};
/* Per-character presentation overrides — DATA, merged over SPRING_TUNING
   per layer at build time. Only gains and travel clamp live here;
   omega/zeta (the settle law) are never overridden. The bust values are
   sized so the bounce READS at stage scale: at the 1600px native canvas
   the old +/-7px clamp shrank to ~3px on a 720p stage — invisible.
   Paige is the cast's most restrained (+/-16 native px); Clementine's
   is the highest by design (+/-20, with an extra-wide patch feather so
   the travel never shows a plate edge). The bust spring still only ever
   follows the shared performance target + sanctioned impulses — no
   driver ever writes it. */
const SPRING_OVERRIDES = {
  paige: { bust: { gainX: 0.50, gainY: 1.00, clamp: 16 } },
  clem:  { bust: { gainX: 0.65, gainY: 1.10, clamp: 20 } },
};
/* Tail-wag tuning — per-character DATA (the cast-tuning hook). The wag
   driver writes only the tail spring's TARGET (an oscillating angle);
   the spring itself still owns the motion — one-writer law preserved.
   Classes resolve from the active expression (+ talking state):
     excited  happy/proud/sparkle/closed-happy/wink — fast + wide
     talking  mouth moving, any expression          — gentle
     idle     everything else                       — slow sway BURSTS
                                                      with quiet gaps
     shy      slow + small · sad — droop (hangs, wag off)
     angry    stiff, tiny fast tip-twitch
   amp is normalized (1.0 = the full +/-16 deg stage swing); droop is a
   constant hang angle in degrees. Milo's row is his design data,
   ready for his asset set; his CHARACTERS entry arrives with it. */
const WAG_TUNING = {
  default: {
    excited: { hz: 2.3, amp: 1.00 }, talking: { hz: 1.2, amp: 0.45 },
    idle:    { hz: 0.7, amp: 0.50, bursts: true }, shy: { hz: 0.8, amp: 0.30 },
    sad:     { hz: 0.0, amp: 0.00, droop: 11 }, angry: { hz: 3.6, amp: 0.10 },
  },
  /* Milo + Mochi rows are cast-tuning.md §7 converted into the wag
     driver's class vocabulary (amp normalized: degrees / WAG_MAX_DEG;
     burstOn/burstOff are [base, span] ms for the idle burst gate —
     absent = the engine's original windows). Milo: fast and
     enthusiastic when pleased (2.5–3.5 Hz, ±28°), gentle while
     talking (1.5 Hz, ±10°), idle bursts ~2 s every ~7 s at ±6°,
     sad droops +18°. Mochi is lazier at every class: pleased is
     2.2–3.0 Hz / ±22° (blended with his calmer closed-happy 1.8 Hz /
     ±16°), talking barely interested (0.9 Hz, ±7°), idle bursts
     ~1.5 s every ~10 s at 0.25 Hz / ±4°, sad droops +24°, and angry
     is near-frozen disdain (a slow flick, not a twitch). */
  milo: {
    excited: { hz: 3.0, amp: 1.75 }, talking: { hz: 1.5, amp: 0.625 },
    idle:    { hz: 0.4, amp: 0.375, bursts: true, burstOn: [1800, 600], burstOff: [4000, 2000] },
    shy:     { hz: 0.8, amp: 0.50 },
    sad:     { hz: 0.0, amp: 0.00, droop: 18 }, angry: { hz: 6.0, amp: 0.125 },
  },
  mochi: {
    excited: { hz: 2.4, amp: 1.30 }, talking: { hz: 0.9, amp: 0.44 },
    idle:    { hz: 0.25, amp: 0.25, bursts: true, burstOn: [1300, 400], burstOff: [7500, 3000] },
    shy:     { hz: 0.6, amp: 0.375 },
    sad:     { hz: 0.0, amp: 0.00, droop: 24 }, angry: { hz: 0.25, amp: 0.06 },
  },
};
const WAG_MAX_DEG = 16;
/* ---------------- chain physics (the merge) ----------------
   chain.js (loaded before this file by the host page) ports PNGTuber
   Remix's segmented-chain model; INTEGRATION.md in chain-proof/ is
   the merge recipe this section follows. Layers declared in a
   character's `chains` table are runtime-sliced into horizontal bands
   and posed by chains instead of riding a rigid spring plate: hair
   falls, veils, ponytails and the puppy boys' tails BEND. The wag
   driver retargets onto the tail chains — wag is a traveling bend,
   sad is an uncurl-and-hang (chain-proof measured 276 native px of
   tip travel for the droop, vs the rigid plate's 16 degrees).
   If chain.js failed to load, every chained layer falls back to its
   rigid plate — stability first, the stage never breaks. */
/* Impulse -> chain kick calibration (chain-proof): engine impulse
   -300 (the shake) <-> chain kick -0.85; the hop (0,-190) <-> +0.35. */
const CHAIN_KICK = { x: 0.0028, y: -0.00184 };
/* WAG_TUNING -> chain wag classes (INTEGRATION merge point 5: one
   table, engine-owned). Chain amp is curvature oscillation as a
   fraction of CHAIN_TUNING.tail.wag.maxCurvature; WAG_TUNING amp is
   normalized to Milo's excited +/-28 deg row (1.75), and the chain
   proof's proven excited response sits at chain amp 1.0 — hence the
   1/1.75 scale. Droop passes through in degrees (the chain adds its
   per-joint uncurl bias on top). Idle burst windows convert from
   WAG_TUNING's [base, span] ms gates to the chain's {cycle, on}. */
/* ================================================================
   MOTION PASS 2 — THE EIGHT STEALS (2026-11-06, Levi: "all eight")
   Source of record: files/RESEARCH-MOTION-EXAMPLES.md. Every steal
   is data in the tables below; the Avatar code only reads them.
   Settle law unchanged: everything returns to rest in <= ~1.6 s.
   ================================================================ */

// 1. BLINK GRAMMAR (Cubism, research §2.2): close 100 ms, hold
// 50 ms, open 150 ms; interval randomized around a ~4 s mean;
// ~1 in 10 blinks is a double; blinks also fire on expression
// changes and strong leans.
const BLINK_TUNING = {
  closeMs: 100, holdMs: 50, openMs: 150,
  intervalMeanMs: 4000, intervalMinMs: 900,
  doubleChance: 0.10, doubleGapMs: 300,
  onExprChance: 0.65, onLeanChance: 0.5, leanMin: 150,
};

// 2. BREATH STACK (research §2.3): four incommensurate sines
// (~3.5 / 5.5 / 6.5 / 15.5 s) at display-px amplitudes so tiny the
// stack never reads as motion — it just kills the perfectly-still
// tell. amp scales per character (Vesper barely breathes on
// camera; Juno is an athlete).
const BREATH_TUNING = {
  rootY: { period: 3.5, amp: 1.5, phase: 0.0 },
  faceY: { period: 5.5, amp: 0.8, phase: 2.1 },
  rootX: { period: 6.5, amp: 1.1, phase: 1.7 },
  rootR: { period: 15.5, amp: 0.22, phase: 0.6 }, // degrees
  bustShare: 0.8,   // bust layer samples the rootY breath x this
  amp: { paige: 1.0, clem: 1.05, milo: 0.9, juno: 1.25, vesper: 0.45, mochi: 0.7 },
  deepMs: 4000, deepBoost: 1.2, // the scheduler's deep-breath act
};

// 3. SQUASH & STRETCH (research §2.3/§3.3): volume-conserving
// (sx = 1/sqrt(sy)) on a spring tuned for the Penner back-ease
// ~10% overshoot (zeta ~0.59 at the pop spring; the squash spring
// sits a touch livelier); sy hard-clamped to the field's
// 1.06-1.10 ceiling. stretchGain is per layer NAME: hair flies,
// the body barely gives (Plus template ratio ~8:1).
const SQUASH_TUNING = {
  omega: 13, zeta: 0.50, min: 0.93, max: 1.10,
  speechGain: 0.045, hopKick: 2.0, dipKick: -0.55, actKick: 0.8,
  stretchGain: { hairback: 0.9, hairfront: 0.8, ribbon: 0.7, tail: 0.6, bust: 0.25, body: 0.12 },
};

// 4. TALK-LIFT + PER-EXPRESSION MOTION ROWS (research §2.6):
// the head lifts 6-10 px while she speaks and a few elements
// stir (hair shares the lift through SPRING_TUNING lift shares).
// gain scales every impulse (springs + chains); fade is the
// expression crossfade each state asks for (surprise snaps in
// ~60 ms, shy creeps in ~250 ms). charScale multiplies the row
// per character: Vesper minimal, Juno maximal — characterization
// as data.
const LIFT_TUNING = { px: 8, attackMs: 90, releaseMs: 250 };
const EXPR_MOTION = {
  neutral:      { gain: 1.00, fade: 90 },
  talk:         { gain: 1.00, fade: 45 },
  talk_half:    { gain: 1.00, fade: 45 },
  happy:        { gain: 1.08, fade: 90 },
  closed_happy: { gain: 1.05, fade: 90 },
  wink:         { gain: 1.00, fade: 80 },
  sparkle:      { gain: 1.15, fade: 80 },
  smug:         { gain: 0.90, fade: 120 },
  sad:          { gain: 0.80, fade: 160 },
  surprised:    { gain: 1.12, fade: 60 },
  angry:        { gain: 1.05, fade: 80 },
  thinking:     { gain: 0.85, fade: 140 },
  shy:          { gain: 0.90, fade: 250 },
  proud:        { gain: 1.05, fade: 110 },
  blink:        { gain: 1.00, fade: 30 },
};
const EXPR_CHAR_SCALE = { paige: 1.0, clem: 1.0, milo: 1.0, juno: 1.15, vesper: 0.65, mochi: 1.0 };

// 5. ANTICIPATION (research §2.4): a 60-100 ms counter-dip + a
// blink land just before hops and laughs; scale pops ride the
// squash spring's overshoot and a face pop spring with the same
// Penner flavor (zeta 0.59 ~= s=1.70158's 10%).
const ANTICIPATION_TUNING = { dipMs: 85, dipVy: 34, facePopOmega: 16, facePopZeta: 0.59, facePopKick: 0.9 };

// 6. GAZE (research §2.5): saccade grammar — holds of 0.3-2 s,
// ~2-frame jumps (the plate swap IS the jump), the head follows
// 100-200 ms later at a fraction of the eye travel. Plates are
// derived from each character's own neutral face (gazeplates.py;
// audit in work/gaze-audit.json) and show only over the states
// the plate was visually graded safe on. Travel is clamped to
// the mapping below — never a yeet.
const GAZE_TUNING = {
  holdMinMs: 300, holdMaxMs: 2000,
  staleMs: 2500,            // external target older than this -> drift
  driftRadius: 0.45,        // drift saccades stay near center
  centerDead: 0.28,         // |g| below this reads as center
  followLagMs: 150,         // head-follow lag (100-200 ms band)
  followFrac: 0.35,         // head offset = eye travel x this
  followPx: 5,              // native px of head travel at |g| = 1
  bigSaccade: 0.9,          // |delta g| past this may draw a blink
};

// 7. IDLE SCHEDULER (research §2.7, Shimeji grammar): weighted
// acts with cooldowns and conditions, fired in the gaps of a
// per-character density range. Acts use only parts we own:
// sway (the old micro-kick), look (a drift-gaze excursion),
// hairfix, stretch, breath (a deep one), tailflick (tailed
// characters, only out of the idle wag class). Nothing fires
// while she talks or a voice envelope is live; nothing but
// breath fires while she is sad.
const IDLE_TUNING = {
  gapMs: [2600, 5200],
  acts: {
    sway:     { w: 5, cdMs: 0 },
    look:     { w: 3, cdMs: 5000 },
    hairfix:  { w: 2, cdMs: 9000 },
    breath:   { w: 2, cdMs: 12000 },
    stretch:  { w: 1, cdMs: 15000 },
    tailflick:{ w: 2, cdMs: 8000 },
  },
  chars: {
    vesper: { gapMs: [6000, 11000], acts: { sway: 3, look: 2, hairfix: 1, breath: 2, stretch: 0, tailflick: 0 } },
    juno:   { gapMs: [2200, 4200],  acts: { sway: 5, look: 4, hairfix: 3, breath: 2, stretch: 2, tailflick: 0 } },
    mochi:  { gapMs: [5000, 9000],  acts: { sway: 3, look: 3, hairfix: 1, breath: 3, stretch: 1, tailflick: 2 } },
    milo:   { gapMs: [2400, 4600],  acts: { sway: 5, look: 3, hairfix: 2, breath: 1, stretch: 1, tailflick: 3 } },
    clem:   { gapMs: [2600, 5000],  acts: { sway: 5, look: 3, hairfix: 3, breath: 2, stretch: 1, tailflick: 0 } },
  },
};

// 8. PERFORMANCE DYNAMICS (research §2.1): her own voice
// envelope, slowed, scales how big she moves inside a line —
// a whisper sways, a peak bounces. A sustained peak on a happy
// face may bump the expression one notch (HONK's escalation),
// once per line; the perform scripts pin flags.escalate=false
// so the recorded proofs stay exactly as choreographed.
const DYN_TUNING = { tcMs: 300, base: 0.55, span: 0.75, escHot: 0.92, escHoldMs: 150 };

const CHAIN_WAG_AMP = 1 / 1.75;
function chainWagClasses(charKey, droopScale) {
  const row = WAG_TUNING[charKey] || WAG_TUNING.default;
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k], c = { hz: v.hz, amp: v.amp * CHAIN_WAG_AMP };
    if (v.droop) c.droop = v.droop * (droopScale == null ? 1 : droopScale);
    if (v.bursts) {
      const onW = v.burstOn || [2200, 1600], offW = v.burstOff || [2500, 3000];
      const on = (onW[0] + onW[1] / 2) / 1000, off = (offW[0] + offW[1] / 2) / 1000;
      c.bursts = true; c.burst = { cycle: on + off, on };
    }
    out[k] = c;
  }
  return out;
}
/* Bands for a chain, derived from its captured rest FK exactly as the
   chain proof built them by hand: each segment's band spans its two
   joints' heights; the outermost bands pad to the art's extremes. */
function chainBands(chain, geom) {
  const bands = [];
  for (let s = 1; s <= chain.n; s++) {
    const ya = chain.restPos[s - 1].y, yb = chain.restPos[s].y;
    bands.push({ y0: Math.min(ya, yb), y1: Math.max(ya, yb), seg: s, joint: s - 1 });
  }
  let top = bands[0], bot = bands[0];
  for (const b of bands) { if (b.y0 < top.y0) top = b; if (b.y1 > bot.y1) bot = b; }
  if (geom.bandTop != null) top.y0 = Math.min(top.y0, geom.bandTop);
  if (geom.bandBottom != null) bot.y1 = Math.max(bot.y1, geom.bandBottom);
  return bands;
}
/* Dynamic blush — one overlay plate per character; opacity follows the
   active expression (the dictionary's blush parameter, sprite form). */
const BLUSH_LEVEL = { shy: 0.95, closed_happy: 0.50, sparkle: 0.45, happy: 0.35,
                      wink: 0.30, proud: 0.30, smug: 0.20 };
const EXPRESSIONS = ["neutral", "happy", "closed_happy", "wink", "sparkle", "smug",
                     "sad", "surprised", "angry", "thinking", "shy", "proud"];
const CHARACTERS = {
  paige: { label: "Paige", spriteDir: "assets/paige", layerDir: "assets/paige-layers",
           gaze: { eye: [799, 453], safe: ["neutral","talk","talk_half","happy","sad","surprised","angry","thinking","shy","proud"] },
           layers: ["hairback", "body", "bust", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           jaw: { pivot: "50.6% 35.5%", maxDeg: 9 },
           pivots: { bust: "50% 60%", hairback: "50% 16%", hairfront: "50% 14%" },
           /* Chain geometry — the chain-proof page's proven numbers,
              verbatim (its bandBottom pads to the full art here). */
           chains: {
             hairback: [
               { tune: "hairBack", strip: [150, 668], anchor: [430, 120], dir: 90, segLen: 196, bandTop: 100, bandBottom: 1600 },
               { tune: "hairBack", strip: [790, 670], anchor: [1135, 120], dir: 90, segLen: 196, bandTop: 100, bandBottom: 1600 } ],
             hairfront: [
               { tune: "hairFront", strip: [470, 695], anchor: [815, 425], dir: 90, segLen: 131, bandTop: 415, bandBottom: 952, overlap: 30 } ] } },
  clem:  { label: "Clementine", spriteDir: "assets/clem", layerDir: "assets/clem-layers",
           gaze: { eye: [801, 460], safe: ["neutral","talk","talk_half","happy","sad","surprised","angry","thinking","shy","proud"] },
           layers: ["hairback", "ribbon", "body", "bust", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           jaw: { pivot: "50.5% 35.6%", maxDeg: 10 },
           pivots: { bust: "52% 63%", ribbon: "30% 22%", hairback: "50% 16%", hairfront: "50% 14%" },
           /* Fitted from her art: two wide slabs tile the back hair
              (the falls separate below y~500 inside them); the ribbon
              is a 3-segment fall from its knot at (520,200), spine
              measured off its alpha centroids (~105 deg throughout). */
           chains: {
             hairback: [
               { tune: "hairBack", strip: [120, 640], anchor: [390, 100], dir: 90, segLen: 154, bandTop: 80, bandBottom: 1180 },
               { tune: "hairBack", strip: [720, 700], anchor: [1210, 100], dir: 90, segLen: 154, bandTop: 80, bandBottom: 1180 } ],
             ribbon: [
               { tune: "hairFront", tuneMods: { segments: 3, stiffness: 16, damping: 4.5, maxAngle: 0.7, curvaturePerJoint: [0, -0.017, 0.087] },
                 strip: [140, 480], anchor: [520, 200], dir: 105, segLen: 280, restRot: [105, 104, 109], preRoll: 90, bandTop: 175, bandBottom: 1095, kickGain: 2.5 } ],
             hairfront: [
               { tune: "hairFront", strip: [320, 960], anchor: [800, 320], dir: 90, segLen: 100, bandTop: 295, bandBottom: 712 } ] } },
  /* The cast-production four (cast-tuning.md is the record). Their
     state files drop the underscores (closedhappy / talkhalf) and
     their smug is the half-lid plate (halflid) — stateMap translates
     engine state names to file names. Their blush plate lives inside
     faces/ (blush: "faces/blush"). No jaw plates were cut for them:
     with no `jaw` entry the engine speaks through the graded mouth
     bands (talk_half / talk face plates), exactly as sprite mode
     does. layerSprings carries cast-tuning's per-layer spring data,
     merged over the standard tuning in build(); draw order is the
     tuning record's. Milo + Mochi declare their tail layer, which
     switches the wag driver on with their own WAG_TUNING rows. */
  milo:  { label: "Milo", spriteDir: "assets/milo", layerDir: "assets/milo-layers",
           gaze: { eye: [749, 370], safe: ["neutral","talk","talk_half","happy","smug","sad","surprised","angry","thinking","shy","proud"] },
           layers: ["hairback", "tail", "body", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { hairback: "50% 8%", hairfront: "50% 10%", tail: "74.9% 85.7%" },
           layerSprings: { hairback: { gainX: 1.40, gainY: 1.25 },
                           tail: { omega: 9.5, zeta: 0.42, gainX: 1.60, gainY: 1.20, rot: 1.40 } },
           tail: { layer: "tail" },
           /* Tail: the chain-proof fit verbatim (anchor, rest curl,
              pre-roll). Hair: two wide slabs tile the back hair; the
              ears ride the stiff root bands. Front: one center chain. */
           chains: {
             hairback: [
               { tune: "hairBack", strip: [200, 620], anchor: [480, 60], dir: 90, segLen: 216, bandTop: 10, bandBottom: 1580 },
               { tune: "hairBack", strip: [800, 590], anchor: [1070, 60], dir: 90, segLen: 216, bandTop: 10, bandBottom: 1580 } ],
             hairfront: [
               { tune: "hairFront", strip: [490, 580], anchor: [770, 290], dir: 90, segLen: 75, bandTop: 270, bandBottom: 570 } ],
             tail: [
               { tune: "tail", strip: [1180, 340], anchor: [1225, 1475], dir: -64, segLen: 148, restRot: [-67, -68, -100, -131], preRoll: 120, bandTop: 905, bandBottom: 1525, wag: true, droopScale: 0.75 } ] } },
  juno:  { label: "Juno", spriteDir: "assets/juno", layerDir: "assets/juno-layers",
           gaze: { eye: [784, 439], safe: ["neutral","talk","talk_half","happy","smug","sad","surprised","angry","proud"] },
           layers: ["hairback", "ponytail", "body", "bust", "whistle", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { hairback: "50% 10%", hairfront: "50% 12%", ponytail: "59% 11%",
                     whistle: "48.1% 43.1%", bust: "50% 60%" },
           layerSprings: { ponytail: { omega: 8.5, zeta: 0.38, gainX: 1.70, gainY: 1.30, rot: 1.50 },
                           whistle: { omega: 8.0, zeta: 0.45, gainX: 0.80, gainY: 0.90, rot: 1.20 },
                           bust: { gainX: 0.30, gainY: 0.45, clamp: 5 } },
           /* Ponytail fitted off cast-tuning's measured flow points
              (uniform 128 px segments land within ~25 px of every
              point); looser than hairFront — hers is the bounciest
              spring in the cast, so her chain is the loosest too.
              Hairback: two wide slabs; her falls peek at the right
              mid-height and the bottom-left inside them. */
           chains: {
             hairback: [
               { tune: "hairBack", strip: [260, 560], anchor: [520, 100], dir: 90, segLen: 214, bandTop: 78, bandBottom: 1600 },
               { tune: "hairBack", strip: [800, 460], anchor: [1010, 100], dir: 90, segLen: 214, bandTop: 78, bandBottom: 1600 } ],
             ponytail: [
               { tune: "hairFront", tuneMods: { stiffness: 13, damping: 4.2, maxAngle: 0.7, comebackSpeed: 0.5, curvaturePerJoint: [0, -0.155, 0.278, 0.141] },
                 strip: [830, 400], anchor: [944, 176], dir: 68.1, segLen: 128, restRot: [68.1, 59.2, 75.1, 83.2], preRoll: 90, bandTop: 80, bandBottom: 665, kickGain: 1.5 } ],
             hairfront: [
               { tune: "hairFront", strip: [480, 630], anchor: [790, 300], dir: 90, segLen: 90, bandTop: 285, bandBottom: 648 } ] } },
  vesper:{ label: "Vesper", spriteDir: "assets/vesper", layerDir: "assets/vesper-layers",
           gaze: { eye: [798, 343], safe: ["neutral","talk","talk_half","happy","smug","sad","surprised","angry","thinking","proud"] },
           layers: ["veil_a", "veil_b", "body", "bust", "choker", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { veil_a: "50% 8%", veil_b: "50% 8%", choker: "50.4% 34.5%",
                     hairfront: "50% 12%", bust: "50% 60%" },
           layerSprings: { veil_a: { omega: 9.5, zeta: 0.42, gainX: 1.20, gainY: 1.10, rot: 0.30 },
                           veil_b: { omega: 8.0, zeta: 0.38, gainX: 1.80, gainY: 1.50, rot: 0.70 },
                           choker: { omega: 11.0, zeta: 0.55, gainX: 0.15, gainY: 0.15, rot: 0.05 },
                           bust: { omega: 9.0, zeta: 0.48, gainX: 0.28, gainY: 0.40, clamp: 5 } },
           /* The veil's bottom flare (veil_b) is the longest appendage
              in the cast — two falls, left and right, chained as two
              soft 5-segment veils. veil_a stays a rigid plate BY
              DESIGN: it is a 375 px cap hugging the skull (cast-
              tuning already runs it near-rigid, rot 0.30); bending a
              skull cap reads as the head deforming, not hair moving. */
           chains: {
             veil_b: [
               { tune: "veil", tuneMods: { segments: 5, stiffness: 9 }, strip: [270, 480], anchor: [500, 1090], dir: 90, segLen: 110, bandTop: 1060, bandBottom: 1600 },
               { tune: "veil", tuneMods: { segments: 5, stiffness: 9 }, strip: [730, 570], anchor: [1150, 1090], dir: 90, segLen: 110, bandTop: 1060, bandBottom: 1600 } ],
             hairfront: [
               { tune: "hairFront", strip: [550, 520], anchor: [800, 290], dir: 90, segLen: 90, bandTop: 260, bandBottom: 628 } ] } },
  mochi: { label: "Mochi", spriteDir: "assets/mochi", layerDir: "assets/mochi-layers",
           gaze: { eye: [613, 371], safe: ["neutral","talk","talk_half","happy","smug","sad","surprised","angry","thinking","shy","proud"] },
           aspect: 1344 / 1728, canvas: [1344, 1728],
           layers: ["hairback", "tail", "body", "tag", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { hairback: "50% 8%", hairfront: "50% 10%", tail: "74.8% 78.4%", tag: "47.8% 34.5%" },
           layerSprings: { hairback: { gainX: 1.30, gainY: 1.15 },
                           tail: { omega: 9.5, zeta: 0.42, gainX: 1.60, gainY: 1.20, rot: 1.40 },
                           tag: { omega: 10.0, zeta: 0.50, gainX: 0.25, gainY: 0.30, rot: 0.30 } },
           tail: { layer: "tail" },
           /* Tail fitted off cast-tuning's measured flow points: the
              plume rises from (1005,1355) and curls over to its tip at
              (1074,566); per-joint curl replaces Milo's in the tail
              tune, and his wag table (lazier) is injected the same
              way. His hairback stays RIGID by design: it is a short
              earred cap (nothing below y~430) — there is no fall to
              bend, and ears must never flex. */
           chains: {
             hairfront: [
               { tune: "hairFront", strip: [380, 580], anchor: [660, 250], dir: 90, segLen: 90, bandTop: 230, bandBottom: 598 } ],
             tail: [
               { tune: "tail", tuneMods: { curvaturePerJoint: [0, -0.780, -0.175, 0.703] },
                 strip: [900, 420], anchor: [1005, 1355], dir: -51.6, segLen: 214, restRot: [-51.6, -96.3, -106.3, -66], preRoll: 120, bandTop: 445, bandBottom: 1475, wag: true, droopScale: 0.5 } ] } },
};
/* Engine state name -> the character's actual file basename. Most
   sets use the engine names verbatim; the cast-production four
   declare their variants in stateMap. */
function stateFile(C, state) { return (C.stateMap && C.stateMap[state]) || state; }

/* ---------------- envelope (the pipeline demo's proven RMS approach) ----
   Pre-decode each line with OfflineAudioContext into 30 buckets/second
   of RMS amplitude, gain-normalized so the 90th percentile sits near
   0.85. The talk swap and the bounce both read this envelope — the value
   always comes from the real speech audio, bucket by bucket. */
const BUCKETS_PER_SEC = 30, TALK_THRESHOLD = 0.12;
const ENVELOPES = {};
async function loadEnvelope(url) {
  if (ENVELOPES[url]) return ENVELOPES[url];
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audioBuf = await ctx.decodeAudioData(buf);
  const data = audioBuf.getChannelData(0);
  const n = Math.max(1, Math.ceil(audioBuf.duration * BUCKETS_PER_SEC));
  const buckets = new Float32Array(n), sorted = [];
  const per = Math.floor(data.length / n) || 1;
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = i * per; j < Math.min(data.length, (i + 1) * per); j += 4) { sum += data[j] * data[j]; cnt++; }
    buckets[i] = Math.sqrt(sum / Math.max(1, cnt)); sorted.push(buckets[i]);
  }
  sorted.sort((a, b) => a - b);
  const p90 = sorted[Math.floor(n * 0.9)] || 0.2;
  const gain = Math.min(4, 0.85 / Math.max(0.05, p90));
  for (let k = 0; k < n; k++) buckets[k] = Math.min(1, buckets[k] * gain);
  return (ENVELOPES[url] = { buckets, duration: audioBuf.duration });
}

/* ---------------- springs ---------------- */
class Spring {
  constructor(t) { this.o = t.omega; this.z = t.zeta; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; }
  step(dt, tx, ty) { // semi-implicit Euler toward (tx, ty)
    const k = this.o * this.o, c = 2 * this.z * this.o;
    this.vx += (k * (tx - this.x) - c * this.vx) * dt;
    this.vy += (k * (ty - this.y) - c * this.vy) * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
  }
  kick(vx, vy) { this.vx += vx; this.vy += vy; }
}
/* 1-DOF rotation spring — the tail-wag follower. The wag driver writes
   only its TARGET angle; this spring owns the motion (lag + settle). */
class RotSpring {
  constructor(omega, zeta) { this.o = omega; this.z = zeta; this.a = 0; this.v = 0; }
  step(dt, target) {
    const acc = this.o * this.o * (target - this.a) - 2 * this.z * this.o * this.v;
    this.v += acc * dt; this.a += this.v * dt;
  }
}

/* ---------------- face crossfade stack ----------------
   Two stacked plates: the bottom always holds the settled face, fully
   opaque; the top fades a new face in over it, then the bottom adopts
   it. Opacity advances only inside update(dt) — driven by the engine
   tick — so a fade takes the same number of STAGE frames live (rAF)
   and under the deterministic capture clock. A set() mid-fade simply
   retargets the top plate and keeps fading from the current opacity. */
class FadeStack {
  constructor(bottom, top) {
    this.els = [bottom, top];
    this.bottom = bottom; this.top = top;
    this.settled = null; this.target = null;
    this.o = 0; this.dur = 0.09; this.fading = false;
    this.top.style.opacity = "0";
  }
  set(src, fadeMs) {
    if (src === this.target) return;
    this.target = src;
    if (this.settled === null) {            // first face: settle at once
      this.bottom.src = src; this.settled = src;
      this.top.style.opacity = "0"; this.o = 0; this.fading = false;
      return;
    }
    this.top.src = src;
    this.dur = Math.max(0.02, (fadeMs || 90) / 1000);
    this.fading = true;                     // continue from current opacity
  }
  update(dt) {
    if (!this.fading) return;
    this.o = Math.min(1, this.o + dt / this.dur);
    const p = this.o * this.o * (3 - 2 * this.o);   // smoothstep
    this.top.style.opacity = p.toFixed(3);
    if (this.o >= 1) {
      this.bottom.src = this.target; this.settled = this.target;
      this.top.style.opacity = "0"; this.o = 0; this.fading = false;
    }
  }
}

/* ---------------- avatar ---------------- */
class Avatar {
  constructor(charEl, voiceEl, logFn) {
    this.charEl = charEl; this.voiceEl = voiceEl;
    this.log = logFn || (() => {});
    this.char = "paige"; this.mode = "layered";
    this.expression = "neutral"; this.talking = false;
    this.env = null;
    this.gain = 1.0; this.prevEnv = 0;
    this.envSmooth = 0; this.bounceSm = 0; this._lastFace = "neutral";
    this.mouthLevel = 0;                            // graded mouth band 0/1/2
    this.blushO = 0; this.blushTarget = 0; this.blushEl = null;
    /* Motion Pass 2 state. Blink machine (steal 1): phases
       idle -> closing -> hold -> opening, times from BLINK_TUNING,
       driven in tick; blinkEvents ring-logs starts for the suite. */
    this.blinkPhase = "idle"; this.blinkT0 = 0;
    this.nextBlinkAt = performance.now() + 1800 + Math.random() * 1500;
    this.blinkEvents = []; this._blinkCount = 0; this._blinkQueued = false; this._openFlip = false;
    this._nowMs = performance.now();
    /* Squash spring (steal 3): a 2-DOF Spring whose x is sy toward
       target 1; face pop (steal 5) is a RotSpring read as a scale. */
    this.squash = new Spring(SQUASH_TUNING); this.squash.x = 1; this._squashPeak = 1;
    this.facePop = new RotSpring(ANTICIPATION_TUNING.facePopOmega, ANTICIPATION_TUNING.facePopZeta);
    this._sched = [];                               // timed beats (anticipation -> hop)
    this.liftSm = 0;                                // talk-lift (steal 4), 0..1
    /* Gaze (steal 6): external target {x, y, t} in normalized
       stage space (+x viewer-right, +y down); the saccade sector
       is one of "" (center) / e ne n nw w sw s se. */
    this.gazeEl = null; this.rootEl = null; this.chainWraps = [];
    this._gazeExt = null; this._gazePt = { x: 0, y: 0 }; this._gazeSector = "";
    this._gazeNextAt = 0; this._gazeFollow = { x: 0, y: 0 };
    this._gazeShown = null; this._gazeChangedAt = 0;
    /* Idle scheduler (steal 7) + performance dynamics (steal 8). */
    this._nextIdleAt = performance.now() + 2000; this._idleCd = {}; this._idleLog = [];
    this._flickUntil = 0; this._deepStart = 0; this._deepUntil = 0;
    this.envSlow = 0; this.dynGain = DYN_TUNING.base;
    this._dynMin = DYN_TUNING.base; this._dynMax = DYN_TUNING.base;
    this._escUsed = false; this._escHot = 0;
    this.flags = { escalate: true };
    this.wag = null; this._wagEl = null;            // tail wag (driver->target)
    this.wagSpring = new RotSpring(18, 0.6);
    this.wagPhase = 0; this.wagHzSm = 0; this.wagAmpSm = 0; this.wagAngle = 0;
    this.wagGateOn = false; this.wagGateAt = 1200;  // idle burst gating
    this.jawA = 0; this.jawSpring = new RotSpring(26, 0.55); this.jawEl = null;
    this.debugJaw = null;                           // verification hook (0..1)
    this.springs = {}; this.layerEls = {}; this.spriteEl = null; this.faceEl = null;
    this.spriteStack = null; this.faceStack = null;
    this.chains = []; this._pendingChains = []; this._chainsPending = 0; this._buildSeq = 0;
    this.spriteSpring = new Spring({ omega: 12, zeta: 0.42 });
    this.build();
    this.last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.033, (now - this.last) / 1000); this.last = now;
      const sub = 2, sdt = dt / sub;
      for (let i = 0; i < sub; i++) this.tick(now, sdt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  preloadFaces(C) {
    // Decode every face/sprite state up front so a crossfade never
    // waits on a first-use image load mid-performance.
    const ext = C.ext || "png";
    const states = new Set([...EXPRESSIONS, "talk", "talk_half", "blink", "neutral"]);
    for (const s of states) {
      const f = stateFile(C, s);
      const a = new Image(); a.src = `${C.spriteDir}/${f}.${ext}`;
      const b = new Image(); b.src = `${C.layerDir}/faces/${f}.${ext}`;
    }
    const bl = new Image(); bl.src = `${C.layerDir}/${C.blush || "blush"}.${ext}`;
    if (C.jaw) { const jw = new Image(); jw.src = `${C.layerDir}/jaw.${ext}`; }
    if (C.gaze) for (const d of ["e", "ne", "n", "nw", "w", "sw", "s", "se"]) {
      const g = new Image(); g.src = `${C.layerDir}/faces/gaze_${d}.${ext}`;
    }
  }
  build() {
    this.charEl.innerHTML = ""; this.layerEls = {}; this.spriteEl = null; this.faceEl = null;
    this.spriteStack = null; this.faceStack = null; this.blushEl = null; this.jawEl = null;
    this.underlayEl = null;
    this.wag = null; this._wagEl = null; this._springLayers = [];
    this.chains = []; this._pendingChains = []; this._chainsPending = 0;
    const buildSeq = ++this._buildSeq;
    const C = CHARACTERS[this.char];
    this.tuning = {};
    for (const k of Object.keys(SPRING_TUNING))
      this.tuning[k] = { ...SPRING_TUNING[k], ...((SPRING_OVERRIDES[this.char] || {})[k] || {}) };
    this.preloadFaces(C);
    /* Motion Pass 2: the whole figure hangs under one root wrapper
       so squash & stretch (steal 3) and the breath stack's slow
       rotation (steal 2) move her as one body; layers keep their
       own springs inside it. Gaze state resets per character. */
    const root = document.createElement("div");
    root.dataset.layer = "root";
    root.style.cssText = "position:absolute;inset:0;transform-origin:50% 100%;pointer-events:none;";
    this.charEl.appendChild(root); this.rootEl = root;
    this.chainWraps = []; this.gazeEl = null;
    this._gazeSector = ""; this._gazeShown = null;
    this._gazePt = { x: 0, y: 0 }; this._gazeFollow = { x: 0, y: 0 };
    if (this.mode === "sprite") {
      const bottom = document.createElement("img");
      bottom.className = "base"; bottom.alt = C.label;
      const top = document.createElement("img");
      top.alt = "";
      this.rootEl.appendChild(bottom); this.rootEl.appendChild(top);
      this.spriteStack = new FadeStack(bottom, top);
      this.spriteStack.set(`${C.spriteDir}/neutral.${C.ext || "png"}`, 0);
      this.spriteEl = bottom;
      this._addBlush(C);
    } else {
      /* Underlay: a static copy of the whole neutral sprite beneath the
         layers (locked to the body spring). At rest it is fully covered
         and changes nothing; when an impulse swings layers apart for a
         few frames, the gaps show matching art instead of the stage
         background shining through the figure. */
      const under = document.createElement("img");
      under.src = `${C.spriteDir}/neutral.${C.ext || "png"}`;
      under.alt = ""; under.dataset.layer = "underlay";
      this.rootEl.appendChild(under); this.underlayEl = under;
      for (const name of C.layers) {
        if (name === "face") {
          const bottom = document.createElement("img");
          bottom.alt = ""; bottom.dataset.layer = "face";
          const top = document.createElement("img");
          top.alt = ""; top.dataset.layer = "face";
          this.rootEl.appendChild(bottom); this.rootEl.appendChild(top);
          this.faceStack = new FadeStack(bottom, top);
          this.faceStack.set(`${C.layerDir}/faces/neutral.${C.ext || "png"}`, 0);
          this.faceEl = bottom;
          if (C.gaze) {        // gaze patch (steal 6): above the face,
            const gz = document.createElement("img");   // under the blush
            gz.alt = ""; gz.dataset.layer = "gaze";
            const gc = C.canvas || [1600, 1600];
            gz.style.transformOrigin = `${(C.gaze.eye[0] / gc[0] * 100).toFixed(1)}% ${((C.gaze.eye[1] + 110) / gc[1] * 100).toFixed(1)}%`;
            gz.style.opacity = "0"; gz.style.pointerEvents = "none";
            this.rootEl.appendChild(gz); this.gazeEl = gz;
          }
          this._addBlush(C);   // blush rides above the face, under front hair
          if (C.jaw) {         // two-piece mouth: jaw patch above the face
            const jw = document.createElement("img");
            jw.src = `${C.layerDir}/jaw.${C.ext || "png"}`;
            jw.alt = ""; jw.dataset.layer = "jaw";
            jw.style.transformOrigin = C.jaw.pivot;
            jw.style.opacity = "0"; jw.style.pointerEvents = "none";
            this.rootEl.appendChild(jw); this.jawEl = jw;
          }
          continue;
        }
        if (C.chains && C.chains[name] && window.PresenceChain) {
          /* Chain layer (INTEGRATION merge point 2): a wrap div takes
             the layer's z-position; the plate <img> is never created
             and no Spring is made for it. ChainView stacks are built
             into the wrap once the layer image has loaded (below). */
          const wrap = document.createElement("div");
          wrap.className = "chainWrap"; wrap.dataset.layer = name;
          wrap.style.cssText = "position:absolute;inset:0;pointer-events:none;";
          /* Squash pivots the wrap at the chain's own anchor, so a
             chained appendage stretches around its root (steal 3). */
          const gc2 = C.canvas || [1600, 1600], g0 = C.chains[name][0];
          wrap.style.transformOrigin = `${(g0.anchor[0] / gc2[0] * 100).toFixed(1)}% ${(g0.anchor[1] / gc2[1] * 100).toFixed(1)}%`;
          this.rootEl.appendChild(wrap); this.chainWraps.push(wrap);
          this._pendingChains.push({ name, wrap, geoms: C.chains[name] });
          continue;
        }
        const img = document.createElement("img");
        img.src = `${C.layerDir}/${name}.${C.ext || "png"}`;
        img.alt = ""; img.dataset.layer = name;
        if (C.pivots[name]) img.style.transformOrigin = C.pivots[name];
        this.rootEl.appendChild(img); this.layerEls[name] = img;
      }
      for (const p of this._pendingChains) this._loadChains(p, C, buildSeq);
      this.springs = { body: new Spring(SPRING_TUNING.body) };
      /* Every non-face layer rides its own spring toward the shared
         performance target. Standard layer names start from the
         shared tuning table; any layer may then be re-specified per
         character through CHARACTERS[].layerSprings (cast-tuning's
         data — tails, ponytails, veils, near-locked patches). The
         tick applies the list generically, so a new appendage needs
         data, not engine code. */
      this._springLayers = [];
      const keyFor = { hairback: "hairBack", hairfront: "hairFront", bust: "bust", ribbon: "ribbon", tail: "tail" };
      for (const name of Object.keys(this.layerEls)) {
        const key = keyFor[name];
        const base = key ? { ...this.tuning[key] }
                         : { omega: 10.0, zeta: 0.45, gainX: 1.0, gainY: 1.0, rot: 0.0 };
        const spec = { ...base, ...((C.layerSprings || {})[name] || {}) };
        const spr = new Spring(spec);
        this._springLayers.push({ el: this.layerEls[name], spr, tune: spec, name });
        if (key) this.springs[key] = spr;
        this.springs[name] = spr;
      }
      if (C.tail && this.layerEls[C.tail.layer]) this.setWagLayer(C.tail.layer);
    }
    this.applyExpression();
  }
  /* Build the Chain + ChainView stacks for one chained layer once its
     image arrives. Curled appendages (tails, the ponytail, Clem's
     ribbon) seed from their fitted restPose, pre-roll under the
     deterministic 1/60 clock so the curl settles, then captureRest —
     at the captured rest pose every band transform is identity, so
     the stack reproduces the source layer pixel-for-pixel. */
  _loadChains(p, C, buildSeq) {
    const PC = window.PresenceChain, D2R = Math.PI / 180;
    this._chainsPending++;
    const img = new Image();
    img.onload = () => {
      if (buildSeq !== this._buildSeq) return;
      this._chainsPending--;
      const cvs = C.canvas || [1600, 1600];
      for (const geom of p.geoms) {
        const tune = { ...PC.CHAIN_TUNING[geom.tune], ...(geom.tuneMods || {}) };
        if (geom.wag) tune.wag = { ...(tune.wag || {}), classes: chainWagClasses(this.char, geom.droopScale) };
        const chain = new PC.Chain(tune, {
          anchor: { x: geom.anchor[0], y: geom.anchor[1] },
          dirAngle: geom.dir * D2R, segmentLength: geom.segLen,
          restPose: geom.restRot ? { rot: [0, ...geom.restRot.map((d) => d * D2R)] } : undefined,
        });
        if (geom.preRoll) { for (let i = 0; i < geom.preRoll; i++) chain.step(1 / 60); chain.captureRest(); }
        const view = new PC.ChainView(p.wrap, img, {
          canvas: cvs[0], canvasH: cvs[1],
          strip: { x: geom.strip[0], w: geom.strip[1] },
          bands: chainBands(chain, geom), overlap: geom.overlap == null ? 22 : geom.overlap,
        });
        this.chains.push({ name: p.name, geom, chain, view, stepper: PC.makeStepper(chain),
                           restAnchor: { x: geom.anchor[0], y: geom.anchor[1] } });
      }
    };
    img.onerror = () => { if (buildSeq === this._buildSeq) this._chainsPending--; };
    img.src = `${C.layerDir}/${p.name}.${C.ext || "png"}`;
  }
  get chainsReady() { return this._chainsPending === 0; }
  /* Verification hook: per-chain tip offset (native px from rest) and
     bend readouts, the chain-proof state() shape. */
  debugChains() {
    const D2R = Math.PI / 180;
    return this.chains.map((rec) => {
      const c = rec.chain, tip = c.tipOffset();
      let total = 0;
      for (let i = 2; i <= c.n; i++) total += Math.abs((c.rot[i] - c.rot[i - 1]) - (c.restRot[i] - c.restRot[i - 1]));
      return { layer: rec.name, tip: { x: +tip.x.toFixed(1), y: +tip.y.toFixed(1) },
               bendDeg: +(Math.abs(c.bendAngle()) / D2R).toFixed(2),
               totalBendDeg: +(total / D2R).toFixed(2) };
    });
  }
  _addBlush(C) {
    const img = document.createElement("img");
    img.src = `${C.layerDir}/${C.blush || "blush"}.${C.ext || "png"}`;
    img.alt = ""; img.dataset.layer = "blush";
    img.style.opacity = "0"; img.style.pointerEvents = "none";
    this.rootEl.appendChild(img); this.blushEl = img;
  }
  /* Wag hook: enable the tail-wag driver on a layer (Milo's tail once
     his set lands; the player's demo toggle points it at Clementine's
     ribbon as a stand-in). The driver writes the layer's rotation
     spring TARGET only — physics still owns the motion. */
  setWagLayer(name) {
    const keyFor = { hairback: "hairBack", hairfront: "hairFront", bust: "bust", ribbon: "ribbon", tail: "tail" };
    if (!name || !this.layerEls[name] || !keyFor[name]) { this.wag = null; this._wagEl = null; return; }
    this.wag = { layer: name, key: keyFor[name] };
    this._wagEl = this.layerEls[name];
  }
  wagClass() {
    const e = this.expression;
    if (e === "happy" || e === "proud" || e === "sparkle" || e === "closed_happy" || e === "wink") return "excited";
    if (e === "shy") return "shy";
    if (e === "sad") return "sad";
    if (e === "angry") return "angry";
    if (this.mouthLevel > 0) return "talking";
    return "idle";
  }
  mouthName(level) {
    const M = CHARACTERS[this.char].mouth || {};
    return M[level] || "talk";
  }
  setChar(c) { this.char = c; this.build(); }
  setMode(m) { this.mode = m; this.build(); }
  jawActive() {
    return this.mode === "layered" && !!CHARACTERS[this.char].jaw &&
      (this.mouthLevel > 0 || this.jawA > 0.03 || (this.debugJaw != null && this.debugJaw > 0));
  }
  currentFace() {
    /* Layered mode speaks through the two-piece jaw: the face plate is
       the open-mouth TALK plate and the jaw patch (cut from neutral)
       covers it to a continuous aperture. Sprite mode has no layers to
       split, so it keeps the graded static mouth bands. The phoneme
       path (Kokoro timestamps for live lines, Rhubarb for canned ones)
       plugs into the same aperture input later — today it is the RMS
       envelope, exactly as the bands use it. */
    if (this.jawActive()) return "talk";
    if (this.mouthLevel > 0) return this.mouthName(this.mouthLevel);
    if (this._eyeClosed()) return "blink";
    return this.expression;
  }
  /* The settled face with blink factored out — the gaze patch's
     safety list is written against these names. */
  _baseFace() {
    if (this.jawActive()) return "talk";
    if (this.mouthLevel > 0) return this.mouthName(this.mouthLevel);
    return this.expression;
  }
  _eyeClosed() {
    if (this.blinkPhase === "closing" || this.blinkPhase === "hold") return true;
    if (this.blinkPhase === "opening") return (this._nowMs - this.blinkT0) < BLINK_TUNING.openMs * 0.5;
    return false;
  }
  /* Blink machine (steal 1): Cubism phase times; a jaw character's
     blink waits for her mouth to shut (retry in 250 ms) — the old
     rule, kept. Triggered blinks queue behind an active one. */
  _startBlink(now, why) {
    if (CHARACTERS[this.char].jaw && this.mouthLevel > 0) { this.nextBlinkAt = now + 250; return; }
    this.blinkPhase = "closing"; this.blinkT0 = now; this._openFlip = false;
    this.blinkEvents.push({ t: Math.round(now), why });
    if (this.blinkEvents.length > 40) this.blinkEvents.shift();
    this._blinkCount++;
    if (why === "auto" && Math.random() < BLINK_TUNING.doubleChance) this._blinkQueued = true;
    this.applyExpression();
  }
  triggerBlink() {
    const now = performance.now();
    if (this.blinkPhase === "idle") this._startBlink(now, "trigger");
    else this._blinkQueued = true;
  }
  _blinkStep(now) {
    const B = BLINK_TUNING;
    if (this.blinkPhase === "idle") {
      if (now >= this.nextBlinkAt) this._startBlink(now, "auto");
      return;
    }
    const el = now - this.blinkT0;
    if (this.blinkPhase === "closing" && el >= B.closeMs) { this.blinkPhase = "hold"; this.blinkT0 = now; }
    else if (this.blinkPhase === "hold" && el >= B.holdMs) { this.blinkPhase = "opening"; this.blinkT0 = now; }
    else if (this.blinkPhase === "opening") {
      if (!this._openFlip && el >= B.openMs * 0.5) { this._openFlip = true; this.applyExpression(); }
      if (el >= B.openMs) {
        this.blinkPhase = "idle";
        if (this._blinkQueued) { this._blinkQueued = false; this._startBlink(now, "double"); }
        else this.nextBlinkAt = now + Math.max(B.intervalMinMs, 2 * B.intervalMeanMs * Math.random());
      }
    }
  }
  applyExpression() {
    const C = CHARACTERS[this.char], face = this.currentFace();
    // Crossfade times are per-expression data now (steal 4,
    // EXPR_MOTION): surprise snaps in ~60 ms, shy creeps in
    // ~250 ms, mouth bands stay snappy, blinks quickest.
    const rowFade = (EXPR_MOTION[face] || {}).fade;
    const fade = (face === "blink" || this._lastFace === "blink") ? 40 : (rowFade != null ? rowFade : 90);
    this._lastFace = face;
    if (this.mode === "sprite" && this.spriteStack) this.spriteStack.set(`${C.spriteDir}/${stateFile(C, face)}.${C.ext || "png"}`, fade);
    if (this.mode === "layered" && this.faceStack) this.faceStack.set(`${C.layerDir}/faces/${stateFile(C, face)}.${C.ext || "png"}`, fade);
  }
  setExpression(name, withImpulse = true) {
    const changed = name !== this.expression;
    this.expression = name; this.applyExpression();
    this.blushTarget = BLUSH_LEVEL[name] ?? 0;
    if (withImpulse) this.impulse(0, -46);
    if (changed) {
      /* Steals 1 + 5: a face change pops (Penner-flavored scale
         spring) and usually blinks — people blink when their
         expression changes. */
      this.facePop.v += 16;
      if (Math.random() < BLINK_TUNING.onExprChance) this.triggerBlink();
    }
    this.log("expression", { name });
  }
  /* The current expression's motion gain (steal 4): the row's gain
     times the character's scale. Every impulse is multiplied by
     it; speech-driven impulses additionally ride the performance
     dynamics (steal 8) when the caller passes { dyn: true }. */
  exprGain() {
    return ((EXPR_MOTION[this.expression] || {}).gain ?? 1) * (EXPR_CHAR_SCALE[this.char] ?? 1);
  }
  impulse(vx, vy, opts) {
    if (this.mode !== "layered") return;
    /* Steal 1: a strong lean draws a blink, like a head turn does. */
    if (Math.hypot(vx, vy) >= BLINK_TUNING.leanMin && Math.random() < BLINK_TUNING.onLeanChance) this.triggerBlink();
    const scale = this.exprGain() * (opts && opts.dyn ? this.dynGain : 1);
    vx *= scale; vy *= scale;
    const s = this.springs;
    if (s.hairBack) s.hairBack.kick(vx * 0.7, vy * 0.7);
    if (s.hairFront) s.hairFront.kick(vx * 0.85, vy * 0.85);
    if (s.ribbon) s.ribbon.kick(vx * 1.5, vy * 1.2);
    if (s.bust) s.bust.kick(vx * 0.35, vy * 0.55);
    if (s.body) s.body.kick(vx * 0.3, vy * 0.5);
    if (s.ponytail) s.ponytail.kick(vx * 1.1, vy * 1.0);
    if (s.veil_a) s.veil_a.kick(vx * 0.7, vy * 0.7);
    if (s.veil_b) s.veil_b.kick(vx * 1.2, vy * 1.0);
    if (s.tail) s.tail.kick(vx * 0.3, vy * 0.3);
    /* Chains (INTEGRATION merge point 4): the same impulse lands as
       tip-weighted angular momentum, calibrated against the proof.
       Speech onsets and expression pops flow through here too, so
       chained hair answers her voice exactly like the springs do. */
    const kv = vx * CHAIN_KICK.x + vy * CHAIN_KICK.y;
    if (kv) for (const rec of this.chains)
      rec.chain.kick(kv * (rec.geom.kickGain == null ? (rec.geom.wag ? 0.5 : 1) : rec.geom.kickGain));
  }
  /* Anticipation (steal 5): a 60-100 ms counter-dip + a blink,
     then the real move lands — hops and laughs read twice as big
     for the price of a 34 px dip. */
  anticipateDip() {
    this.impulse(0, ANTICIPATION_TUNING.dipVy, { dyn: false });
    this.squash.vx += SQUASH_TUNING.dipKick;
    this.triggerBlink();
  }
  hop(strength = 1) {
    this.anticipateDip();
    const at = performance.now() + ANTICIPATION_TUNING.dipMs;
    this._sched.push({ at, fn: () => {
      this.impulse(0, -190 * strength, { dyn: false });
      this.squash.vx += SQUASH_TUNING.hopKick * strength;
    } });
  }
  /* Gaze (steal 6): the demo points her at the visitor's cursor;
     anything else may point her anywhere in normalized stage
     space. With no fresh target she drifts on her own saccades. */
  setGazeTarget(x, y) {
    const cl = (v) => Math.max(-1, Math.min(1, v));
    this._gazeExt = { x: cl(x), y: cl(y), t: performance.now() };
    this._gazeNextAt = Math.min(this._gazeNextAt, performance.now() + 30);
  }
  releaseGaze() { this._gazeExt = null; }
  gazeToward(clientX, clientY) {
    const C = CHARACTERS[this.char];
    if (!C.gaze || !this.charEl.clientWidth) return;
    const r = this.charEl.getBoundingClientRect();
    const cvs = C.canvas || [1600, 1600];
    const ex = r.left + (C.gaze.eye[0] / cvs[0]) * r.width;
    const ey = r.top + (C.gaze.eye[1] / cvs[1]) * r.height;
    this.setGazeTarget((clientX - ex) / (r.width * 0.6), (clientY - ey) / (r.height * 0.6));
  }
  _gazeStep(now, dt) {
    const G = GAZE_TUNING, C = CHARACTERS[this.char];
    if (!this.gazeEl || !C.gaze) return;
    const extFresh = this._gazeExt && (now - this._gazeExt.t) <= G.staleMs;
    if (now >= this._gazeNextAt) {
      let gx, gy;
      if (extFresh) { gx = this._gazeExt.x; gy = this._gazeExt.y; }
      else {
        const a = Math.random() * Math.PI * 2, r = Math.random() * G.driftRadius;
        gx = Math.cos(a) * r; gy = Math.sin(a) * r * 0.7;
      }
      const mag = Math.hypot(gx, gy);
      let sector = "";
      if (mag >= G.centerDead) {
        const names = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];
        sector = names[((Math.round(Math.atan2(gy, gx) / (Math.PI / 4)) % 8) + 8) % 8];
      }
      if (sector !== this._gazeSector) {
        const jump = Math.hypot(gx - this._gazePt.x, gy - this._gazePt.y);
        this._gazeSector = sector; this._gazeChangedAt = now;
        if (jump > G.bigSaccade && Math.random() < 0.5) this.triggerBlink();
      }
      this._gazePt = { x: gx, y: gy };
      this._gazeNextAt = now + G.holdMinMs + Math.random() * (G.holdMaxMs - G.holdMinMs);
    }
    /* Head follow: a one-pole at the 100-200 ms lag toward the
       gaze point scaled to head travel (followPx ~ 14 px max eye
       travel x 0.35 coupling, research §2.5). */
    const k = 1 - Math.exp(-dt / (G.followLagMs / 1000));
    this._gazeFollow.x += (this._gazePt.x * G.followPx - this._gazeFollow.x) * k;
    this._gazeFollow.y += (this._gazePt.y * G.followPx - this._gazeFollow.y) * k;
    /* The patch shows only over a graded-safe settled face, only
       for a real sector, and never over a closing eye. */
    const show = this._gazeSector !== "" && C.gaze.safe.includes(this._baseFace()) && !this._eyeClosed();
    const want = show ? `${C.layerDir}/faces/gaze_${this._gazeSector}.${C.ext || "png"}` : null;
    if (want !== this._gazeShown) {
      this._gazeShown = want;
      if (want) { this.gazeEl.src = want; this.gazeEl.style.opacity = "1"; }
      else this.gazeEl.style.opacity = "0";
    }
  }
  /* Idle scheduler (steal 7): Shimeji grammar — weighted random
     acts, per-act cooldowns, hard conditions. Fires only in the
     quiet between lines; the act log is the suite's evidence. */
  _idleCfg() {
    const c = IDLE_TUNING.chars[this.char];
    const weights = {};
    for (const [a, row] of Object.entries(IDLE_TUNING.acts)) weights[a] = (c && c.acts && c.acts[a] != null) ? c.acts[a] : row.w;
    return { gap: (c && c.gapMs) || IDLE_TUNING.gapMs, weights };
  }
  _idleStep(now) {
    if (now < this._nextIdleAt) return;
    const cfg = this._idleCfg();
    this._nextIdleAt = now + cfg.gap[0] + Math.random() * (cfg.gap[1] - cfg.gap[0]);
    if (this.talking || this.env || this.envSmooth > 0.02) return;
    const S = this.springs;
    const pool = [];
    for (const [act, w] of Object.entries(cfg.weights)) {
      if (w <= 0) continue;
      if (now - (this._idleCd[act] || 0) < ((IDLE_TUNING.acts[act] || {}).cdMs || 0)) continue;
      if (act === "tailflick" && !(this.chains.some((r) => r.geom.wag) && this.wagClass() === "idle")) continue;
      if (act === "hairfix" && !(S.hairFront || this.chains.some((r) => r.name === "hairfront"))) continue;
      if (this.expression === "sad" && act !== "breath") continue;
      pool.push([act, w]);
    }
    if (!pool.length) return;
    let sum = 0; for (const [, w] of pool) sum += w;
    let r = Math.random() * sum, act = pool[0][0];
    for (const [a, w] of pool) { r -= w; if (r <= 0) { act = a; break; } }
    this._idleCd[act] = now;
    this._idleLog.push({ act, t: Math.round(now) });
    if (this._idleLog.length > 30) this._idleLog.shift();
    const g = this.gain;
    if (act === "sway") {
      const ms = g;
      if (S.hairBack) S.hairBack.kick((Math.random() - 0.5) * 56 * ms, -(4 + Math.random() * 12) * ms);
      if (S.hairFront) S.hairFront.kick((Math.random() - 0.5) * 34 * ms, -(3 + Math.random() * 8) * ms);
      if (S.ribbon) S.ribbon.kick((Math.random() - 0.5) * 78 * ms, -(5 + Math.random() * 14) * ms);
      if (S.bust) S.bust.kick(0, -(3 + Math.random() * 6) * ms);
      if (S.ponytail) S.ponytail.kick((Math.random() - 0.5) * 60 * ms, -(4 + Math.random() * 12) * ms);
      if (S.veil_b) S.veil_b.kick((Math.random() - 0.5) * 64 * ms, -(4 + Math.random() * 10) * ms);
      for (const rec of this.chains) {
        if (rec.geom.wag) continue;
        rec.chain.kick((Math.random() - 0.5) * 56 * ms * CHAIN_KICK.x * 0.8);
      }
    } else if (act === "look") {
      const a = Math.random() * Math.PI * 2, rr = 0.7 + Math.random() * 0.3;
      this._gazeExt = { x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.7, t: now };
      this._gazeNextAt = Math.min(this._gazeNextAt, now + 30);
    } else if (act === "hairfix") {
      if (S.hairFront) S.hairFront.kick((Math.random() - 0.5) * 30 * g, -26 * g);
      for (const rec of this.chains) if (rec.name === "hairfront") rec.chain.kick(0.25 * g * (Math.random() < 0.5 ? -1 : 1));
      this.triggerBlink();
    } else if (act === "stretch") {
      this.squash.vx += SQUASH_TUNING.actKick;
      this.impulse(0, -30, { dyn: false });
    } else if (act === "breath") {
      this._deepStart = now; this._deepUntil = now + BREATH_TUNING.deepMs;
    } else if (act === "tailflick") {
      this._flickUntil = now + 1300;
    }
    this.log("idle", { act });
  }
  breathBoost(now) {
    if (now >= this._deepUntil) return 1;
    const p = Math.min(1, Math.max(0, (now - this._deepStart) / BREATH_TUNING.deepMs));
    return 1 + BREATH_TUNING.deepBoost * Math.sin(Math.PI * p);
  }
  /* Verification hooks (Motion Pass 2 suite): measured state for
     blink timing, breath, squash, gaze, idle and dynamics. */
  debugBlink() {
    const iv = [];
    for (let i = 1; i < this.blinkEvents.length; i++) iv.push(this.blinkEvents[i].t - this.blinkEvents[i - 1].t);
    return { count: this._blinkCount, phase: this.blinkPhase,
             intervals: iv.slice(-12), events: this.blinkEvents.slice(-8) };
  }
  debugGaze() {
    return { sector: this._gazeSector, pt: { x: +this._gazePt.x.toFixed(2), y: +this._gazePt.y.toFixed(2) },
             follow: { x: +this._gazeFollow.x.toFixed(2), y: +this._gazeFollow.y.toFixed(2) },
             shown: this._gazeShown, changedAt: this._gazeChangedAt };
  }
  debugMotion() {
    const peak = this._squashPeak; this._squashPeak = this.squash.x;
    return { blink: this.debugBlink(), gaze: this.debugGaze(),
             breathAmp: BREATH_TUNING.amp[this.char] ?? 1,
             squash: { now: +this.squash.x.toFixed(3), peak: +peak.toFixed(3) },
             idle: this._idleLog.slice(-12),
             perf: { dynGain: +this.dynGain.toFixed(3), dynMin: +this._dynMin.toFixed(3),
                     dynMax: +this._dynMax.toFixed(3), envSlow: +this.envSlow.toFixed(3) },
             lift: +this.liftSm.toFixed(3), exprGain: +this.exprGain().toFixed(3) };
  }
  debugPerf() { return this.debugMotion().perf; }
  async playLine(url) {
    const env = await loadEnvelope(url);
    this.env = env;
    this._escUsed = false; this._escHot = 0;   // per-line escalation budget (steal 8)
    this.voiceEl.src = url;
    await this.voiceEl.play().catch(() => {});
    this.log("speech-start", { url });
    return new Promise((res) => {
      this.voiceEl.onended = () => { this.env = null; this.log("speech-end", { url }); res(); };
    });
  }
  envelopeNow() {
    if (!this.env || this.voiceEl.paused || this.voiceEl.ended) return 0;
    const idx = Math.floor(this.voiceEl.currentTime * BUCKETS_PER_SEC);
    return idx < this.env.buckets.length ? this.env.buckets[idx] : 0;
  }
  tick(now, dt) {
    /* Envelope smoothing: one-pole on the raw RMS buckets — fast attack
       (~15 ms time constant) so speech onsets stay crisp, slow release
       (~120 ms) so the mouth settles instead of jittering bucket to
       bucket and `talking` holds through syllable gaps. Everything
       below (talk state, bounce, impulse trigger) reads the smoothed
       value; the buckets themselves are unchanged. */
    const rawEnv = this.envelopeNow();
    const tcEnv = rawEnv > this.envSmooth ? 0.015 : 0.120;
    this.envSmooth += (rawEnv - this.envSmooth) * (1 - Math.exp(-dt / tcEnv));
    const env = this.envSmooth;
    /* Graded mouth: band the smoothed envelope into openness levels
       with hysteresis (Rin's lesson from the Kyndred teardown) — a
       half-open mouth for quiet speech, full-open for loud, instead of
       a binary flap. Bands: 0 below ~0.16, 1 to ~0.50, 2 above. */
    const HI = 0.50, LO = 0.16;
    let ml = this.mouthLevel;
    if (ml === 0) { if (env > HI) ml = 2; else if (env > LO) ml = 1; }
    else if (ml === 1) { if (env > HI + 0.05) ml = 2; else if (env < LO - 0.04) ml = 0; }
    else if (env < LO - 0.04) ml = 0; else if (env < HI - 0.07) ml = 1;
    if (ml !== this.mouthLevel) { this.mouthLevel = ml; this.applyExpression(); }
    this.talking = ml > 0;
    this._nowMs = now;
    this._blinkStep(now);
    /* Timed beats (anticipation -> hop landing, steal 5). */
    for (let i = this._sched.length - 1; i >= 0; i--)
      if (now >= this._sched[i].at) { const s = this._sched.splice(i, 1)[0]; s.fn(); }
    /* Performance dynamics (steal 8): the slowed envelope scales
       speech-driven motion; a sustained peak on a happy face may
       escalate the expression one notch, once per line. */
    this.envSlow += (env - this.envSlow) * (1 - Math.exp(-dt / (DYN_TUNING.tcMs / 1000)));
    this.dynGain = DYN_TUNING.base + DYN_TUNING.span * this.envSlow;
    if (this.dynGain < this._dynMin) this._dynMin = this.dynGain;
    if (this.dynGain > this._dynMax) this._dynMax = this.dynGain;
    if (this.flags.escalate && this.talking && this.expression === "happy" && !this._escUsed) {
      if (this.envSlow > DYN_TUNING.escHot) {
        this._escHot += dt * 1000;
        if (this._escHot >= DYN_TUNING.escHoldMs) { this._escUsed = true; this.setExpression("closed_happy", false); }
      } else this._escHot = 0;
    } else this._escHot = 0;
    /* Talk-lift (steal 4): the head rises while she speaks. */
    this.liftSm += ((this.talking ? 1 : 0) - this.liftSm) *
      (1 - Math.exp(-dt / ((this.talking ? LIFT_TUNING.attackMs : LIFT_TUNING.releaseMs) / 1000)));
    this._gazeStep(now, dt);
    if (this.spriteStack) this.spriteStack.update(dt);
    if (this.faceStack) this.faceStack.update(dt);
    if (this.blushEl) {   // dynamic blush: ease toward the expression's level
      this.blushO += (this.blushTarget - this.blushO) * (1 - Math.exp(-dt / 0.12));
      if (Math.abs(this.blushTarget - this.blushO) < 0.004) this.blushO = this.blushTarget;
      this.blushEl.style.opacity = this.blushO.toFixed(3);
    }
    const t = now / 1000;
    /* Breath stack (steal 2): four incommensurate sines replace the
       old two-sine sway — the root pair lands here as the spring
       targets; the face sine and the slow rotation join at the
       transform stage below. */
    const bAmp = (BREATH_TUNING.amp[this.char] ?? 1) * this.breathBoost(now);
    const brX = Math.sin(t * 2 * Math.PI / BREATH_TUNING.rootX.period + BREATH_TUNING.rootX.phase) * BREATH_TUNING.rootX.amp * bAmp;
    const brY = Math.sin(t * 2 * Math.PI / BREATH_TUNING.rootY.period + BREATH_TUNING.rootY.phase) * BREATH_TUNING.rootY.amp * bAmp;
    this._brF = Math.sin(t * 2 * Math.PI / BREATH_TUNING.faceY.period + BREATH_TUNING.faceY.phase) * BREATH_TUNING.faceY.amp * bAmp;
    this._brRot = Math.sin(t * 2 * Math.PI / BREATH_TUNING.rootR.period + BREATH_TUNING.rootR.phase) * BREATH_TUNING.rootR.amp * bAmp;
    this._brY = brY;
    const mx = brX * this.gain;
    /* Speech bounce eased through a ~70 ms one-pole on top of the
       smoothed envelope — continuous in and out, no linear segments. */
    this.bounceSm += ((-env * 13) - this.bounceSm) * (1 - Math.exp(-dt / 0.07));
    const my = (brY + this.bounceSm) * this.gain;
    if (env > 0.30 && this.prevEnv <= 0.30 && this.mode === "layered") this.impulse(0, -52 * this.gain, { dyn: true });
    this.prevEnv = env;
    /* Squash & stretch (steal 3): sy springs toward 1 + a speech
       swell (envelope x expression gain x performance dynamics),
       hard-clamped to the ceiling; the root wrapper applies the
       volume-conserving scale and the breath stack's slow
       rotation in both modes. */
    this.squash.step(dt, 1 + env * SQUASH_TUNING.speechGain * this.exprGain() * this.dynGain, 0);
    if (this.squash.x > SQUASH_TUNING.max) this.squash.x = SQUASH_TUNING.max;
    if (this.squash.x < SQUASH_TUNING.min) this.squash.x = SQUASH_TUNING.min;
    if (this.squash.x > this._squashPeak) this._squashPeak = this.squash.x;
    const sy = this.squash.x, sxr = 1 / Math.sqrt(sy);
    if (this.rootEl) this.rootEl.style.transform =
      `rotate(${(this._brRot || 0).toFixed(3)}deg) scale(${sxr.toFixed(4)}, ${sy.toFixed(4)})`;
    if (this.mode === "sprite") {
      const s = this.spriteSpring;
      s.step(dt, mx, my);
      if (this.spriteStack) {
        const tf = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        for (const el of this.spriteStack.els) el.style.transform = tf;
        if (this.blushEl) this.blushEl.style.transform = tf;
      }
      return;
    }
    const S = this.springs, body = S.body;
    /* Idle behavior scheduler (steal 7): the old micro-impulse
       scheduler grew up into the Shimeji grammar — the sway act
       inside it IS the old micro-kick, at the same density. */
    this._idleStep(now);
    /* Tail-wag driver: resolves the emotion class, eases hz/amp, and
       writes ONLY the wag spring's target angle (one-writer law). */
    if (this.wag) {
      const WT = (WAG_TUNING[this.char] || WAG_TUNING.default)[this.wagClass()];
      let ampT = WT.amp;
      if (WT.bursts) {
        if (now >= this.wagGateAt) {
          this.wagGateOn = !this.wagGateOn;
          const onW = WT.burstOn || [2200, 1600], offW = WT.burstOff || [2500, 3000];
          this.wagGateAt = now + (this.wagGateOn ? onW[0] + Math.random() * onW[1] : offW[0] + Math.random() * offW[1]);
        }
        if (!this.wagGateOn) ampT = 0;
      }
      this.wagAmpSm += (ampT - this.wagAmpSm) * (1 - Math.exp(-dt / 0.25));
      this.wagHzSm += (WT.hz - this.wagHzSm) * (1 - Math.exp(-dt / 0.30));
      this.wagPhase += 2 * Math.PI * this.wagHzSm * dt;
      this.wagSpring.step(dt, (WT.droop || 0) + Math.sin(this.wagPhase) * this.wagAmpSm * WAG_MAX_DEG);
      this.wagAngle = this.wagSpring.a;
    }
    body.step(dt, mx, my);
    const Kdisp = (this.charEl.clientHeight || 1600) / ((CHARACTERS[this.char].canvas || [1600, 1600])[1]);
    const liftPx = this.liftSm * LIFT_TUNING.px * Kdisp;
    const set = (el, spr, tune, name) => {
      if (!el || !spr) return;
      spr.step(dt, mx * tune.gainX * this.gain, my * tune.gainY * this.gain);
      let x = spr.x, y = spr.y;
      if (tune.clamp) { x = Math.max(-tune.clamp, Math.min(tune.clamp, x)); y = Math.max(-tune.clamp, Math.min(tune.clamp, y)); }
      let rot = Math.max(-7, Math.min(7, -spr.vx * 0.028 * tune.rot));
      if (this.wag && el === this._wagEl) rot = this.wagAngle;  // wag spring owns this layer's rotation
      if (tune.lift) y -= liftPx * tune.lift;                  // talk-lift stirs the hair (steal 4)
      if (name === "bust") y += (this._brY || 0) * BREATH_TUNING.bustShare;  // the bust breathes (steal 2)
      const sg = SQUASH_TUNING.stretchGain[name] ?? 0.3;       // per-layer stretch gain (steal 3)
      const lsy = 1 + (sy - 1) * sg, lsx = 1 / Math.sqrt(lsy);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${lsx.toFixed(4)}, ${lsy.toFixed(4)})`;
    };
    const bt = `translate(${body.x.toFixed(1)}px, ${body.y.toFixed(1)}px)`;
    if (this.underlayEl) this.underlayEl.style.transform = bt;
    if (this.layerEls.body) this.layerEls.body.style.transform = bt;
    /* The face GROUP (face stack + gaze patch + blush; the jaw is
       prefixed with the same transform below): body-locked, plus
       the talk-lift, the breath stack's face sine, the gaze
       head-follow and the expression pop — the head leads, the
       body follows (steals 2 / 4 / 5 / 6). */
    this.facePop.step(dt, 0);
    const popS = 1 + this.facePop.a * 0.045;
    const fx = (this._gazeFollow.x || 0) * Kdisp;
    const fy = (this._gazeFollow.y || 0) * Kdisp - liftPx + (this._brF || 0);
    const faceTf = bt + ` translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) scale(${popS.toFixed(4)})`;
    if (this.faceStack) for (const el of this.faceStack.els) el.style.transform = faceTf; // face locked to the head
    if (this.gazeEl) this.gazeEl.style.transform = faceTf;
    if (this.blushEl) this.blushEl.style.transform = faceTf;
    /* Two-piece jaw: aperture eased from the smoothed envelope, angle
       through its own spring (lag + a whisper of overshoot). */
    const CJ = CHARACTERS[this.char];
    if (this.jawEl && CJ.jaw) {
      const aT = this.debugJaw != null ? this.debugJaw
        : this.mouthLevel > 0 ? Math.min(1, env * 1.25) : 0;
      const prevA = this.jawA;
      const tcJ = aT > this.jawA ? 0.030 : 0.060;
      this.jawA += (aT - this.jawA) * (1 - Math.exp(-dt / tcJ));
      this.jawSpring.step(dt, this.jawA * CJ.jaw.maxDeg);
      this.jawEl.style.opacity = (this.mouthLevel > 0 || this.jawA > 0.01 || this.debugJaw) ? "1" : "0";
      this.jawEl.style.transform = faceTf + ` rotate(${this.jawSpring.a.toFixed(2)}deg) translateY(${(this.jawA * 7).toFixed(1)}px)`;
      if (this.mouthLevel === 0 && prevA >= 0.03 && this.jawA < 0.03) this.applyExpression();
    }
    for (const L of this._springLayers) set(L.el, L.spr, L.tune, L.name);
    /* Chains (INTEGRATION merge point 3): each chain's anchor follows
       the body spring's displacement (read from the spring, never the
       DOM), converted from display px to native px; the fixed-step
       stepper quantizes to 1/60 s regardless of caller dt, so the
       live rAF and the deterministic capture clock agree frame-for-
       frame. Tail chains take the wag class every tick (merge point
       5: setWag only re-reads targets — phase and smoothing live
       inside the chain and are never reset). */
    if (this.chains.length) {
      const CC = CHARACTERS[this.char], cvs = CC.canvas || [1600, 1600];
      const Kx = cvs[0] / (this.charEl.clientWidth || cvs[0]);
      const Ky = cvs[1] / (this.charEl.clientHeight || cvs[1]);
      const wagCls = now < this._flickUntil ? "excited" : this.wagClass();
      for (const p of this._pendingChains) {
        /* Squash on the wrap, pivoting at the chain's anchor —
           chained hair/tails stretch around their roots (steal 3). */
        const sgw = SQUASH_TUNING.stretchGain[p.name] ?? 0.6;
        const wsy = 1 + (sy - 1) * sgw;
        p.wrap.style.transform = `scale(${(1 / Math.sqrt(wsy)).toFixed(4)}, ${wsy.toFixed(4)})`;
      }
      for (const rec of this.chains) {
        rec.chain.setAnchor(rec.restAnchor.x + body.x * Kx, rec.restAnchor.y + body.y * Ky);
        if (rec.geom.wag) rec.chain.setWag(wagCls);
        rec.stepper.advance(dt);
        rec.view.update(rec.chain, 1 / Kx, 1 / Ky);
      }
    }
  }
}

window.PresenceStage = { Avatar, loadEnvelope, SPRING_TUNING, SPRING_OVERRIDES, WAG_TUNING, BLUSH_LEVEL, EXPRESSIONS, CHARACTERS, BUCKETS_PER_SEC,
  BLINK_TUNING, BREATH_TUNING, SQUASH_TUNING, EXPR_MOTION, EXPR_CHAR_SCALE, LIFT_TUNING, GAZE_TUNING, IDLE_TUNING, DYN_TUNING, ANTICIPATION_TUNING };
})();
