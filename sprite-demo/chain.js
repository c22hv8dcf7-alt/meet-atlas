"use strict";
/* =====================================================================
   Atlas Presence — segmented-chain physics for sprite layers.
   A dependency-free JS port of PNGTuber Remix's WigglyAppendage2D
   model (MIT; addons/wiggly_appendage_2d in MudkipWorld/PNGTuber-Remix).
   We port the MATH, not the app (Remix's macOS builds are discontinued):
   the appendage is a chain of N rigid segments whose JOINT ANGLES are
   the simulated state — each joint carries an angle + angular momentum,
   is pulled toward an ideal angle (previous joint's angle + curvature)
   by a signed-square-root spring force, torqued by gravity, braked by
   Remix's sign-flip damping rule, and hard-clamped to maxAngle with a
   comeback crawl. Positions are pure forward kinematics from the root,
   so segments never stretch. The root position itself is exponentially
   smoothed (root_follow_smoothness), which is where the follow-through
   whip comes from when the head/body jerks.

   Auto Wag is ported from Remix's append_object.gd: wag does not move
   the root — it OSCILLATES THE CURVATURE:
       curvature(t) = clamp(sin(2*pi*hz*t) * wagSpeed, wagMin, wagMax)
   Our wag classes (excited / talking / idle / shy / sad / angry) reuse
   the engine's WAG_TUNING vocabulary (hz, amp, droop): amp is
   normalized against wag.maxCurvature (Remix's wag_speed default 0.5
   rad), droop is a constant root-direction offset, and per-joint wag
   weights play the role of Remix's curvature_exponent (later joints
   flex more). One deliberate extension, flagged in INTEGRATION.md:
   curvature may be given as a per-joint ARRAY (a fitted rest curl,
   e.g. Milo's tail) instead of Remix's scalar + exponent pair; the
   scalar form is still supported and behaves exactly like Remix.

   NOT ported: Remix's two-anchor verlet stretch mode
   (_apply_verlet_anchor / keep_length) — every appendage in our cast
   is single-anchor.

   Determinism: step(dt) reads no wall clock and no Math.random. All
   time enters through dt, so the deterministic 60 fps capture clock
   can drive chains frame-exactly (call step(1/60) once per virtual
   frame, or use makeStepper for a fixed-step accumulator).
   Units: native canvas pixels (1600-space), radians, seconds.
   ===================================================================== */
