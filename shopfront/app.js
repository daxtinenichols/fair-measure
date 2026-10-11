/* Shopfront Studio.
   Routes (in the address hash): "" the editor (or the welcome when there's no site yet),
   "#publish" the checklist and how to put the site online.
   The site lives in the shared "sites" collection (one record). Business name, phone, email,
   address, logo and web address are read from, and written back to, the shared profile, and
   the price list comes from the shared items list, so every tool stays in step. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, L = FM.license, B = window.FMSite, esc = FM.esc;
  var app, site = null;
  var saveTimer = null, previewTimer = null;
  var view = window.matchMedia && window.matchMedia("(max-width: 900px)").matches ? "phone" : "desktop";
  var MAX_PHOTOS = 8;

  var ICON = {
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5S14.5 17.9 12 20.5M12 3.5C9.5 6.1 8.4 8.9 8.4 12s1.1 5.9 3.6 8.5"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>',
    shop: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 26l4-14h36l4 14"/><path d="M10 26c0 4 3 7 7.3 7s7.4-3 7.4-7c0 4 3.2 7 7.3 7s7.3-3 7.3-7c0 4 3.2 7 7.4 7S54 30 54 26"/><path d="M14 33v19h36V33M27 52V41h10v11"/></svg>'
  };
  var KIND_ICON = {
    food: '<path d="M8 20c0-6 5.5-10 12-10s12 4 12 10v2H8z"/><path d="M14 16c1-2 3-3 6-3M6 26h28"/>',
    trades: '<path d="M24 8l8 8-4 4-8-8zM20 12L8 24a3 3 0 0 0 4 4l12-12"/>',
    cleaning: '<path d="M14 14h12l2 18H12z"/><path d="M17 14V9h6v5M26 9h4"/>',
    makers: '<path d="M10 30c4-1 6-4 6-8l8-8 4 4-8 8c-4 0-7 2-8 6"/><path d="M26 10l2-2 4 4-2 2"/>',
    lessons: '<path d="M6 14l14-6 14 6-14 6z"/><path d="M12 17v7c4 3 12 3 16 0v-7"/>',
    shop: '<path d="M8 16l2-7h20l2 7"/><path d="M8 16c0 2 2 4 4 4s4-2 4-4c0 2 2 4 4 4s4-2 4-4c0 2 2 4 4 4s4-2 4-4M10 20v12h20V20"/>',
    other: '<circle cx="20" cy="20" r="11"/><path d="M15 20h10M20 15v10"/>'
  };

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmt(c) { var p = S.profile(); return FM.money.format(Math.round(c || 0), p.currency, p.locale || undefined); }
  function field(label, control, hint, cls) {
    return '<label class="field' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + control + (hint ? "<small>" + hint + "</small>" : "") + "</label>";
  }
  function input(path, value, attrs) { return '<input data-f="' + path + '" value="' + esc(value) + '"' + (attrs || "") + ">"; }
  function area(path, value, attrs) { return '<textarea data-f="' + path + '"' + (attrs || "") + ">" + esc(value) + "</textarea>"; }
  function pInput(key, attrs) { return '<input data-p="' + key + '" value="' + esc(S.profile()[key]) + '"' + (attrs || "") + ">"; }
  function check(path, on, label) {
    return '<label class="check"><input type="checkbox" data-f="' + path + '"' + (on ? " checked" : "") + "><span>" + label + "</span></label>";
  }
  function get(path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, site);
  }
  function set(path, value) {
    var keys = path.split("."), o = site;
    for (var i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  }
  function items() { return S.all("items").slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); }
  function pro() { return L.isPro(); }

  function load() {
    var all = S.all("sites");
    site = all.length ? all[0] : null;
    if (site) {
      // Fill in anything a newer version added, without touching what the owner wrote.
      var base = B.starter(site.kind, S.profile(), []);
      Object.keys(base).forEach(function (k) {
        if (site[k] == null) site[k] = base[k];
        else if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && typeof site[k] === "object") {
          Object.keys(base[k]).forEach(function (kk) { if (site[k][kk] === undefined) site[k][kk] = base[k][kk]; });
        }
      });
    }
  }

  // Writes the site now; false (with a toast) when the browser is out of space.
  function persist() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      site = S.put("sites", site);
      var st = $("#saved");
      if (st) st.textContent = "Saved";
      downloadNote();
      return true;
    } catch (e) { FM.toast(e.message); return false; }
  }
  function save(now) {
    if (now) return persist();
    clearTimeout(saveTimer);
    var st = $("#saved");
    if (st) st.textContent = "Saving…";
    saveTimer = setTimeout(persist, 400);
  }
  function flushSave() { if (saveTimer) persist(); }

  // ---------- routing
  function route() {
    flushSave();
    load();
    window.scrollTo(0, 0);
    var h = location.hash.replace(/^#/, "");
    if (!site) return renderWelcome();
    if (h === "publish") return renderPublish();
    renderEditor();
  }

  function head(extra) {
    return '<div class="wrap app-head no-print"><div class="app-title"><h1>Shopfront Studio</h1>' + (pro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" + (extra || "") + "</div>";
  }

  // ---------- welcome: one question, then a whole site
  function renderWelcome() {
    var p = S.profile();
    var kinds = Object.keys(B.KINDS).map(function (k) {
      return '<button type="button" class="kind" data-kind="' + k + '"><svg viewBox="0 0 40 40" aria-hidden="true">' + KIND_ICON[k] + "</svg><span>" + esc(B.KINDS[k].name) + "</span></button>";
    }).join("");
    var needName = !String(p.name || "").trim();
    app.innerHTML = head() + '<div class="wrap"><div class="welcome">' +
      '<div class="welcome-copy"><p class="eyebrow">A website you own</p><h2>A warm, simple website for your business, ready this afternoon</h2>' +
      '<p class="muted">Shopfront Studio builds a one-page site from the details you already keep in Fair Measure: your name, phone, prices and hours. You download it as one file and put it online for free. No monthly fee, no ads, no tracking of your visitors.</p>' +
      '<ul class="ticks"><li>' + ICON.check + "Looks good on phones and computers</li><li>" + ICON.check + "Shows up properly in search results</li><li>" + ICON.check + "Yours to keep, host anywhere, change any time</li></ul></div>" +
      '<form class="card float start-card" id="start">' +
      (needName ? '<div class="grid-2">' + field("Business name", '<input name="name" required autocomplete="organization">') + field("Phone", '<input name="phone" type="tel" autocomplete="tel">') + "</div>" +
        field("Email", '<input name="email" type="email" autocomplete="email">', "Saved to My business, so your quotes and invoices use it too.") : "") +
      '<fieldset class="kinds"><legend class="label">What kind of business is it?</legend><div class="kind-grid">' + kinds + "</div></fieldset>" +
      '<p class="muted small">We\'ll start you off with a few friendly words for that kind of work. Change anything you like.</p></form>' +
      "</div></div>";
    $$(".kind", app).forEach(function (b) {
      b.addEventListener("click", function () {
        var f = $("#start");
        if (needName) {
          if (!f.name.value.trim()) { f.name.focus(); f.reportValidity(); return; }
          try { S.saveProfile({ name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim() }); }
          catch (e) { FM.toast(e.message); return; }
        }
        try { site = S.put("sites", B.starter(b.getAttribute("data-kind"), S.profile(), items())); }
        catch (e) { FM.toast(e.message); return; }
        renderEditor();
        FM.toast("Your site is ready. Have a look, then make it yours.");
      });
    });
  }

  // ---------- editor
  function section(id, title, sub, body, opts) {
    opts = opts || {};
    var showable = opts.toggle;
    var on = showable ? get(id + ".show") !== false : true;
    return '<details class="sec card" id="sec-' + id + '"' + (opts.open ? " open" : "") + ">" +
      "<summary><span class=\"sec-t\"><b>" + title + "</b><small>" + sub + "</small></span>" +
      (showable ? '<span class="pill ' + (on ? "green" : "") + '" data-state="' + id + '">' + (on ? "On the site" : "Hidden") + "</span>" : "") +
      '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>' +
      '<div class="sec-body">' + (showable ? check(id + ".show", on, "Show this on my site") : "") + body + "</div></details>";
  }

  function renderEditor() {
    var p = S.profile();
    var kindOpts = Object.keys(B.KINDS).map(function (k) { return '<option value="' + k + '"' + (site.kind === k ? " selected" : "") + ">" + esc(B.KINDS[k].name) + "</option>"; }).join("");
    var kind = B.KINDS[site.kind] || B.KINDS.other;

    var business = '<div class="grid-2">' + field("Business name", pInput("name", ' autocomplete="organization"')) + field("Your name", pInput("owner", ' autocomplete="name"'), "Signs the About section, if you like.") + "</div>" +
      '<div class="grid-2">' + field("Phone", pInput("phone", ' type="tel" autocomplete="tel"')) + field("Email", pInput("email", ' type="email" autocomplete="email"')) + "</div>" +
      field("Address", '<textarea data-p="address" rows="2" autocomplete="street-address">' + esc(p.address) + "</textarea>", "Leave it blank if you work from home and would rather not share it.") +
      field("Your web address, once it's online", pInput("website", ' inputmode="url" placeholder="e.g. hollowoak.netlify.app"'), "Helps search engines, and prints on your invoices.") +
      '<div class="grid-2">' + field("Kind of business", '<select data-f="kind">' + kindOpts + "</select>") +
      '<div class="field"><span>Logo</span><div class="logo-row">' + (p.logo ? '<img src="' + esc(p.logo) + '" alt="Your logo">' : '<span class="muted">No logo yet.</span>') +
      ' <a href="' + FM.link("settings/") + '">' + (p.logo ? "Change" : "Add one") + " in My business</a></div></div></div>" +
      '<p class="hint muted">These details are shared with your quotes, invoices and customer book.</p>';

    var hero = site.heroPhoto && site.heroPhoto.src;
    var front = field("A short line above your name", input("tagline", site.tagline, ' maxlength="80"')) +
      field("Headline", input("headline", site.headline, ' maxlength="90" placeholder="' + esc(p.name || "Your business name") + '"'), "Most businesses use their name.") +
      field("Welcome words", area("intro", site.intro, ' rows="3" maxlength="400"'), "Two or three sentences: what you do, for whom, and where." + (String(site.intro).trim() === kind.intro ? ' <b class="starter">Starter text: make it yours.</b>' : "")) +
      '<div class="field"><span>Main photo <i>(optional)</i></span>' +
      (hero ? '<div class="hero-pick"><img src="' + esc(hero) + '" alt=""><div class="hero-pick-f">' + field("Describe the photo", input("heroPhoto.alt", site.heroPhoto.alt, ' placeholder="e.g. Fresh loaves cooling on a rack"')) +
        '<button type="button" class="btn small ghost" data-act="hero-remove">' + ICON.x + "Remove photo</button></div></div>"
        : '<label class="drop">' + ICON.photo + '<span><b>Add a photo</b><small>Your work, your shop front, or you. We shrink it to load quickly.</small></span><input type="file" accept="image/*" id="hero-file" class="sr"></label>') + "</div>";

    var its = items();
    var picked = (site.offer.itemIds || []);
    var itemRows = its.length ? '<div class="pick-list">' + its.map(function (it) {
      return '<label class="pick"><input type="checkbox" data-item="' + esc(it.id) + '"' + (picked.indexOf(it.id) >= 0 ? " checked" : "") + "><span>" + esc(it.name) + "</span>" +
        '<small class="muted">' + (it.price ? fmt(it.price) + (it.unit ? " / " + esc(it.unit) : "") : "") + "</small></label>";
    }).join("") + "</div>" : '<p class="notice blue">Your items list is empty. Add a few things you sell below, or price them first in <a href="' + FM.link("pricing/") + '">Price Builder</a>.</p>';
    var offer = '<div class="grid-2">' + field("Heading", input("offer.title", site.offer.title, ' placeholder="' + esc(kind.offer) + '"')) +
      '<div class="field"><span>Prices</span>' + check("offer.showPrices", site.offer.showPrices !== false, "Show prices") + check("offer.from", !!site.offer.from, "Say \"from\" before each price") + "</div></div>" +
      '<div class="field"><span>Pick from your items</span>' + itemRows + "</div>" +
      '<form class="quick-add" id="item-add"><span class="label">Add something new to your items</span><div class="qa-row">' +
      '<input name="name" placeholder="e.g. Sourdough loaf" aria-label="Name" required><input name="price" inputmode="decimal" placeholder="Price" aria-label="Price"><input name="unit" placeholder="per…" aria-label="Unit, like hour or dozen">' +
      '<button class="btn small ghost">' + ICON.plus + "Add</button></div></form>" +
      field("A line under the list <i>(optional)</i>", area("offer.note", site.offer.note, ' rows="2" placeholder="e.g. Custom orders welcome. Prices include tax."'));

    var about = field("Heading", input("about.title", site.about.title, ' placeholder="About us"')) +
      field("Your story", area("about.text", site.about.text, ' rows="6" placeholder="Who you are, how you started, and what you care about in your work. Plain and true is best."')) +
      (p.owner ? check("about.sign", site.about.sign !== false, "Sign it with your name (" + esc(p.owner) + ")") : "");

    var days = site.hours.days || [];
    var dayRows = B.DAYS.map(function (d, i) {
      var x = days[i] || { closed: true, open: "09:00", close: "17:00" };
      return '<div class="day' + (x.closed ? " is-closed" : "") + '"><label class="check"><input type="checkbox" data-day="' + i + '"' + (x.closed ? "" : " checked") + "><span>" + d + "</span></label>" +
        '<input type="time" data-f="hours.days.' + i + '.open" value="' + esc(x.open) + '" aria-label="' + d + ' opens"' + (x.closed ? " disabled" : "") + ">" +
        '<span class="to">to</span><input type="time" data-f="hours.days.' + i + '.close" value="' + esc(x.close) + '" aria-label="' + d + ' closes"' + (x.closed ? " disabled" : "") + "></div>";
    }).join("");
    var hours = '<div class="field"><span>Opening hours</span><div class="preset-row"><button type="button" class="chip" data-preset="weekdays">Weekdays 9 to 5</button><button type="button" class="chip" data-preset="copy">Copy the first open day to all open days</button><button type="button" class="chip" data-preset="none">No set hours</button></div>' +
      '<div class="days">' + dayRows + "</div></div>" +
      field("A note about hours <i>(optional)</i>", input("hours.note", site.hours.note, ' placeholder="e.g. By appointment. Closed on holy days of obligation."')) +
      field("Where you work <i>(optional)</i>", input("hours.area", site.hours.area, ' placeholder="e.g. Saratoga County and nearby towns"')) +
      (p.address ? check("hours.showAddress", site.hours.showAddress !== false, "Show my address and a directions link") : "");

    var photos = site.gallery.photos || [];
    var gallery = field("Heading", input("gallery.title", site.gallery.title, ' placeholder="A look at our work"')) +
      '<div class="photos">' + photos.map(function (ph, i) {
        return '<div class="photo"><img src="' + esc(ph.src) + '" alt=""><div class="photo-f">' +
          field("Describe it", input("gallery.photos." + i + ".alt", ph.alt, ' placeholder="What is in the photo?"')) +
          field("Caption <i>(optional)</i>", input("gallery.photos." + i + ".caption", ph.caption)) +
          '</div><button type="button" class="icon-btn" data-act="photo-remove" data-i="' + i + '" aria-label="Remove photo">' + ICON.x + "</button></div>";
      }).join("") + "</div>" +
      (photos.length < MAX_PHOTOS ? '<label class="drop">' + ICON.photo + '<span><b>Add photos</b><small>Up to ' + MAX_PHOTOS + ". Choose several at once if you like.</small></span><input type=\"file\" accept=\"image/*\" multiple id=\"gallery-file\" class=\"sr\"></label>" : "");

    var revs = site.reviews.list || [];
    var reviews = '<p class="notice">Only use real words from real customers, and ask them first. A first name and town is plenty.</p>' +
      revs.map(function (r, i) {
        return '<div class="pair">' + field("What they said", area("reviews.list." + i + ".text", r.text, ' rows="2"')) +
          '<div class="pair-row">' + field("Who said it", input("reviews.list." + i + ".name", r.name, ' placeholder="e.g. Margaret, Ballston Spa"')) +
          '<button type="button" class="icon-btn" data-act="list-remove" data-list="reviews.list" data-i="' + i + '" aria-label="Remove">' + ICON.x + "</button></div></div>";
      }).join("") + '<button type="button" class="btn small ghost" data-act="list-add" data-list="reviews.list">' + ICON.plus + "Add kind words</button>";

    var qs = site.faq.list || [];
    var faq = '<p class="hint muted">Only questions with an answer appear on your site.</p>' +
      qs.map(function (f, i) {
        return '<div class="pair"><div class="pair-row">' + field("Question", input("faq.list." + i + ".q", f.q)) +
          '<button type="button" class="icon-btn" data-act="list-remove" data-list="faq.list" data-i="' + i + '" aria-label="Remove">' + ICON.x + "</button></div>" +
          field("Answer", area("faq.list." + i + ".a", f.a, ' rows="2"')) + "</div>";
      }).join("") + '<button type="button" class="btn small ghost" data-act="list-add" data-list="faq.list">' + ICON.plus + "Add a question</button>";

    var contact = '<div class="grid-2">' + field("Heading", input("contact.title", site.contact.title, ' placeholder="Get in touch"')) +
      field("Ways to pay <i>(optional)</i>", input("contact.pay", site.contact.pay, ' placeholder="e.g. Cash, check, card, Venmo"')) + "</div>" +
      field("A friendly line", input("contact.text", site.contact.text, ' placeholder="We\'d be glad to hear from you."')) +
      field("Social pages <i>(optional)</i>", '<textarea data-social rows="3" placeholder="One web address per line, e.g. facebook.com/hollowoak">' + esc((site.contact.social || []).join("\n")) + "</textarea>") +
      check("contact.quoteButton", site.contact.quoteButton !== false, "Add an \"Ask for a quote\" button that opens an email to you");

    var look = site.look;
    var swatches = Object.keys(B.PALETTES).map(function (k) {
      var pl = B.PALETTES[k];
      return '<label class="swatch"><input type="radio" name="palette" data-f="look.palette" value="' + k + '"' + (look.palette === k ? " checked" : "") + ">" +
        '<span class="sw" style="background:' + pl.bg + ";border-color:" + pl.line + '"><i style="background:' + pl.accent + '"></i><i style="background:' + pl.soft + '"></i></span><span>' + esc(pl.name) + "</span></label>";
    }).join("");
    var types = Object.keys(B.TYPES).map(function (k) {
      var t = B.TYPES[k];
      return '<label class="type-opt"><input type="radio" name="type" data-f="look.type" value="' + k + '"' + (look.type === k ? " checked" : "") + ">" +
        '<span><b class="tf-' + k + '">Aa</b><span><b>' + t.name + "</b><small>" + t.note + "</small></span></span></label>";
    }).join("");
    var lookBody = '<div class="field"><span>Colors</span><div class="swatches">' + swatches + "</div></div>" +
      '<div class="field"><span>Lettering</span><div class="types">' + types + "</div></div>" +
      '<div class="field"><span>Your own color <span class="pill gold">Pro</span></span>' +
      (pro() ? '<div class="row">' + '<input type="color" data-f="look.custom" value="' + esc(look.custom || p.accent || "#3d5876") + '" aria-label="Your own color">' +
        (look.custom ? '<button type="button" class="btn small ghost" data-act="custom-clear">Use the palette color</button>' : "") + "</div><small>We darken it a touch if needed, so buttons stay easy to read.</small>"
        : '<small>Pro lets you match your own brand color and removes the small "Made with Fair Measure" line at the bottom of your site. <a href="' + FM.link("settings/#pro") + '">About Pro</a></small>') + "</div>";

    var editor =
      section("business", "Your business", "Name, phone, email and address", business, { open: true }) +
      section("front", "Front page", "The first thing visitors see", front, { open: true }) +
      section("offer", "What you offer", "Your prices, straight from your items", offer, { toggle: true }) +
      section("about", "About you", "Your story, in your words", about, { toggle: true }) +
      section("hours", "Hours and location", "When and where to find you", hours, { toggle: true }) +
      section("gallery", "Photos", "Show your work", gallery, { toggle: true }) +
      section("reviews", "Kind words", "From real customers", reviews, { toggle: true }) +
      section("faq", "Questions", "Answer the common ones once", faq, { toggle: true }) +
      section("contact", "Contact", "How to reach you", contact) +
      section("look", "Look", "Colors and lettering", lookBody);

    app.innerHTML = head('<div class="head-actions"><a class="btn small ghost" href="#publish">' + ICON.globe + 'Put it online</a>' +
      '<button type="button" class="btn small" data-act="download">' + ICON.download + "Download my website</button></div>") +
      '<div class="wrap"><p class="status-line"><span class="muted" id="saved">Saved</span><span id="dl-note"></span></p>' +
      '<div class="ed-switch" role="tablist"><button type="button" role="tab" data-tab="edit" aria-selected="true">Edit</button><button type="button" role="tab" data-tab="preview" aria-selected="false">Preview</button></div>' +
      '<div class="sf-grid" data-tab="edit"><div class="sf-form">' + editor + "</div>" +
      '<div class="sf-preview"><div class="pv-sticky"><div class="pv-bar"><div class="seg" role="group" aria-label="Preview size">' +
      '<button type="button" data-view="desktop" aria-pressed="' + (view === "desktop") + '">Computer</button><button type="button" data-view="phone" aria-pressed="' + (view === "phone") + '">Phone</button></div>' +
      '<button type="button" class="btn small ghost" data-act="open-tab">' + ICON.open + "Full size</button></div>" +
      '<div class="pv-frame ' + view + '"><div class="pv-chrome"><i></i><i></i><i></i><span id="pv-url">' + esc(B.webHref(p.website).replace(/^https?:\/\//, "") || "your-business.example") + "</span></div>" +
      '<div class="pv-scale"><iframe id="pv" title="Preview of your website" sandbox="allow-same-origin" loading="eager"></iframe></div></div>' +
      "</div></div></div></div>";

    bindEditor();
    downloadNote();
    preview(true);
  }

  function bindEditor() {
    app.addEventListener("input", onInput);
    app.addEventListener("change", onChange);
  }
  function unbind() {
    app.removeEventListener("input", onInput);
    app.removeEventListener("change", onChange);
  }

  function onInput(e) {
    var t = e.target;
    if (t.hasAttribute("data-f") && t.type !== "radio" && t.type !== "checkbox" && t.type !== "file") {
      set(t.getAttribute("data-f"), t.value);
      if (t.getAttribute("data-f") === "intro") starterNote();
      save(); preview();
    } else if (t.hasAttribute("data-p")) {
      var patch = {}; patch[t.getAttribute("data-p")] = t.value;
      try { S.saveProfile(patch); } catch (err) { FM.toast(err.message); }
      if (t.getAttribute("data-p") === "website") $("#pv-url").textContent = B.webHref(t.value).replace(/^https?:\/\//, "") || "your-business.example";
      preview();
    } else if (t.hasAttribute("data-social")) {
      site.contact.social = t.value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      save(); preview();
    }
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === "hero-file") return addHero(t.files[0]);
    if (t.id === "gallery-file") return addPhotos(t.files);
    if (t.hasAttribute("data-item")) {
      var id = t.getAttribute("data-item"), ids = (site.offer.itemIds || []).filter(function (x) { return x !== id; });
      if (t.checked) ids.push(id);
      // Keep the owner's order: the order of the items list.
      var order = items().map(function (it) { return it.id; });
      site.offer.itemIds = ids.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      save(); preview(); return;
    }
    if (t.hasAttribute("data-day")) {
      var i = +t.getAttribute("data-day");
      set("hours.days." + i + ".closed", !t.checked);
      var row = t.closest(".day");
      row.classList.toggle("is-closed", !t.checked);
      $$('input[type="time"]', row).forEach(function (x) { x.disabled = !t.checked; });
      if (t.checked && site.hours.show === false) setShow("hours", true);
      save(); preview(); return;
    }
    if (!t.hasAttribute("data-f")) return;
    var path = t.getAttribute("data-f");
    if (t.type === "checkbox") {
      set(path, t.checked);
      var m = /^(\w+)\.show$/.exec(path);
      if (m) setShow(m[1], t.checked);
    } else if (t.type === "radio") {
      if (t.checked) set(path, t.value);
    } else if (t.type === "color") {
      set(path, t.value);
    } else if (path === "kind") {
      changeKind(t.value);
      return;
    }
    save(); preview();
  }
  function setShow(id, on) {
    set(id + ".show", on);
    var pill = $('[data-state="' + id + '"]');
    if (pill) { pill.textContent = on ? "On the site" : "Hidden"; pill.classList.toggle("green", on); }
    var box = $('[data-f="' + id + '.show"]');
    if (box) box.checked = on;
  }
  function starterNote() {
    var kind = B.KINDS[site.kind] || B.KINDS.other;
    var small = $('[data-f="intro"]').parentNode.querySelector("small");
    var b = small && small.querySelector(".starter");
    if (b && String(site.intro).trim() !== kind.intro) b.remove();
  }

  // Changing the kind swaps only the starter words the owner hasn't changed.
  function changeKind(k) {
    var from = B.KINDS[site.kind] || B.KINDS.other, to = B.KINDS[k];
    if (site.tagline === from.tagline) site.tagline = to.tagline;
    if (site.intro === from.intro) site.intro = to.intro;
    if (site.offer.title === from.offer) site.offer.title = to.offer;
    var untouched = (site.faq.list || []).every(function (f) { return !String(f.a || "").trim() && from.faq.indexOf(f.q) >= 0; });
    if (untouched) site.faq.list = to.faq.map(function (q) { return { q: q, a: "" }; });
    site.kind = k;
    save(true);
    rerender();
  }

  // Re-draws the editor but keeps the open sections and scroll position.
  function rerender() {
    var open = $$("details.sec[open]").map(function (d) { return d.id; });
    var y = window.scrollY;
    unbind();
    renderEditor();
    $$("details.sec").forEach(function (d) { d.open = open.indexOf(d.id) >= 0; });
    window.scrollTo(0, y);
  }

  function onClick(e) {
    var b = e.target.closest("[data-act],[data-view],[data-tab],[data-preset]");
    if (!b || !app.contains(b)) return;
    if (b.hasAttribute("data-view")) {
      view = b.getAttribute("data-view");
      $$("[data-view]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var fr = $(".pv-frame"); fr.classList.remove("desktop", "phone"); fr.classList.add(view);
      return fit();
    }
    if (b.hasAttribute("data-tab")) {
      var tab = b.getAttribute("data-tab");
      $$(".ed-switch button").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      $(".sf-grid").setAttribute("data-tab", tab);
      if (tab === "preview") { preview(true); }
      return;
    }
    if (b.hasAttribute("data-preset")) return preset(b.getAttribute("data-preset"));
    var act = b.getAttribute("data-act");
    if (act === "download") return download();
    if (act === "open-tab") return openTab();
    if (act === "hero-remove") { site.heroPhoto = null; save(true); return rerender(); }
    if (act === "photo-remove") { site.gallery.photos.splice(+b.getAttribute("data-i"), 1); save(true); return rerender(); }
    if (act === "custom-clear") { site.look.custom = ""; save(true); return rerender(); }
    if (act === "list-add") {
      var list = get(b.getAttribute("data-list"));
      list.push(b.getAttribute("data-list") === "faq.list" ? { q: "", a: "" } : { text: "", name: "" });
      save(true); rerender();
      var last = $$('[data-f^="' + b.getAttribute("data-list") + "." + (list.length - 1) + '."]')[0];
      if (last) last.focus();
      return;
    }
    if (act === "list-remove") { get(b.getAttribute("data-list")).splice(+b.getAttribute("data-i"), 1); save(true); preview(); return rerender(); }
  }

  function preset(kind) {
    var d = site.hours.days;
    if (kind === "weekdays") d.forEach(function (x, i) { x.closed = i >= 5; x.open = "09:00"; x.close = "17:00"; });
    if (kind === "none") d.forEach(function (x) { x.closed = true; });
    if (kind === "copy") {
      var first = d.find(function (x) { return !x.closed; });
      if (!first) { FM.toast("Tick the days you're open first."); return; }
      d.forEach(function (x) { if (!x.closed) { x.open = first.open; x.close = first.close; } });
    }
    if (kind !== "none" && site.hours.show === false) site.hours.show = true;
    save(true); rerender();
  }

  // ---------- items: adding here puts them on the shared list every tool uses
  function onSubmit(e) {
    if (e.target.id !== "item-add") return;
    e.preventDefault();
    var f = e.target, name = f.name.value.trim();
    if (!name) return;
    if (!L.canAdd("items", S.count("items")).allowed) {
      FM.confirm({ title: "You've reached the free limit", body: "The free version keeps up to " + L.limits.items + " saved items. Pro removes every limit for a one-time " + L.config.price + ". You can also tick items you already have.", ok: "See Pro", cancel: "Not now" })
        .then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); });
      return;
    }
    var existing = S.all("items").find(function (it) { return String(it.name).toLowerCase() === name.toLowerCase(); });
    try {
      var rec = existing || S.put("items", { name: name, price: FM.money.toCents(f.price.value), unit: f.unit.value.trim().replace(/^per\s+/i, ""), taxable: true });
      if (site.offer.itemIds.indexOf(rec.id) < 0) site.offer.itemIds.push(rec.id);
      if (site.offer.show === false) site.offer.show = true;
      save(true);
    } catch (err) { FM.toast(err.message); return; }
    FM.toast(existing ? "Already in your items, so it's ticked" : "Added to your items and your site");
    rerender();
    var again = $('#item-add input[name="name"]');
    if (again) again.focus();
  }

  // ---------- photos: shrunk in the browser so the site stays quick and storage stays small
  function shrink(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("That file isn't a photo."));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fbf8f3"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("We couldn't read that photo. Try a JPEG or PNG.")); };
      img.src = url;
    });
  }
  function addHero(file) {
    if (!file) return;
    shrink(file, 1600, 0.8).then(function (src) {
      site.heroPhoto = { src: src, alt: "" };
      if (!persist()) site.heroPhoto = null;
      rerender();
      var a = $('[data-f="heroPhoto.alt"]'); if (a) a.focus();
    }, function (e) { FM.toast(e.message); });
  }
  function addPhotos(files) {
    var list = Array.prototype.slice.call(files || []);
    var room = MAX_PHOTOS - site.gallery.photos.length;
    if (list.length > room) FM.toast("Added the first " + room + "; a site holds up to " + MAX_PHOTOS + " photos.");
    list = list.slice(0, room);
    FM.toast("Adding " + list.length + (list.length === 1 ? " photo…" : " photos…"));
    list.reduce(function (p, f) {
      return p.then(function () {
        return shrink(f, 1200, 0.78).then(function (src) { site.gallery.photos.push({ id: S.uid(), src: src, alt: "", caption: "" }); }, function (e) { FM.toast(e.message); });
      });
    }, Promise.resolve()).then(function () {
      if (site.gallery.show === false) site.gallery.show = true;
      if (!persist()) site = S.get("sites", site.id) || site;
      rerender();
    });
  }

  // ---------- preview
  function fontUrls() {
    return { fraunces: new URL(FM.link("shared/fonts/Fraunces.woff2"), location.href).href, sans: new URL(FM.link("shared/fonts/SourceSans3.woff2"), location.href).href };
  }
  function html(fonts) { return B.build(site, S.profile(), S.all("items"), { pro: pro(), fonts: fonts || fontUrls(), preview: !fonts }); }
  function preview(now) {
    clearTimeout(previewTimer);
    var run = function () {
      var f = $("#pv");
      if (!f) return;
      var y = f.contentWindow && f.contentWindow.scrollY;
      f.srcdoc = html();
      f.onload = function () { try { if (y) f.contentWindow.scrollTo(0, y); } catch (e) { /* fine */ } };
      fit();
    };
    if (now) run(); else previewTimer = setTimeout(run, 250);
  }
  // Draws the site at its real width and scales it down to fit the column.
  function fit() {
    var box = $(".pv-scale"), f = $("#pv");
    if (!box || !f) return;
    var w = box.clientWidth, h = box.clientHeight;
    var real = view === "phone" ? 390 : 1100;
    var scale = Math.min(1, w / real);
    f.style.width = real + "px";
    f.style.height = Math.ceil(h / scale) + "px";
    f.style.transform = "scale(" + scale + ")";
    f.style.left = view === "phone" ? Math.max(0, (w - real * scale) / 2) + "px" : "0";
  }

  // ---------- download and open
  function dataUrl(path) {
    return fetch(FM.link(path)).then(function (r) { if (!r.ok) throw new Error("font"); return r.blob(); }).then(function (b) {
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).replace(/^data:[^;]*;/, "data:font/woff2;")); }; fr.readAsDataURL(b); });
    });
  }
  // The published file carries its own fonts, so it looks the same on any host.
  function finalHtml() {
    var need = (B.TYPES[site.look.type] || B.TYPES.classic).fonts;
    return Promise.all([
      need.indexOf("fraunces") >= 0 ? dataUrl("shared/fonts/Fraunces.woff2") : null,
      need.indexOf("sans") >= 0 ? dataUrl("shared/fonts/SourceSans3.woff2") : null
    ]).then(function (f) { return html({ fraunces: f[0], sans: f[1] }); }, function () { return html({}); });
  }
  function download() {
    flushSave();
    var problems = B.checklist(site, S.profile(), S.all("items")).filter(function (c) { return !c.soft; });
    if (problems.length) { FM.toast(problems[0].text); return; }
    finalHtml().then(function (text) {
      var blob = new Blob([text], { type: "text/html" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "index.html";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      site.downloadedAt = new Date().toISOString();
      save(true);
      FM.toast("Downloaded index.html. Next, put it online.");
      downloadNote();
    });
  }
  function openTab() {
    var w = window.open("", "_blank");
    finalHtml().then(function (text) {
      var url = URL.createObjectURL(new Blob([text], { type: "text/html" }));
      if (w) w.location.href = url; else window.open(url, "_blank");
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
  }
  function downloadNote() {
    var el = $("#dl-note");
    if (!el || !site) return;
    if (!site.downloadedAt) { el.innerHTML = ""; return; }
    var changed = (site.updatedAt || "") > site.downloadedAt;
    el.innerHTML = changed
      ? ' · <span class="pill gold">Changed since your last download</span> <a href="#publish">How to update your site</a>'
      : ' · <span class="muted">Downloaded ' + new Date(site.downloadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + "</span>";
  }

  // ---------- publish guide
  function renderPublish() {
    var p = S.profile();
    var list = B.checklist(site, p, S.all("items"));
    var checks = list.length
      ? '<ul class="todo">' + list.map(function (c) { return '<li class="' + (c.soft ? "soft" : "must") + '">' + ICON.dot + "<span>" + esc(c.text) + "</span></li>"; }).join("") + "</ul>"
      : '<p class="all-good">' + ICON.check + "Everything looks ready.</p>";
    var hosts = [
      ["Netlify Drop", "The easiest start", "netlify.app",
        ["Download your website (it saves a file called <b>index.html</b>).", "Make a new folder, name it after your business, and move <b>index.html</b> into it.",
          'Open <b>app.netlify.com/drop</b> and drag the folder onto the page.', "Make a free account when asked, so your site stays online. You can rename its address in the site settings."]],
      ["Cloudflare Pages", "Fast, with a generous free plan", "pages.dev",
        ["Download your website and put <b>index.html</b> in its own folder, as above.", "Make a free Cloudflare account, open <b>Workers &amp; Pages</b>, and create a Pages project by uploading files.",
          "Name the project (that becomes your address) and upload the folder."]],
      ["GitHub Pages", "Good if you already use GitHub", "github.io",
        ["Make a new public repository.", "Choose <b>Add file</b>, then <b>Upload files</b>, and upload <b>index.html</b>.", "In the repository's <b>Settings</b>, open <b>Pages</b>, pick the main branch, and save."]]
    ];
    app.innerHTML = head('<div class="head-actions"><button type="button" class="btn small" data-act="download">' + ICON.download + "Download my website</button></div>") +
      '<div class="wrap pub">' +
      '<a class="back" href="#">' + ICON.back + "Back to editing</a>" +
      '<div class="pub-intro"><h2>Put your site online</h2><p class="muted">Your website is one file. Any web host can serve it, and the three below do it for free. Pick one; they all work well.</p></div>' +
      '<div class="pub-grid"><section class="card"><h3>Before you publish</h3>' + checks + "</section>" +
      '<section class="card"><h3>Your web address</h3><p class="muted">Each host gives you a free address. When you know it, type it here so search engines and your invoices use it.</p>' +
      '<label class="field"><span>Web address</span><input data-pub-web value="' + esc(p.website) + '" inputmode="url" placeholder="e.g. hollowoak.netlify.app"></label>' +
      '<p class="hint muted">Want your own name, like hollowoak.com? Buy it from any domain seller (usually $10 to $20 a year) and connect it in your host\'s settings.</p></section></div>' +
      '<div class="hosts">' + hosts.map(function (h) {
        return '<section class="card host"><div class="host-h"><h3>' + h[0] + '</h3><span class="pill">' + h[2] + '</span></div><p class="muted">' + h[1] + "</p><ol>" + h[3].map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol></section>";
      }).join("") + "</div>" +
      '<section class="card update"><h3>Changing your site later</h3><p>Make your changes here, download again, and upload the new <b>index.html</b> the same way. It replaces the old one, and your address stays the same.</p>' +
      '<p class="muted small">These hosts are run by other companies with their own terms. We don\'t earn anything for recommending them. Your site has no scripts, cookies or trackers, so you don\'t need a cookie banner.</p></section>' +
      "</div>";
    var web = $("[data-pub-web]");
    web.addEventListener("input", function () { try { S.saveProfile({ website: web.value.trim() }); } catch (e) { FM.toast(e.message); } });
  }

  // ---------- start
  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    app.addEventListener("click", onClick);
    app.addEventListener("submit", onSubmit);
    window.addEventListener("hashchange", function () { unbind(); route(); });
    window.addEventListener("resize", fit);
    window.addEventListener("beforeunload", flushSave);
    S.onChange(function (key, external) {
      if (!external || !site) return;
      if (key === "sites") { unbind(); route(); return; }
      if (key === "profile" || key === "items") preview();
    });
    route();
  });
})();
