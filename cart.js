/* Meet Atlas — the shelf cart.
   One cart across the whole site. A slim bar at the foot of every page
   keeps the running count and total in sight; "See cart" opens the cart
   page, where everything you picked is combined, in your browser, into
   one finished Atlas bundle: each piece inside it is the original signed
   download, byte for byte, next to a bundle.json that lists what it is
   and what its seal should read. Atlas checks every seal when it opens
   the bundle, and installs everything in one go.
   No account, no payment — everything on this shelf is free. */
(function () {
  "use strict";

  var STORAGE_KEY = "atlasCart.v1";
  var CATALOG_URL = "catalog.json";

  /* The thin CORS relay (CART-SPEC section 10): GitHub's release-asset
     host sends no Access-Control-Allow-Origin, so a browser cannot
     fetch() the shelf's packs directly. When RELAY_BASE is set to the
     deployed relay's origin (e.g. "https://answers.example.org" — the
     relay lives on the same host as the Porch Light Answer Service),
     every asset fetch is routed through it as RELAY_BASE + "/assets/"
     + <catalog file name>; the relay streams the release bytes
     pass-through and adds the permission header. Default "" = fetch
     the catalog's own download_url directly, exactly as before. The
     seal checks below run unchanged either way — the relay is trusted
     with nothing, because a wrong byte fails the SHA-256 check. */
  var RELAY_BASE = "";

  /* Friendly names + bundle filename slugs for everything on the shelf that
     has a real downloadable asset in catalog.json. If a name is not in the
     catalog, it cannot be added — the cart only carries real files. */
  var ITEM_META = {
    "paige-presence-pack.zip":      { label: "Paige — the Lead",               slug: "paige" },
    "mochi-presence-pack.zip":      { label: "Mochi — the Good Boy",           slug: "mochi" },
    "vesper-presence-pack.zip":     { label: "Vesper — the Sharp One",         slug: "vesper" },
    "milo-presence-pack.zip":       { label: "Milo — the Tease",               slug: "milo" },
    "clementine-presence-pack.zip": { label: "Clementine — the Indulgent One", slug: "clementine" },
    "juno-presence-pack.zip":       { label: "Juno — the Spark",               slug: "juno" },
    "pack-everyday.zip":            { label: "Everyday Knowledge",             slug: "everyday-knowledge" },
    "app-classroom.zip":            { label: "The Classroom",                  slug: "classroom" },
    "app-ledger.zip":               { label: "The Ledger",                     slug: "ledger" },
    "app-darkroom.zip":             { label: "The Darkroom",                   slug: "darkroom" }
  };

  /* The Atlas installers themselves — offered alongside the bundle for
     people who don't have Atlas yet. The installers are never IN the cart
     and never inside the bundle; they are unchanged release downloads. */
  var EDITION_META = {
    "atlas-mac.zip":         "Atlas for Mac",
    "atlas-linux.tar.gz":    "Atlas for Linux",
    "atlas-chromebook.tar.gz": "Atlas for Chromebook"
  };

  /* Checkout's second question: which brain she thinks with. Three doors —
     the local brain (included, the default), borrowing one with Porch Light
     credits (coming with the Answer Service; a labelled placeholder here),
     or the visitor's own account with a big AI company (they pay that
     company directly; Porch Light never touches the money). The pick is
     stored with the cart and written into bundle.json, so Atlas can greet
     the new arrival with the right setup step. It never changes the bundle:
     the same pieces download whichever door is picked. */
  var BRAIN_KEY = "atlasCartBrain.v1";
  var BRAIN_PROVIDERS = {
    anthropic: { name: "Claude",  company: "Anthropic", url: "https://console.anthropic.com",   linkLabel: "Open Anthropic's API console" },
    openai:    { name: "GPT",     company: "OpenAI",    url: "https://platform.openai.com",     linkLabel: "Open OpenAI's API platform" },
    google:    { name: "Gemini",  company: "Google",    url: "https://aistudio.google.com",     linkLabel: "Open Google AI Studio" }
  };

  var catalog = null;        // name -> asset {name, kind, size_bytes, sha256, download_url}
  var cart = loadCart();     // array of catalog asset names, in pick order
  var brain = loadBrain();   // {brain:"local"} | {brain:"byok", provider:"anthropic"|"openai"|"google"}
  var els = {};              // cart-page elements, once built (cart.html only)
  var bar = {};              // the persistent cart bar, on every page
  var flashTimer = null;

  function loadBrain() {
    try {
      var raw = localStorage.getItem(BRAIN_KEY);
      var b = raw ? JSON.parse(raw) : null;
      if (b && b.brain === "byok" && BRAIN_PROVIDERS[b.provider]) return { brain: "byok", provider: b.provider };
    } catch (e) {}
    return { brain: "local" };
  }
  function saveBrain() {
    try { localStorage.setItem(BRAIN_KEY, JSON.stringify(brain)); } catch (e) {}
  }
  function brainValue() { return brain.brain === "byok" ? brain.provider : "local"; }

  function loadCart() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (n) { return typeof n === "string"; }) : [];
    } catch (e) { return []; }
  }
  function saveCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  function fmtSize(bytes) {
    // Matches how the site already speaks: "68.7 MB" for the big pieces,
    // "1.03 MB" for the small installers, "22 KB" under a megabyte.
    if (bytes >= 10000000) return (bytes / 1000000).toFixed(1).replace(/\.0$/, "") + " MB";
    if (bytes >= 1000000) return (bytes / 1000000).toFixed(2).replace(/0$/, "") + " MB";
    if (bytes >= 1000) return Math.round(bytes / 1000) + " KB";
    return bytes + " B";
  }
  function totalBytes() {
    if (!catalog) return 0;
    return cart.reduce(function (sum, name) {
      var a = catalog[name];
      return sum + (a ? a.size_bytes : 0);
    }, 0);
  }

  /* The signed companions a pack travels with: its manifest and signature,
     which live on the shelf as their own catalog entries. Derived from the
     catalog by the shelf's naming rule (PAIGE-MANIFEST.txt/.sig for
     paige-presence-pack.zip, EVERYDAY-MANIFEST.* for pack-everyday.zip).
     Items with no manifest pair in the catalog return an empty list. */
  function companionsFor(assetName) {
    var base = assetName.replace(/\.zip$/, "").replace(/\.tar\.gz$/, "");
    var token = base.replace(/-presence-pack$/, "").replace(/^pack-/, "").replace(/^app-/, "");
    var stem = token.toUpperCase() + "-MANIFEST";
    var out = [];
    [stem + ".txt", stem + ".sig"].forEach(function (n) {
      if (catalog && catalog[n]) out.push(catalog[n]);
    });
    return out;
  }

  function sha256Hex(buffer) {
    return crypto.subtle.digest("SHA-256", buffer).then(function (digest) {
      return Array.prototype.map.call(new Uint8Array(digest), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    });
  }

  /* ---------- UI construction ---------- */

  /* The persistent cart bar: a slim strip fixed to the bottom of every
     page that carries the cart. It shows the running count and total and
     one way onward — "See cart", which opens the cart page. An empty cart
     shows no bar at all; the shelf stays furniture-quiet until the visitor
     has actually picked something. */
  function buildBar() {
    if (document.getElementById("cartbar")) return;
    var el = document.createElement("div");
    el.className = "cartbar";
    el.id = "cartbar";
    el.hidden = true;
    el.innerHTML =
      "<span class=\"cartbar-msg\" id=\"cartbar-msg\" aria-live=\"polite\"></span>" +
      "<span class=\"cartbar-summary\">Cart " +
        "<span class=\"cart-count\" id=\"cartbar-count\">0</span> " +
        "<span class=\"cart-total\" id=\"cartbar-total\"></span>" +
      "</span>" +
      "<a class=\"cartbar-see\" id=\"cartbar-see\" href=\"cart.html\">See cart</a>";
    document.body.appendChild(el);
    bar.el = el;
    bar.count = el.querySelector("#cartbar-count");
    bar.total = el.querySelector("#cartbar-total");
    bar.msg = el.querySelector("#cartbar-msg");
  }

  /* A short confirmation in the bar when something is picked — the bar
     pulses and names what went in, then settles back to the totals. */
  function flashBar(text) {
    if (!bar.msg || !bar.el) return;
    bar.msg.textContent = text;
    bar.el.classList.add("cartbar-flash");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      bar.msg.textContent = "";
      bar.el.classList.remove("cartbar-flash");
    }, 3600);
  }

  /* The checkout itself lives on cart.html, inside #cart-checkout: the
     item list, the newcomer panel, the brain picker, and Build my Atlas.
     Other pages only ever build the bar — there is no drawer any more. */
  function buildCheckout() {
    var mount = document.getElementById("cart-checkout");
    if (!mount || document.getElementById("cart-items")) return;

    mount.innerHTML =
      "<p class=\"cart-explain\">Everything you pick, combined into one finished Atlas package — no loose parts.</p>" +
      "<ul class=\"cart-items\" id=\"cart-items\"></ul>" +
      "<div class=\"cart-empty\" id=\"cart-empty\" hidden>" +
        "<p>Your cart is empty.</p>" +
        "<p class=\"cart-empty-links\">Wander the shelf — everything on it is free. Start with " +
          "<a href=\"room.html\">the Room</a>, where the cast lives, or browse " +
          "<a href=\"library.html\">the Library</a> for the knowledge packs — and add what you'd like to live with.</p>" +
      "</div>" +
      "<div id=\"cart-checkout-body\">" +
        "<div class=\"cart-totalrow\" id=\"cart-totalrow\">" +
          "<span>Total to download</span><b id=\"cart-grandtotal\">0 KB</b>" +
        "</div>" +
        "<div class=\"cart-new\" id=\"cart-new\">" +
          "<p><b>New to Atlas?</b> Take the app too — free, and unchanged. The bundle below holds your picks; Atlas itself is a separate small download:</p>" +
          "<p class=\"cart-editions\" id=\"cart-editions\"></p>" +
        "</div>" +
        "<fieldset class=\"cart-brain\" id=\"cart-brain\">" +
          "<legend>Choose her brain</legend>" +
          "<p class=\"cart-brain-note\">Whichever you pick, the bundle below is the same — this only tells Atlas how you'd like her to think, so he can greet you with the right setup step.</p>" +
          "<label class=\"brain-card\" data-brain-card=\"local\">" +
            "<input type=\"radio\" name=\"cart-brain\" value=\"local\">" +
            "<span class=\"brain-body\">" +
              "<b>Local brain — included, free forever</b>" +
              "<span class=\"brain-text\">The brain Atlas is born with. It lives on your own machine and works with the Wi-Fi off. Nothing to sign up for, nothing to pay, ever.</span>" +
            "</span>" +
          "</label>" +
          Object.keys(BRAIN_PROVIDERS).map(function (key) {
            var p = BRAIN_PROVIDERS[key];
            return "<label class=\"brain-card\" data-brain-card=\"" + key + "\">" +
              "<input type=\"radio\" name=\"cart-brain\" value=\"" + key + "\">" +
              "<span class=\"brain-body\">" +
                "<b>" + p.name + " — by " + p.company + "</b>" +
                "<span class=\"brain-text\">Your own account with " + p.company + ". You pay them directly — a small pay-as-you-go top-up (about $5) is typical — and Atlas connects with a key you paste in. Porch Light never touches this money.</span>" +
                "<a class=\"brain-link\" href=\"" + p.url + "\" target=\"_blank\" rel=\"noopener\">" + p.linkLabel + " →</a>" +
              "</span>" +
            "</label>";
          }).join("") +
          "<p class=\"brain-placeholder\">A third door — borrowing a brain with Porch Light credits — <b>comes with the Answer Service</b>. It isn't open yet, so there's nothing to pick there today.</p>" +
          "<p class=\"brain-honest\">One honest note: an API account is separate from a chat subscription — Claude Pro or ChatGPT Plus doesn't include API access. And picking a cloud brain finishes inside Atlas: you paste your key, he makes one test call, and he confirms in plain words that it worked.</p>" +
        "</fieldset>" +
        /* Interim state (Levi's 2026-11-10 deploy ruling): until RELAY_BASE
           is set — bundle building needs the Answer Service host — there is
           no Build button to fail confusingly on a blocked fetch. A plain
           notice stands in its place. Set RELAY_BASE and the button, the
           progress line, and the after-note return exactly as staged. */
        (RELAY_BASE
          ? "<button type=\"button\" class=\"btn cart-build\" id=\"cart-build\">Build my Atlas</button>" +
            "<p class=\"cart-progress\" id=\"cart-progress\" aria-live=\"polite\"></p>" +
            "<p class=\"cart-error\" id=\"cart-error\" role=\"alert\" hidden></p>" +
            "<p class=\"cart-after\">When the bundle lands, open it with Atlas. He checks the seal on every piece, installs everything in one go, and tells you in chat what he did — in plain sentences.</p>"
          : "<p class=\"cart-notice\" id=\"cart-notice\">Bundle building arrives with the Answer Service — your cart is saved in this browser. Every item can still be downloaded on its own from its page.</p>") +
      "</div>";

    els.items = mount.querySelector("#cart-items");
    els.empty = mount.querySelector("#cart-empty");
    els.body = mount.querySelector("#cart-checkout-body");
    els.totalRow = mount.querySelector("#cart-totalrow");
    els.grandTotal = mount.querySelector("#cart-grandtotal");
    els.editions = mount.querySelector("#cart-editions");
    els.build = mount.querySelector("#cart-build");
    els.progress = mount.querySelector("#cart-progress");
    els.error = mount.querySelector("#cart-error");

    if (els.build) els.build.addEventListener("click", buildBundle);
    mount.querySelectorAll("input[name=\"cart-brain\"]").forEach(function (radio) {
      radio.addEventListener("change", function () {
        brain = radio.value === "local"
          ? { brain: "local" }
          : { brain: "byok", provider: radio.value };
        saveBrain();
        renderBrain();
      });
    });

    fillEditions();
    render();
  }

  function fillEditions() {
    if (!catalog || !els.editions) return;
    els.editions.innerHTML = Object.keys(EDITION_META).map(function (name) {
      var a = catalog[name];
      if (!a) return "";
      return "<a href=\"" + a.download_url + "\">" + EDITION_META[name] + " — " + fmtSize(a.size_bytes) + "</a>";
    }).filter(Boolean).join(" · ");
  }

  /* ---------- Rendering ---------- */

  function renderBrain() {
    if (!els.items) return;
    var want = brainValue();
    document.querySelectorAll("input[name=\"cart-brain\"]").forEach(function (radio) {
      radio.checked = radio.value === want;
    });
    document.querySelectorAll("[data-brain-card]").forEach(function (card) {
      card.classList.toggle("brain-on", card.getAttribute("data-brain-card") === want);
    });
  }

  function render() {
    // The bar: visible only while the cart holds something.
    if (bar.el) {
      var hasItems = cart.length > 0;
      bar.el.hidden = !hasItems;
      document.body.classList.toggle("cartbar-on", hasItems);
      if (bar.count) bar.count.textContent = String(cart.length);
      if (bar.total) bar.total.textContent = hasItems ? "· " + fmtSize(totalBytes()) : "";
    }

    // Add-to-cart buttons reflect membership.
    document.querySelectorAll("[data-cart-add]").forEach(function (btn) {
      var name = btn.getAttribute("data-cart-add");
      var inCart = cart.indexOf(name) !== -1;
      btn.classList.toggle("cart-in", inCart);
      btn.setAttribute("aria-pressed", inCart ? "true" : "false");
      btn.textContent = inCart ? "In your cart ✓" : "Add to cart";
      btn.title = inCart ? "Tap to take it out of your cart" : "Add this to your cart";
    });

    if (!els.items) return;
    renderBrain();
    els.items.innerHTML = "";
    cart.forEach(function (name) {
      var a = catalog ? catalog[name] : null;
      var meta = ITEM_META[name];
      var li = document.createElement("li");
      li.className = "cart-item";
      li.innerHTML =
        "<span class=\"cart-item-name\"></span>" +
        "<span class=\"cart-item-size\"></span>" +
        "<a class=\"cart-direct cart-item-dl\" hidden></a>" +
        "<button type=\"button\" class=\"cart-remove\">Remove</button>";
      li.querySelector(".cart-item-name").textContent = meta ? meta.label : name;
      li.querySelector(".cart-item-size").textContent = a ? fmtSize(a.size_bytes) : "";
      // The same quiet direct-download fallback the source pages carry, so
      // a cart row is never a dead end — bundle or no bundle.
      var dl = li.querySelector(".cart-item-dl");
      if (a && a.download_url) {
        dl.href = a.download_url;
        dl.textContent = a.kind === "companion-app" ? "or download just this app" : "or download just this pack";
        dl.hidden = false;
      }
      li.querySelector(".cart-remove").addEventListener("click", function () { removeFromCart(name); });
      els.items.appendChild(li);
    });
    var has = cart.length > 0;
    els.empty.hidden = has;
    if (els.body) els.body.hidden = !has;
    els.grandTotal.textContent = fmtSize(totalBytes());
  }

  /* ---------- Cart operations ---------- */

  function addToCart(name, quiet) {
    if (!catalog || !catalog[name]) return;
    if (cart.indexOf(name) === -1) {
      cart.push(name); saveCart();
      render();
      if (!quiet) {
        var meta = ITEM_META[name];
        flashBar((meta ? meta.label : name) + " added");
      }
    } else {
      render();
    }
  }
  function removeFromCart(name) {
    cart = cart.filter(function (n) { return n !== name; });
    saveCart();
    render();
  }
  function toggleCart(name) {
    if (cart.indexOf(name) !== -1) removeFromCart(name); else addToCart(name);
  }

  /* ---------- The build ---------- */

  function setProgress(msg) { if (els.progress) els.progress.textContent = msg; }
  function setError(msg) {
    if (!els.error) return;
    els.error.hidden = !msg;
    els.error.textContent = msg || "";
  }

  function assetFetchUrl(asset) {
    if (RELAY_BASE) return RELAY_BASE.replace(/\/+$/, "") + "/assets/" + encodeURIComponent(asset.name);
    return asset.download_url;
  }

  function fetchChecked(asset, stepLabel) {
    setProgress(stepLabel);
    return fetch(assetFetchUrl(asset)).then(function (res) {
      if (!res.ok) throw new Error("the shelf sent back an error (" + res.status + ") for " + asset.name);
      return res.blob();
    }).then(function (blob) {
      if (blob.size !== asset.size_bytes) {
        throw new Error(asset.name + " arrived the wrong size — " + blob.size + " bytes instead of " + asset.size_bytes + ".");
      }
      return blob.arrayBuffer().then(function (buf) {
        return sha256Hex(buf).then(function (hex) {
          if (hex !== asset.sha256) {
            throw new Error(asset.name + " doesn't match the seal recorded for it on the shelf, so it was left out.");
          }
          return blob;
        });
      });
    });
  }

  function bundleFileName() {
    var slugs = cart.map(function (name) {
      var m = ITEM_META[name];
      return m ? m.slug : name.replace(/\.(zip|tar\.gz)$/, "");
    });
    var joined = slugs.join("-");
    if (joined.length > 70) joined = slugs.slice(0, 4).join("-") + "-and-more";
    return "atlas-bundle-" + joined + ".zip";
  }

  function buildBundle() {
    if (!catalog || !cart.length) return;
    if (typeof JSZip === "undefined") {
      setError("The packing tool didn't load. Refresh the page and try again — your cart is still saved.");
      return;
    }
    setError("");
    if (els.build) els.build.disabled = true;
    var picked = cart.slice();
    var zip = new JSZip();
    var manifest = {
      format: "atlas-bundle",
      version: 1,
      brain: brain,
      built_at: new Date().toISOString(),
      note: "Every file inside this bundle is an original signed download from the Meet Atlas shelf, byte for byte, never repacked. Atlas checks the seal on each piece — and each piece's own manifest and signature, which travel alongside it — before installing anything. The brain field records the brain picked at checkout (the local brain, or the visitor's own account with a big AI company) so Atlas can greet its new home with the right setup step; no key or credential is ever in the bundle.",
      items: []
    };

    var chain = Promise.resolve();
    var blobs = {}; // file name -> Blob, in shelf order

    picked.forEach(function (name, i) {
      var asset = catalog[name];
      var meta = ITEM_META[name] || { label: name };
      var companions = companionsFor(name);
      manifest.items.push({
        name: meta.label,
        file: asset.name,
        kind: asset.kind,
        size_bytes: asset.size_bytes,
        sha256: asset.sha256,
        companions: companions.map(function (c) {
          return { file: c.name, kind: c.kind, size_bytes: c.size_bytes, sha256: c.sha256 };
        })
      });
      chain = chain.then(function () {
        return fetchChecked(asset, "Fetching " + (i + 1) + " of " + picked.length + " — " + meta.label + " (" + fmtSize(asset.size_bytes) + ")…");
      }).then(function (blob) {
        blobs[asset.name] = blob;
        // Companions ride along byte-identical too, so the bundle carries
        // everything Atlas needs to check each seal at install time.
        var cChain = Promise.resolve();
        companions.forEach(function (c) {
          cChain = cChain.then(function () {
            return fetchChecked(c, "Fetching " + meta.label + "'s seal (" + c.name + ")…");
          }).then(function (cb) { blobs[c.name] = cb; });
        });
        return cChain;
      });
    });

    chain.then(function () {
      setProgress("Packing your bundle — nothing is squeezed or changed, each piece goes in exactly as it came off the shelf…");
      Object.keys(blobs).forEach(function (fname) {
        // STORE: the pieces are already compressed; recompressing would only
        // waste time and change nothing anyone can see.
        zip.file(fname, blobs[fname], { compression: "STORE" });
      });
      zip.file("bundle.json", JSON.stringify(manifest, null, 2));
      return zip.generateAsync({ type: "blob", compression: "STORE" }, function (meta) {
        setProgress("Packing your bundle — " + Math.round(meta.percent) + "%…");
      });
    }).then(function (blob) {
      var fname = bundleFileName();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      setProgress("Done — " + fname + " is on its way to your downloads. Open it with Atlas and he installs everything in one go.");
      if (els.build) els.build.disabled = false;
    }).catch(function (err) {
      var detail = (err && err.message) ? err.message : "a download didn't come through.";
      if (!/[.!]$/.test(detail)) detail += ".";
      setProgress("");
      setError("Your bundle didn't get built: " + detail + " Your cart is still saved — check your connection and tap Build my Atlas again.");
      if (els.build) els.build.disabled = false;
    });
  }

  /* ---------- Boot ---------- */

  function wireButtons() {
    document.querySelectorAll("[data-cart-add]").forEach(function (btn) {
      btn.addEventListener("click", function () { toggleCart(btn.getAttribute("data-cart-add")); });
    });
  }

  function init() {
    buildBar();        // the bar can show before the catalog arrives
    buildCheckout();   // cart.html only; a no-op everywhere else
    wireButtons();
    fetch(CATALOG_URL).then(function (res) {
      if (!res.ok) throw new Error("catalog " + res.status);
      return res.json();
    }).then(function (data) {
      catalog = {};
      (data.assets || []).forEach(function (a) { catalog[a.name] = a; });
      // Drop anything in the saved cart that the shelf no longer carries.
      var before = cart.length;
      cart = cart.filter(function (n) { return !!catalog[n] && !!ITEM_META[n]; });
      if (cart.length !== before) saveCart();
      buildBar();
      buildCheckout();
      fillEditions();   // sizes are known now — the newcomer links can be written
      render();
    }).catch(function () {
      // Without the catalog we cannot promise sizes or seals, so the cart
      // buttons stay quiet rather than guessing. The direct download links
      // beside them still work.
      render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  /* Small public handle, handy for the app and for tests. */
  window.AtlasCart = {
    items: function () { return cart.slice(); },
    add: addToCart,
    remove: removeFromCart,
    build: buildBundle,
    totalBytes: totalBytes,
    brain: function () { return JSON.parse(JSON.stringify(brain)); }
  };
})();