(function (global) {

const TAU = Math.PI * 2;
function angDiff(a, b) { // shortest signed a-b, wrapped to (-PI, PI]
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU; else if (d <= -Math.PI) d += TAU;
  return d;
}
function signedSqrt(v) { return Math.sqrt(Math.abs(v)) * Math.sign(v); }
function lerpAngle(a, b, t) { return a + angDiff(b, a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/* CHAIN TUNING — data, mirroring SPRING_TUNING's style in engine.js.
   Field names track Remix's exports so values can be compared against
   Remix scenes directly (their demo tail: stiffness 20 default,
   max_angle 0.52, comeback_speed 0.419, damping 5,
   max_angular_momentum 20, stiffness_decay_exponent up to 5).
   stiffness/damping here are Remix's raw units, NOT omega/zeta.
   gravity is a vector like Remix's; only its length + angle are used
   (pendulum torque), so FK-mode values live in single digits. */
const CHAIN_TUNING = {
  hairBack: {
    segments: 7, stiffness: 16, stiffnessDecay: 0.35, stiffnessDecayExponent: 1.5,
    damping: 5.0, maxAngle: 0.60, comebackSpeed: 0.40, maxAngularMomentum: 16,
    gravity: { x: 0, y: 5 }, curvature: 0.0, curvatureExponent: 0,
    stiffRootCount: 2, rootFollow: 0.65,
  },
  hairFront: {
    segments: 4, stiffness: 20, stiffnessDecay: 0.30, stiffnessDecayExponent: 1.5,
    damping: 5.0, maxAngle: 0.50, comebackSpeed: 0.40, maxAngularMomentum: 14,
    gravity: { x: 0, y: 4 }, curvature: 0.0, curvatureExponent: 0,
    stiffRootCount: 2, rootFollow: 0.70,
  },
  tail: {
    segments: 4, stiffness: 15, stiffnessDecay: 0.30, stiffnessDecayExponent: 1.5,
    damping: 4.5, maxAngle: 1.10, comebackSpeed: 2.2, maxAngularMomentum: 20,
    gravity: { x: 0, y: 2.5 },
    // Fitted rest curl for Milo's tail (per-joint turn, radians) —
    // his tail exits the sweater heading up-left, runs nearly straight,
    // then curls hard at the last two joints. See INTEGRATION.md.
    curvaturePerJoint: [-0.05, -0.02, -0.56, -0.54],
    stiffRootCount: 1, rootFollow: 0.80,
    wag: {
      // amp 1.0 = 0.22 rad/joint of curvature oscillation. (Remix's
      // wag_speed default is 0.5 rad, but that is tuned for their slow
      // tick-rate sway; at our 2.6 Hz excited wag it saturates the
      // maxAngle clamp and the comeback crawl strangles the frequency.
      // comebackSpeed is raised for the same reason — see INTEGRATION.)
      maxCurvature: 0.22,                   // curvature rad at amp 1.0
      min: -Math.PI, max: Math.PI,          // Remix wag_mini / wag_max
      weights: [0.4, 0.7, 1.0, 1.0],        // tip joints flex most
      classes: {                            // = engine WAG_TUNING vocabulary
        excited: { hz: 2.6, amp: 1.00 }, talking: { hz: 1.3, amp: 0.50 },
        idle:    { hz: 0.8, amp: 0.55, bursts: true }, shy: { hz: 0.9, amp: 0.35 },
        sad:     { hz: 0.0, amp: 0.00, droop: 12 }, angry: { hz: 3.8, amp: 0.12 },
      },
    },
  },
  veil: { // Vesper, future — her floor-length veil is the chain that gains most
    segments: 8, stiffness: 10, stiffnessDecay: 0.30, stiffnessDecayExponent: 1.5,
    damping: 3.5, maxAngle: 0.55, comebackSpeed: 0.35, maxAngularMomentum: 12,
    gravity: { x: 0, y: 6 }, curvature: 0.0, curvatureExponent: 0,
    stiffRootCount: 2, rootFollow: 0.60,
  },
};

/* ---------------- the chain simulation (Remix free mode) ---------------- */
class Chain {
  /* opts: { anchor:{x,y}, dirAngle, segmentLength, restPose?: {rot:[..]} }
     restPose seeds an exact pose (FK from anchor); captureRest() then
     freezes it as the render reference. Without restPose the chain
     starts straight along dirAngle (Remix's reset()) and settles. */
  constructor(tune, opts) {
    this.t = tune;
    this.n = tune.segments;
    this.segLen = opts.segmentLength;
    this.anchorTarget = { x: opts.anchor.x, y: opts.anchor.y };
    this.rootPos = { x: opts.anchor.x, y: opts.anchor.y };   // smoothed root
    this.baseRotation = opts.dirAngle;                      // driver-set root direction
    this.dirAngle = opts.dirAngle;
    this.rot = new Float64Array(this.n + 1);   // rot[i] = angle of segment (i-1 -> i); rot[0] = root dir
    this.mom = new Float64Array(this.n + 1);   // angular momentum per joint
    this.pos = [];                              // FK points, pos[0] = root
    for (let i = 0; i <= this.n; i++) this.pos.push({ x: 0, y: 0 });
    // wag driver state
    this.wagClass = null; this.wagHz = 0; this.wagAmp = 0; this.wagDroop = 0;
    this._hzSm = 0; this._ampSm = 0; this._droopSm = 0;
    this.phase = 0; this.burstT = 0; this.burstOn = true;
    this.curvatureNow = new Float64Array(this.n + 1); // effective per-joint curvature this step
    if (opts.restPose) {
      this.rot[0] = opts.dirAngle;
      for (let i = 1; i <= this.n; i++) this.rot[i] = opts.restPose.rot[i];
    } else {
      for (let i = 0; i <= this.n; i++) this.rot[i] = opts.dirAngle;
    }
    this._fk();
    this.captureRest();
  }
  _fk() {
    this.pos[0].x = this.rootPos.x; this.pos[0].y = this.rootPos.y;
    for (let i = 1; i <= this.n; i++) {
      this.pos[i].x = this.pos[i - 1].x + this.segLen * Math.cos(this.rot[i]);
      this.pos[i].y = this.pos[i - 1].y + this.segLen * Math.sin(this.rot[i]);
    }
  }
  captureRest() {
    this.restPos = this.pos.map((p) => ({ x: p.x, y: p.y }));
    this.restRot = Float64Array.from(this.rot);
  }
  /* Driver inputs — the same signals the engine produces: anchor follows
     head/body motion; baseRotation carries body rotation + wag droop. */
  setAnchor(x, y) { this.anchorTarget.x = x; this.anchorTarget.y = y; }
  setBaseRotation(rad) { this.baseRotation = rad; }
  setWag(className) {
    const w = this.t.wag;
    this.wagClass = className && w ? (w.classes[className] || null) : null;
    if (this.wagClass) {
      this.wagHz = this.wagClass.hz; this.wagAmp = this.wagClass.amp;
      this.wagDroop = (this.wagClass.droop || 0) * Math.PI / 180;
    } else { this.wagHz = 0; this.wagAmp = 0; this.wagDroop = 0; }
  }
  /* Impulse entry point (stage shake / hop): angular-momentum injection,
     tip-weighted like the engine's per-layer spring kicks. */
  kick(dMom) {
    for (let i = 1; i <= this.n; i++) this.mom[i] += dMom * (0.2 + 0.55 * (i / this.n));
  }
  _restCurvature(i) {
    const t = this.t;
    if (t.curvaturePerJoint) return t.curvaturePerJoint[i - 1] || 0;
    return (t.curvature || 0) * Math.pow(i, t.curvatureExponent || 0);
  }
  step(dt) {
    const t = this.t, n = this.n;
    /* --- wag driver: oscillate curvature (Remix append_object.gd) --- */
    const smRate = 1 - Math.exp(-dt * 8);       // class transitions, engine-wag style
    this._hzSm += (this.wagHz - this._hzSm) * smRate;
    this._ampSm += (this.wagAmp - this._ampSm) * smRate;
    this._droopSm += (this.wagDroop - this._droopSm) * smRate;
    this.phase += TAU * this._hzSm * dt;
    let wagEnv = 1;
    if (this.wagClass && this.wagClass.bursts) {  // idle: wag bursts with quiet gaps (dt-driven, deterministic)
      this.burstT += dt;
      // Burst windows are per-class data when the driver supplies them
      // (the engine injects WAG_TUNING's burstOn/burstOff means — Milo
      // ~2 s on / ~7 s cycle, Mochi lazier ~1.5 s / ~10.5 s); the
      // built-in 2.6 s / 4.4 s remains the standalone-proof default.
      const bst = this.wagClass.burst || null;
      const cycle = bst ? bst.cycle : 4.4, onTime = bst ? bst.on : 2.6;
      const fade = Math.min(0.3, onTime / 3);
      const ph = this.burstT % cycle;
      wagEnv = ph >= onTime ? 0 : clamp(Math.min(ph / fade, (onTime - ph) / fade), 0, 1);
    }
    let wagOsc = 0;
    if (this.t.wag && this._ampSm > 0.001) {
      const w = this.t.wag;
      wagOsc = clamp(Math.sin(this.phase) * this._ampSm * w.maxCurvature, w.min, w.max) * wagEnv;
    }
    for (let i = 1; i <= n; i++) {
      const wgt = this.t.wag && this.t.wag.weights ? (this.t.wag.weights[i - 1] ?? 1) : 1;
      // Droop on a chain is more than the root offset: a curled tail's
      // tip barely drops when the root rotates (the curl cancels it),
      // so droop also biases every joint's curvature by +droop/2 —
      // the tail uncurls and flops. Extension over Remix; see INTEGRATION.
      this.curvatureNow[i] = this._restCurvature(i) + wagOsc * wgt + this._droopSm * 0.5;
    }
    /* --- root: exponential follow (Remix root_follow_smoothness) --- */
    const rf = 1 - Math.pow(1 - t.rootFollow, dt * 60);
    this.rootPos.x += (this.anchorTarget.x - this.rootPos.x) * rf;
    this.rootPos.y += (this.anchorTarget.y - this.rootPos.y) * rf;
    this.pos[0].x = this.rootPos.x; this.pos[0].y = this.rootPos.y;
    this.rot[0] = this.baseRotation + this._droopSm;
    /* --- joints: Remix _process_point, root -> tip, sequential --- */
    const g = t.gravity || { x: 0, y: 0 };
    const gLen = Math.hypot(g.x, g.y), gAng = Math.atan2(g.y, g.x);
    for (let i = 1; i <= n; i++) {
      const prev = this.pos[i - 1], cur0 = this.pos[i];
      let cur = Math.atan2(cur0.y - prev.y, cur0.x - prev.x);   // direction from last frame's positions
      const ideal = this.rot[i - 1] + this.curvatureNow[i];
      const diff = angDiff(ideal, cur);
      const stiffI = Math.max(0, t.stiffness - t.stiffnessDecay * Math.pow(i, t.stiffnessDecayExponent));
      let force = signedSqrt(diff) * stiffI;
      force += gLen * Math.cos(cur - gAng + Math.PI / 2);      // pendulum torque, Remix's exact term
      if (Math.sign(force) !== Math.sign(this.mom[i])) force *= t.damping;  // brake rule
      this.mom[i] = clamp(this.mom[i] + force * dt, -t.maxAngularMomentum, t.maxAngularMomentum);
      cur += this.mom[i] * dt;
      if (Math.abs(diff) > t.maxAngle) {
        cur += diff - t.maxAngle * Math.sign(diff);
        if (Math.sign(this.mom[i]) !== Math.sign(diff) || Math.abs(this.mom[i]) < t.comebackSpeed)
          this.mom[i] = t.comebackSpeed * Math.sign(diff);
      }
      if (t.stiffRootCount > 1 && i < t.stiffRootCount)
        cur = lerpAngle(cur, this.rot[i - 1], 1 - i / t.stiffRootCount);
      this.rot[i] = cur;
      this.pos[i].x = prev.x + this.segLen * Math.cos(cur);
      this.pos[i].y = prev.y + this.segLen * Math.sin(cur);
    }
  }
  /* Tip / joint readouts for proofs and tuning. */
  tipOffset() {
    const tip = this.pos[this.n], rest = this.restPos[this.n];
    return { x: tip.x - rest.x, y: tip.y - rest.y };
  }
  bendAngle() { // total direction change root->tip vs rest: the visible "bend"
    return angDiff(this.rot[this.n], this.restRot[this.n]);
  }
}

/* Fixed-step accumulator — rAF drivers feed real frame dt; the sim only
   ever sees h-sized steps, so live and capture-clock runs agree. */
function makeStepper(chain, h) {
  h = h || 1 / 60;
  let acc = 0;
  return {
    h,
    advance(frameDt) {
      acc = Math.min(acc + frameDt, 0.25);    // clamp: no spiral of death
      let steps = 0;
      while (acc >= h) { chain.step(h); acc -= h; steps++; }
      return steps;
    },
    stepOnce() { chain.step(h); },            // capture clock: one virtual frame
  };
}

/* ---------------- DOM rendering: runtime-sliced band stack ----------------
   Slices a loaded full-canvas layer image into horizontal bands at
   runtime (canvas crops — the source art is never modified) and poses
   each band from the chain: band for segment s rotates about joint
   s-1 by (rot[s] - restRot[s]) and translates with the joint. At the
   captured rest pose every transform is identity, so the stack
   reproduces the source layer pixel-for-pixel (modulo the overlap
   note in INTEGRATION.md). Bands carry `overlap` extra pixels at
   their bottom edge so joints don't gap when the chain bends, and the
   overlap extension is ALPHA-FEATHERED to zero (see constructor): when
   a joint bends, the upper band's faded extension fills the wedge the
   lower band rotates away from, so seams cross-fade instead of
   opening a background-colored gap or a hard switch line. (Without
   the feather, a ~3 deg/joint bend showed a pale line at every band
   boundary on the proof page — measured, then fixed by this.) */
class ChainView {
  /* opts: { canvas: 1600 (native width), canvasH (native height,
     default = canvas), strip: {x, w}, bands: [{y0, y1, seg, joint}],
     overlap }. Geometry is always NATIVE pixels; the source image may
     be a downscaled copy (the site demo ships 900 px WebPs of the
     1600 px masters), so crop coordinates are scaled by the image's
     real size — the slicing is resolution-independent and the band
     canvases are kept at native size, exactly like the plate <img>
     they replace (which the browser also scales from the same file). */
  constructor(container, img, opts) {
    this.container = container;
    this.canvasSize = opts.canvas || 1600;
    this.canvasH = opts.canvasH || this.canvasSize;
    this.strip = opts.strip;
    this.bands = [];
    const imgSX = (img.naturalWidth || this.canvasSize) / this.canvasSize;
    const imgSY = (img.naturalHeight || this.canvasH) / this.canvasH;
    const ov = opts.overlap ?? 22;
    for (const b of opts.bands) {
      const y1 = Math.min(this.canvasH, b.y1 + (b.seg > 0 ? ov : 0));
      const cv = document.createElement("canvas");
      cv.width = this.strip.w; cv.height = y1 - b.y0;
      const cx = cv.getContext("2d");
      cx.drawImage(img, this.strip.x * imgSX, b.y0 * imgSY, this.strip.w * imgSX, (y1 - b.y0) * imgSY, 0, 0, this.strip.w, y1 - b.y0);
      if (y1 > b.y1) { // feather the overlap extension: opaque -> clear
        const fadeFrom = b.y1 - b.y0;
        const g = cx.createLinearGradient(0, fadeFrom, 0, y1 - b.y0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,1)");
        cx.globalCompositeOperation = "destination-out";
        cx.fillStyle = g;
        cx.fillRect(0, fadeFrom, this.strip.w, y1 - b.y0 - fadeFrom);
        cx.globalCompositeOperation = "source-over";
      }
      cv.style.position = "absolute";
      cv.style.left = (this.strip.x / this.canvasSize * 100) + "%";
      cv.style.top = (b.y0 / this.canvasH * 100) + "%";
      cv.style.width = (this.strip.w / this.canvasSize * 100) + "%";
      cv.style.height = ((y1 - b.y0) / this.canvasH * 100) + "%";
      cv.style.pointerEvents = "none";
      cv.style.userSelect = "none";
      cv.dataset.seg = b.seg; cv.dataset.joint = b.joint;
      container.appendChild(cv);
      this.bands.push({ el: cv, ...b, y1 });
    }
  }
  /* scale = displayed px per native px (charBoxWidth / canvasSize);
     sy defaults to sx — pass both when the character box is not
     square in native terms (Mochi's 1344x1728 portrait set). */
  update(chain, scale, sy) {
    const scaleY = sy === undefined ? scale : sy;
    for (const b of this.bands) {
      const j = chain.pos[b.joint], rj = chain.restPos[b.joint];
      const dAng = angDiff(chain.rot[b.seg], chain.restRot[b.seg]);
      const ox = (rj.x - this.strip.x) / this.strip.w * 100;
      const oy = (rj.y - b.y0) / (b.y1 - b.y0) * 100;
      b.el.style.transformOrigin = `${ox.toFixed(2)}% ${oy.toFixed(2)}%`;
      b.el.style.transform =
        `translate(${((j.x - rj.x) * scale).toFixed(2)}px, ${((j.y - rj.y) * scaleY).toFixed(2)}px) rotate(${dAng.toFixed(4)}rad)`;
    }
  }
}

const api = { Chain, ChainView, makeStepper, CHAIN_TUNING, angDiff };
global.PresenceChain = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
