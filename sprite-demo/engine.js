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
   ===================================================================== */
const SPRING_TUNING = {
  body:      { omega: 11.0, zeta: 0.55, gainX: 1.00, gainY: 1.00, rot: 0.00 },
  bust:      { omega:  9.0, zeta: 0.42, gainX: 0.35, gainY: 0.55, rot: 0.00, clamp: 7 },
  hairBack:  { omega:  9.5, zeta: 0.42, gainX: 1.50, gainY: 1.35, rot: 0.55 },
  hairFront: { omega: 10.5, zeta: 0.46, gainX: 1.15, gainY: 1.10, rot: 0.30 },
  ribbon:    { omega:  9.5, zeta: 0.40, gainX: 1.90, gainY: 1.60, rot: 1.60 },
};
const EXPRESSIONS = ["neutral", "happy", "sad", "surprised", "angry", "thinking", "shy", "proud"];
const CHARACTERS = {
  paige: { label: "Paige", spriteDir: "assets/paige", layerDir: "assets/paige-layers",
           layers: ["hairback", "body", "bust", "face", "hairfront"],
           pivots: { bust: "50% 78%", hairback: "50% 16%", hairfront: "50% 14%" } },
  clem:  { label: "Clementine", spriteDir: "assets/clem", layerDir: "assets/clem-layers",
           layers: ["hairback", "ribbon", "body", "bust", "face", "hairfront"],
           pivots: { bust: "52% 76%", ribbon: "30% 22%", hairback: "50% 16%", hairfront: "50% 14%" } },
};

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
    this.springs = {}; this.layerEls = {}; this.spriteEl = null; this.faceEl = null;
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
  build() {
    this.charEl.innerHTML = ""; this.layerEls = {}; this.spriteEl = null; this.faceEl = null;
    const C = CHARACTERS[this.char];
    if (this.mode === "sprite") {
      const img = document.createElement("img");
      img.className = "base"; img.src = `${C.spriteDir}/neutral.${C.ext || "png"}`; img.alt = C.label;
      this.charEl.appendChild(img); this.spriteEl = img;
    } else {
      for (const name of C.layers) {
        const img = document.createElement("img");
        if (name === "face") { img.src = `${C.layerDir}/faces/neutral.${C.ext || "png"}`; this.faceEl = img; }
        else img.src = `${C.layerDir}/${name}.${C.ext || "png"}`;
        img.alt = ""; img.dataset.layer = name;
        if (C.pivots[name]) img.style.transformOrigin = C.pivots[name];
        this.charEl.appendChild(img); this.layerEls[name] = img;
      }
      this.springs = { body: new Spring(SPRING_TUNING.body) };
      const keyFor = { hairback: "hairBack", hairfront: "hairFront", bust: "bust", ribbon: "ribbon" };
      for (const [elName, key] of Object.entries(keyFor))
        if (this.layerEls[elName]) this.springs[key] = new Spring(SPRING_TUNING[key]);
    }
    this.applyExpression();
  }
  setChar(c) { this.char = c; this.build(); }
  setMode(m) { this.mode = m; this.build(); }
  currentFace() {
    if (this.talking) return "talk";
    if (performance.now() < this.blinkUntil) return "blink";
    return this.expression;
  }
  applyExpression() {
    const C = CHARACTERS[this.char], face = this.currentFace();
    if (this.mode === "sprite" && this.spriteEl) this.spriteEl.src = `${C.spriteDir}/${face}.${C.ext || "png"}`;
    if (this.mode === "layered" && this.faceEl) this.faceEl.src = `${C.layerDir}/faces/${face}.${C.ext || "png"}`;
  }
  setExpression(name, withImpulse = true) {
    this.expression = name; this.applyExpression();
    if (withImpulse) this.impulse(0, -46);
    this.log("expression", { name });
  }
  impulse(vx, vy) {
    if (this.mode !== "layered") return;
    const s = this.springs;
    if (s.hairBack) s.hairBack.kick(vx * 0.7, vy * 0.7);
    if (s.hairFront) s.hairFront.kick(vx * 0.85, vy * 0.85);
    if (s.ribbon) s.ribbon.kick(vx * 1.5, vy * 1.2);
    if (s.bust) s.bust.kick(vx * 0.25, vy * 0.4);
    if (s.body) s.body.kick(vx * 0.3, vy * 0.5);
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
    const env = this.envelopeNow();
    const wasTalking = this.talking;
    this.talking = env > TALK_THRESHOLD;
    if (this.talking !== wasTalking) this.applyExpression();
    if (now > this.nextBlink) { this.blinkUntil = now + 140; this.nextBlink = now + 2200 + Math.random() * 3000; this.applyExpression(); }
    if (this.blinkUntil && now > this.blinkUntil && !this.talking) { this.blinkUntil = 0; this.applyExpression(); }
    const t = now / 1000;
    const mx = Math.sin(t * 0.9) * 2.1 * this.gain;
    const my = (Math.sin(t * 1.55) * 1.15 - env * 13) * this.gain;
    if (env > 0.30 && this.prevEnv <= 0.30 && this.mode === "layered") this.impulse(0, -52 * this.gain);
    this.prevEnv = env;
    if (this.mode === "sprite") {
      const s = this.spriteSpring;
      s.step(dt, mx, my);
      if (this.spriteEl) this.spriteEl.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      return;
    }
    const S = this.springs, body = S.body;
    body.step(dt, mx, my);
    const set = (el, spr, tune) => {
      if (!el || !spr) return;
      spr.step(dt, mx * tune.gainX * this.gain, my * tune.gainY * this.gain);
      let x = spr.x, y = spr.y;
      if (tune.clamp) { x = Math.max(-tune.clamp, Math.min(tune.clamp, x)); y = Math.max(-tune.clamp, Math.min(tune.clamp, y)); }
      const rot = Math.max(-7, Math.min(7, -spr.vx * 0.028 * tune.rot));
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
    };
    const bt = `translate(${body.x.toFixed(1)}px, ${body.y.toFixed(1)}px)`;
    if (this.layerEls.body) this.layerEls.body.style.transform = bt;
    if (this.faceEl) this.faceEl.style.transform = bt; // face locked to the head
    set(this.layerEls.bust, S.bust, SPRING_TUNING.bust);
    set(this.layerEls.hairback, S.hairBack, SPRING_TUNING.hairBack);
    set(this.layerEls.hairfront, S.hairFront, SPRING_TUNING.hairFront);
    set(this.layerEls.ribbon, S.ribbon, SPRING_TUNING.ribbon);
  }
}

window.PresenceStage = { Avatar, loadEnvelope, SPRING_TUNING, EXPRESSIONS, CHARACTERS, BUCKETS_PER_SEC };
})();
