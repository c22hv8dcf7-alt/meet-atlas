/* Meet Atlas — greeting demo (SIMULATION).
   This is a scripted preview of the Atlas approachable pass.
   It talks to nothing, loads nothing, and remembers nothing:
   every line below is written out in this file, exactly as a
   visitor can read it. Optional speech uses the browser's own
   Web Speech API and only ever starts from the "Open Atlas"
   tap below (browser autoplay rules), never on page load. */
(function () {
  "use strict";

  var frame   = document.getElementById("greetFrame");
  if (!frame) return;
  var stateEl = document.getElementById("greetState");
  var capEl   = document.getElementById("greetCaptions");
  var optsEl  = document.getElementById("greetOptions");
  var respEl  = document.getElementById("greetResponse");
  var playBtn = document.getElementById("greetPlay");
  var againBtn= document.getElementById("greetAgain");
  var voiceBox= document.getElementById("greetVoice");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var GREETING = [
    { text: "Good morning — welcome back.", cls: "" },
    { text: "While you were away, I finished the job you left with me. One thing in it needs your call.", cls: "" },
    { text: "Here’s what we could do — say it, or tap one:", cls: "small" }
  ];

  var RESPONSES = {
    pickup: {
      html: "<p>Check. We left your creek notes at the stonefly counts — page open, place kept.</p>" +
            "<ul><li><b>Thread restored</b> — exactly where you stopped yesterday.</li>" +
            "<li>Nothing re-explained. Atlas remembered, because you asked it to.</li></ul>",
      chips: ["Place kept", "Memory · plain file you own"]
    },
    today: {
      html: "<p>Here’s your brief — only from things already on this computer:</p>" +
            "<ul><li><b>A saved deadline</b> — the creek summary is due tomorrow.</li>" +
            "<li><b>A follow-up you asked for</b> — the lab reply you were waiting on.</li>" +
            "<li><b>An update waiting</b> — nothing urgent; it can sit until you say.</li></ul>" +
            "<p>That’s the whole list. Atlas doesn’t invent a busier day than the one you have.</p>",
      chips: ["From your own files", "Nothing invented"]
    },
    library: {
      html: "<p>You asked what your library said about the creek’s health. Here’s the answer, with its source:</p>" +
            "<ul><li>“Stoneflies were present at every riffle sampled — a sign of clean, oxygen-rich water.”</li></ul>",
      chips: ["Source: Field Notes — Creek Survey (your library)", "Cited, not guessed"]
    },
    away: {
      html: "<p>While you were away, I finished what you left with me:</p>" +
            "<ul><li><b>Finished</b> — your library notes, sorted and summarised. Ready for your grade.</li>" +
            "<li><b>Needs your call</b> — two notes matched two different creeks. I didn’t guess which.</li>" +
            "<li><b>Paused, honestly</b> — the machine slept at 11:40, so the last job waited. No pretending it ran.</li></ul>" +
            "<p>Nothing was sent, published, or changed outside this computer. Away-work is local work.</p>",
      chips: ["Done · Needs you · Paused", "Local only"]
    }
  };

  var timers = [];
  function later(fn, ms) { timers.push(window.setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(window.clearTimeout); timers = []; }

  function speak(text) {
    if (!voiceBox || !voiceBox.checked || !("speechSynthesis" in window)) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech is a garnish; the demo runs silently */ }
  }
  function stopSpeak() {
    if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  }

  function typeLine(line, done) {
    var p = document.createElement("p");
    p.className = "greet-line" + (line.cls ? " " + line.cls : "");
    capEl.appendChild(p);
    if (reduceMotion) { p.textContent = line.text; speak(line.text); if (done) done(); return; }
    p.classList.add("greet-caret");
    var i = 0;
    (function tick() {
      i += 2;
      p.textContent = line.text.slice(0, i);
      if (i < line.text.length) { later(tick, 24); }
      else { p.classList.remove("greet-caret"); speak(line.text); if (done) later(done, 260); }
    })();
  }

  function setState(html) { stateEl.innerHTML = html; }

  function showOptions() {
    optsEl.hidden = false;
    againBtn.hidden = false;
    setState("Atlas is <b>ready</b> — pick one, or just start talking");
    var first = optsEl.querySelector(".greet-opt");
    if (first) first.focus({ preventScroll: true });
  }

  function play() {
    clearTimers(); stopSpeak();
    frame.classList.remove("is-open", "is-speaking");
    capEl.innerHTML = ""; respEl.hidden = true; respEl.innerHTML = "";
    optsEl.hidden = true; againBtn.hidden = true; playBtn.hidden = true;
    optsEl.querySelectorAll(".greet-opt").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    setState("Atlas is <b>opening…</b>");
    later(function () {
      frame.classList.add("is-open");
      setState("Atlas is <b>greeting you</b>");
      frame.classList.add("is-speaking");
      var idx = 0;
      (function next() {
        if (idx < GREETING.length) { typeLine(GREETING[idx++], next); }
        else { frame.classList.remove("is-speaking"); showOptions(); }
      })();
    }, reduceMotion ? 60 : 650);
  }

  function respond(key, btn) {
    optsEl.querySelectorAll(".greet-opt").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    if (btn) btn.setAttribute("aria-pressed", "true");
    var r = RESPONSES[key];
    if (!r) return;
    stopSpeak();
    respEl.innerHTML =
      '<span class="who"><img src="assets/orb-small.png" alt="">Atlas</span>' + r.html +
      '<div>' + r.chips.map(function (c) { return '<span class="greet-src">' + c + "</span>"; }).join("") + "</div>";
    respEl.hidden = false;
    setState("Atlas is <b>working</b> — that’s the shape of it");
    respEl.setAttribute("tabindex", "-1");
    respEl.focus({ preventScroll: true });
    respEl.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }

  playBtn.addEventListener("click", play);
  againBtn.addEventListener("click", play);
  optsEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".greet-opt");
    if (btn) respond(btn.getAttribute("data-response"), btn);
  });

  /* If the browser has no speech at all, say so next to the toggle —
     the demo itself never depends on it. */
  if (!("speechSynthesis" in window) && voiceBox) {
    voiceBox.disabled = true;
    var note = document.getElementById("greetVoiceNote");
    if (note) note.textContent = "This browser has no spoken voice — the demo runs silently, as it always can.";
  }
})();
