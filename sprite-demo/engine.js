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
  hairBack:  { omega:  9.5, zeta: 0.42, gainX: 1.50, gainY: 1.35, rot: 0.55 },
  hairFront: { omega: 10.5, zeta: 0.46, gainX: 1.15, gainY: 1.10, rot: 0.30 },
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
/* Dynamic blush — one overlay plate per character; opacity follows the
   active expression (the dictionary's blush parameter, sprite form). */
const BLUSH_LEVEL = { shy: 0.95, closed_happy: 0.50, sparkle: 0.45, happy: 0.35,
                      wink: 0.30, proud: 0.30, smug: 0.20 };
const EXPRESSIONS = ["neutral", "happy", "closed_happy", "wink", "sparkle", "smug",
                     "sad", "surprised", "angry", "thinking", "shy", "proud"];
const CHARACTERS = {
  paige: { label: "Paige", spriteDir: "assets/paige", layerDir: "assets/paige-layers",
           layers: ["hairback", "body", "bust", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           jaw: { pivot: "50.6% 35.5%", maxDeg: 9 },
           pivots: { bust: "50% 60%", hairback: "50% 16%", hairfront: "50% 14%" } },
  clem:  { label: "Clementine", spriteDir: "assets/clem", layerDir: "assets/clem-layers",
           layers: ["hairback", "ribbon", "body", "bust", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           jaw: { pivot: "50.5% 35.6%", maxDeg: 10 },
           pivots: { bust: "52% 63%", ribbon: "30% 22%", hairback: "50% 16%", hairfront: "50% 14%" } },
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
           layers: ["hairback", "tail", "body", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { hairback: "50% 8%", hairfront: "50% 10%", tail: "74.9% 85.7%" },
           layerSprings: { hairback: { gainX: 1.40, gainY: 1.25 },
                           tail: { omega: 9.5, zeta: 0.42, gainX: 1.60, gainY: 1.20, rot: 1.40 } },
           tail: { layer: "tail" } },
  juno:  { label: "Juno", spriteDir: "assets/juno", layerDir: "assets/juno-layers",
           layers: ["hairback", "ponytail", "body", "bust", "whistle", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { hairback: "50% 10%", hairfront: "50% 12%", ponytail: "59% 11%",
                     whistle: "48.1% 43.1%", bust: "50% 60%" },
           layerSprings: { ponytail: { omega: 8.5, zeta: 0.38, gainX: 1.70, gainY: 1.30, rot: 1.50 },
                           whistle: { omega: 8.0, zeta: 0.45, gainX: 0.80, gainY: 0.90, rot: 1.20 },
                           bust: { gainX: 0.30, gainY: 0.45, clamp: 5 } } },
  vesper:{ label: "Vesper", spriteDir: "assets/vesper", layerDir: "assets/vesper-layers",
           layers: ["veil_a", "veil_b", "body", "bust", "choker", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { veil_a: "50% 8%", veil_b: "50% 8%", choker: "50.4% 34.5%",
                     hairfront: "50% 12%", bust: "50% 60%" },
           layerSprings: { veil_a: { omega: 9.5, zeta: 0.42, gainX: 1.20, gainY: 1.10, rot: 0.30 },
                           veil_b: { omega: 8.0, zeta: 0.38, gainX: 1.80, gainY: 1.50, rot: 0.70 },
                           choker: { omega: 11.0, zeta: 0.55, gainX: 0.15, gainY: 0.15, rot: 0.05 },
                           bust: { omega: 9.0, zeta: 0.48, gainX: 0.28, gainY: 0.40, clamp: 5 } } },
  mochi: { label: "Mochi", spriteDir: "assets/mochi", layerDir: "assets/mochi-layers",
           aspect: 1344 / 1728,
           layers: ["hairback", "tail", "body", "tag", "face", "hairfront"],
           mouth: { 1: "talk_half", 2: "talk" },
           stateMap: { closed_happy: "closedhappy", talk_half: "talkhalf", smug: "halflid" },
           blush: "faces/blush",
           pivots: { hairback: "50% 8%", hairfront: "50% 10%", tail: "74.8% 78.4%", tag: "47.8% 34.5%" },
           layerSprings: { hairback: { gainX: 1.30, gainY: 1.15 },
                           tail: { omega: 9.5, zeta: 0.42, gainX: 1.60, gainY: 1.20, rot: 1.40 },
                           tag: { omega: 10.0, zeta: 0.50, gainX: 0.25, gainY: 0.30, rot: 0.30 } },
           tail: { layer: "tail" } },
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
    this.nextBlink = performance.now() + 2600; this.blinkUntil = 0;
    this.gain = 1.0; this.prevEnv = 0;
    this.envSmooth = 0; this.bounceSm = 0; this._lastFace = "neutral";
    this.mouthLevel = 0;                            // graded mouth band 0/1/2
    this.blushO = 0; this.blushTarget = 0; this.blushEl = null;
    this.nextMicro = 2500 + Math.random() * 2000;   // micro-impulse scheduler
    this.wag = null; this._wagEl = null;            // tail wag (driver->target)
    this.wagSpring = new RotSpring(18, 0.6);
    this.wagPhase = 0; this.wagHzSm = 0; this.wagAmpSm = 0; this.wagAngle = 0;
    this.wagGateOn = false; this.wagGateAt = 1200;  // idle burst gating
    this.jawA = 0; this.jawSpring = new RotSpring(26, 0.55); this.jawEl = null;
    this.debugJaw = null;                           // verification hook (0..1)
    this.springs = {}; this.layerEls = {}; this.spriteEl = null; this.faceEl = null;
    this.spriteStack = null; this.faceStack = null;
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
  }
  build() {
    this.charEl.innerHTML = ""; this.layerEls = {}; this.spriteEl = null; this.faceEl = null;
    this.spriteStack = null; this.faceStack = null; this.blushEl = null; this.jawEl = null;
    this.underlayEl = null;
    this.wag = null; this._wagEl = null; this._springLayers = [];
    const C = CHARACTERS[this.char];
    this.tuning = {};
    for (const k of Object.keys(SPRING_TUNING))
      this.tuning[k] = { ...SPRING_TUNING[k], ...((SPRING_OVERRIDES[this.char] || {})[k] || {}) };
    this.preloadFaces(C);
    if (this.mode === "sprite") {
      const bottom = document.createElement("img");
      bottom.className = "base"; bottom.alt = C.label;
      const top = document.createElement("img");
      top.alt = "";
      this.charEl.appendChild(bottom); this.charEl.appendChild(top);
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
      this.charEl.appendChild(under); this.underlayEl = under;
      for (const name of C.layers) {
        if (name === "face") {
          const bottom = document.createElement("img");
          bottom.alt = ""; bottom.dataset.layer = "face";
          const top = document.createElement("img");
          top.alt = ""; top.dataset.layer = "face";
          this.charEl.appendChild(bottom); this.charEl.appendChild(top);
          this.faceStack = new FadeStack(bottom, top);
          this.faceStack.set(`${C.layerDir}/faces/neutral.${C.ext || "png"}`, 0);
          this.faceEl = bottom;
          this._addBlush(C);   // blush rides above the face, under front hair
          if (C.jaw) {         // two-piece mouth: jaw patch above the face
            const jw = document.createElement("img");
            jw.src = `${C.layerDir}/jaw.${C.ext || "png"}`;
            jw.alt = ""; jw.dataset.layer = "jaw";
            jw.style.transformOrigin = C.jaw.pivot;
            jw.style.opacity = "0"; jw.style.pointerEvents = "none";
            this.charEl.appendChild(jw); this.jawEl = jw;
          }
          continue;
        }
        const img = document.createElement("img");
        img.src = `${C.layerDir}/${name}.${C.ext || "png"}`;
        img.alt = ""; img.dataset.layer = name;
        if (C.pivots[name]) img.style.transformOrigin = C.pivots[name];
        this.charEl.appendChild(img); this.layerEls[name] = img;
      }
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
        this._springLayers.push({ el: this.layerEls[name], spr, tune: spec });
        if (key) this.springs[key] = spr;
        this.springs[name] = spr;
      }
      if (C.tail && this.layerEls[C.tail.layer]) this.setWagLayer(C.tail.layer);
    }
    this.applyExpression();
  }
  _addBlush(C) {
    const img = document.createElement("img");
    img.src = `${C.layerDir}/${C.blush || "blush"}.${C.ext || "png"}`;
    img.alt = ""; img.dataset.layer = "blush";
    img.style.opacity = "0"; img.style.pointerEvents = "none";
    this.charEl.appendChild(img); this.blushEl = img;
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
    if (performance.now() < this.blinkUntil) return "blink";
    return this.expression;
  }
  applyExpression() {
    const C = CHARACTERS[this.char], face = this.currentFace();
    // Blinks are quick (45 ms); mouth-band swaps snappy (50 ms);
    // expression swaps get the full ~90 ms.
    const isMouth = face.startsWith("talk") || this._lastFace.startsWith("talk");
    const fade = (face === "blink" || this._lastFace === "blink") ? 45 : isMouth ? 50 : 90;
    this._lastFace = face;
    if (this.mode === "sprite" && this.spriteStack) this.spriteStack.set(`${C.spriteDir}/${stateFile(C, face)}.${C.ext || "png"}`, fade);
    if (this.mode === "layered" && this.faceStack) this.faceStack.set(`${C.layerDir}/faces/${stateFile(C, face)}.${C.ext || "png"}`, fade);
  }
  setExpression(name, withImpulse = true) {
    this.expression = name; this.applyExpression();
    this.blushTarget = BLUSH_LEVEL[name] ?? 0;
    if (withImpulse) this.impulse(0, -46);
    this.log("expression", { name });
  }
  impulse(vx, vy) {
    if (this.mode !== "layered") return;
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
  }
  async playLine(url) {
    const env = await loadEnvelope(url);
    this.env = env;
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
    if (now > this.nextBlink) { this.blinkUntil = now + 140; this.nextBlink = now + 2200 + Math.random() * 3000; this.applyExpression(); }
    if (this.blinkUntil && now > this.blinkUntil && !this.talking) { this.blinkUntil = 0; this.applyExpression(); }
    if (this.spriteStack) this.spriteStack.update(dt);
    if (this.faceStack) this.faceStack.update(dt);
    if (this.blushEl) {   // dynamic blush: ease toward the expression's level
      this.blushO += (this.blushTarget - this.blushO) * (1 - Math.exp(-dt / 0.12));
      if (Math.abs(this.blushTarget - this.blushO) < 0.004) this.blushO = this.blushTarget;
      this.blushEl.style.opacity = this.blushO.toFixed(3);
    }
    const t = now / 1000;
    const mx = Math.sin(t * 0.9) * 2.1 * this.gain;
    /* Speech bounce eased through a ~70 ms one-pole on top of the
       smoothed envelope — continuous in and out, no linear segments. */
    this.bounceSm += ((-env * 13) - this.bounceSm) * (1 - Math.exp(-dt / 0.07));
    const my = (Math.sin(t * 1.55) * 1.15 + this.bounceSm) * this.gain;
    if (env > 0.30 && this.prevEnv <= 0.30 && this.mode === "layered") this.impulse(0, -52 * this.gain);
    this.prevEnv = env;
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
    /* Micro-impulse scheduler (the blink scheduler's sibling): small
       randomized spring kicks to hair/ribbon/bust so she idles alive
       between beats. Half strength while talking. */
    if (now >= this.nextMicro) {
      this.nextMicro = now + 1600 + Math.random() * 3200;
      const ms = (this.talking ? 0.5 : 1.0) * this.gain;
      if (S.hairBack) S.hairBack.kick((Math.random() - 0.5) * 56 * ms, -(4 + Math.random() * 12) * ms);
      if (S.hairFront) S.hairFront.kick((Math.random() - 0.5) * 34 * ms, -(3 + Math.random() * 8) * ms);
      if (S.ribbon) S.ribbon.kick((Math.random() - 0.5) * 78 * ms, -(5 + Math.random() * 14) * ms);
      if (S.bust) S.bust.kick(0, -(3 + Math.random() * 6) * ms);
      if (S.ponytail) S.ponytail.kick((Math.random() - 0.5) * 60 * ms, -(4 + Math.random() * 12) * ms);
      if (S.veil_b) S.veil_b.kick((Math.random() - 0.5) * 64 * ms, -(4 + Math.random() * 10) * ms);
    }
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
    const set = (el, spr, tune) => {
      if (!el || !spr) return;
      spr.step(dt, mx * tune.gainX * this.gain, my * tune.gainY * this.gain);
      let x = spr.x, y = spr.y;
      if (tune.clamp) { x = Math.max(-tune.clamp, Math.min(tune.clamp, x)); y = Math.max(-tune.clamp, Math.min(tune.clamp, y)); }
      let rot = Math.max(-7, Math.min(7, -spr.vx * 0.028 * tune.rot));
      if (this.wag && el === this._wagEl) rot = this.wagAngle;  // wag spring owns this layer's rotation
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
    };
    const bt = `translate(${body.x.toFixed(1)}px, ${body.y.toFixed(1)}px)`;
    if (this.underlayEl) this.underlayEl.style.transform = bt;
    if (this.layerEls.body) this.layerEls.body.style.transform = bt;
    if (this.faceStack) for (const el of this.faceStack.els) el.style.transform = bt; // face locked to the head
    if (this.blushEl) this.blushEl.style.transform = bt;
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
      this.jawEl.style.transform = bt + ` rotate(${this.jawSpring.a.toFixed(2)}deg) translateY(${(this.jawA * 7).toFixed(1)}px)`;
      if (this.mouthLevel === 0 && prevA >= 0.03 && this.jawA < 0.03) this.applyExpression();
    }
    for (const L of this._springLayers) set(L.el, L.spr, L.tune);
  }
}

window.PresenceStage = { Avatar, loadEnvelope, SPRING_TUNING, SPRING_OVERRIDES, WAG_TUNING, BLUSH_LEVEL, EXPRESSIONS, CHARACTERS, BUCKETS_PER_SEC };
})();
