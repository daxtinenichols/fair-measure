/* Shopfront Studio site builder. Pure functions: turns the saved site, the shared business
   profile and the shared items list into one self-contained web page (HTML with its styles,
   fonts and photos inside, and no scripts), ready to upload to any free host.
   Loaded by the page (window.FMSite) and by the tests (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMSite = factory();
})(this, function () {
  "use strict";

  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Warm palettes. Each accent passes WCAG AA (4.5:1) under white button text.
  var PALETTES = {
    parchment: { name: "Parchment & blue", bg: "#fbf8f3", panel: "#fffdf9", ink: "#2b2622", muted: "#6b5f55", line: "#e7ddcd", accent: "#3d5876", soft: "#e5ebf2" },
    sage: { name: "Sage", bg: "#f7f6f0", panel: "#fdfdf9", ink: "#272a24", muted: "#5f6458", line: "#dfe2d5", accent: "#4d6d51", soft: "#e4ecdf" },
    terracotta: { name: "Terracotta", bg: "#fbf6f1", panel: "#fffcf9", ink: "#2d2420", muted: "#6e5b52", line: "#ecdccf", accent: "#a14b37", soft: "#f7e4dc" },
    honey: { name: "Honey", bg: "#fcf8ef", panel: "#fffdf7", ink: "#2b2620", muted: "#6b604f", line: "#ebdfc6", accent: "#7f5d1f", soft: "#f5ead0" },
    plum: { name: "Plum", bg: "#faf7f6", panel: "#fffcfc", ink: "#2a2328", muted: "#685a63", line: "#e8dce1", accent: "#6b4a63", soft: "#efe5ec" }
  };

  var TYPES = {
    classic: { name: "Classic", note: "Fraunces headings, Source Sans text", head: "'Fraunces', Georgia, serif", body: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif", fonts: ["fraunces", "sans"] },
    modern: { name: "Modern", note: "Source Sans throughout", head: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif", body: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif", fonts: ["sans"] },
    traditional: { name: "Traditional", note: "Georgia throughout, the lightest file", head: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif", fonts: [] }
  };

  // Starter words for each kind of business. They describe the kind of work, never facts
  // about this business (no invented years, awards or promises), and the editor flags them
  // until the owner makes them their own. FAQ answers are left for the owner to write.
  var KINDS = {
    food: { name: "Food and baking", tagline: "Made fresh, in small batches",
      intro: "Good food made by hand with care. Order ahead for pickups, gatherings and special days.",
      offer: "Menu and prices", faq: ["How far ahead should I order?", "Do you deliver, or is it pickup only?", "Can you work around allergies?"] },
    trades: { name: "Trades and repairs", tagline: "Careful work, honestly priced",
      intro: "Repairs and projects done right the first time, with a clear quote before any work begins.",
      offer: "Services and prices", faq: ["What area do you serve?", "Do you give free quotes?", "Are you insured?"] },
    cleaning: { name: "Cleaning and home care", tagline: "A clean home without the hassle",
      intro: "Reliable, thorough cleaning for homes and small offices, on a schedule that suits you.",
      offer: "Services and prices", faq: ["Do you bring your own supplies?", "Do I need to be home?", "How do I book or reschedule?"] },
    makers: { name: "Makers and crafts", tagline: "Handmade, one piece at a time",
      intro: "Handmade pieces made to last, plus custom orders made just for you.",
      offer: "What I make", faq: ["Do you take custom orders?", "How long does an order take?", "Do you ship?"] },
    lessons: { name: "Lessons and coaching", tagline: "Patient teaching for every level",
      intro: "Lessons for beginners and returning learners, at a pace that fits you.",
      offer: "Lessons and prices", faq: ["Where do lessons take place?", "What should I bring?", "What if I need to cancel?"] },
    shop: { name: "Shop or stall", tagline: "A friendly local shop",
      intro: "Come in and say hello. Here is what we carry, when we're open, and how to find us.",
      offer: "What we carry", faq: ["Do you take card payments?", "Is there parking nearby?", "Can I order ahead?"] },
    other: { name: "Something else", tagline: "Here to help",
      intro: "A small, local business that takes care of its customers. Here is what we do and how to reach us.",
      offer: "What we offer", faq: ["How do I get started?", "What areas do you serve?", "How do I pay?"] }
  };

  function str(v) { return v == null ? "" : String(v); }
  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Paragraphs from plain text: blank lines split paragraphs, single newlines become <br>.
  function paras(text, cls) {
    return str(text).trim().split(/\n\s*\n/).filter(Boolean).map(function (p) {
      return "<p" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  // ---------- links (only safe schemes ever reach the page)
  function telHref(phone) {
    var d = str(phone).replace(/[^\d+]/g, "");
    return d.replace(/\D/g, "").length >= 3 ? "tel:" + d : "";
  }
  function mailHref(email, subject) {
    email = str(email).trim();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return "";
    return "mailto:" + email + (subject ? "?subject=" + encodeURIComponent(subject) : "");
  }
  function webHref(url) {
    url = str(url).trim();
    if (!url) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
    if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url)) return "";
    return url;
  }
  function mapHref(address) {
    var a = str(address).trim().replace(/\s*\n\s*/g, ", ");
    return a ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a) : "";
  }
  var SOCIAL = [
    [/facebook\.com|fb\.com/i, "Facebook"], [/instagram\.com/i, "Instagram"], [/tiktok\.com/i, "TikTok"],
    [/youtube\.com|youtu\.be/i, "YouTube"], [/linkedin\.com/i, "LinkedIn"], [/pinterest\./i, "Pinterest"],
    [/etsy\.com/i, "Etsy"], [/nextdoor\.com/i, "Nextdoor"], [/(twitter|x)\.com/i, "X"],
    [/google\.[a-z.]+\/maps|g\.page|maps\.app\.goo\.gl/i, "Google"], [/yelp\./i, "Yelp"]
  ];
  function socialName(url) {
    for (var i = 0; i < SOCIAL.length; i++) if (SOCIAL[i][0].test(url)) return SOCIAL[i][1];
    var host = url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./i, "");
    return host;
  }
  // Images must be photos we made in the browser (data: URLs) and nothing else.
  function imgSrc(src) { return /^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(str(src)) ? src : ""; }

  // ---------- colors
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(str(h).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbHex(c) { return "#" + c.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }).join(""); }
  function lum(c) {
    var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Darkens a chosen color just enough for white button text to stay readable (4.5:1).
  function readableAccent(hex) {
    var c = hexRgb(hex);
    if (!c) return null;
    var white = [255, 255, 255];
    for (var i = 0; i < 40 && contrast(c, white) < 4.5; i++) c = c.map(function (v) { return v * 0.94; });
    return rgbHex(c);
  }
  function mix(hex, withHex, t) {
    var a = hexRgb(hex), b = hexRgb(withHex);
    return rgbHex(a.map(function (v, i) { return v + (b[i] - v) * t; }));
  }
  function palette(site, pro) {
    var look = site.look || {};
    var p = Object.assign({}, PALETTES[look.palette] || PALETTES.parchment);
    if (pro && look.custom) {
      var acc = readableAccent(look.custom);
      if (acc) { p.accent = acc; p.soft = mix(acc, "#ffffff", 0.86); }
    }
    return p;
  }

  // ---------- hours
  function fmtTime(t, locale) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(str(t));
    if (!m) return "";
    var h = +m[1], min = +m[2];
    if (!locale || /^en-US$/i.test(locale)) {
      var ap = h < 12 || h === 24 ? "am" : "pm";
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return h12 + (min ? ":" + String(min).padStart(2, "0") : "") + " " + ap;
    }
    try { return new Date(2000, 0, 1, h, min).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return t; }
  }
  function dayText(d, locale) {
    if (!d || d.closed) return "Closed";
    var a = fmtTime(d.open, locale), b = fmtTime(d.close, locale);
    return a && b ? a + " – " + b : "Open";
  }
  // Groups neighbouring days with the same hours: "Mon – Fri  9 am – 5 pm".
  function hourRows(days, locale) {
    var rows = [];
    for (var i = 0; i < 7; i++) {
      var text = dayText(days && days[i], locale);
      var last = rows[rows.length - 1];
      if (last && last.text === text) last.to = i;
      else rows.push({ from: i, to: i, text: text });
    }
    return rows.map(function (r) {
      return { label: r.from === r.to ? DAYS[r.from] : SHORT[r.from] + " – " + SHORT[r.to], text: r.text, closed: r.text === "Closed" };
    });
  }
  function hasHours(days) { return Array.isArray(days) && days.some(function (d) { return d && !d.closed && d.open && d.close; }); }

  // ---------- money
  function money(cents, profile) {
    try {
      return new Intl.NumberFormat(profile.locale || "en-US", { style: "currency", currency: profile.currency || "USD" }).format((cents || 0) / 100);
    } catch (e) { return ((cents || 0) / 100).toFixed(2); }
  }

  // ---------- what goes on the page
  // Works out which sections have something real to show, so an empty section never appears.
  function sections(site, profile, items) {
    var s = site || {};
    var on = function (k) { return !s[k] || s[k].show !== false; };
    var offers = offerList(s, items);
    var reviews = ((s.reviews && s.reviews.list) || []).filter(function (r) { return str(r.text).trim(); });
    var photos = ((s.gallery && s.gallery.photos) || []).filter(function (p) { return imgSrc(p.src); });
    var faq = ((s.faq && s.faq.list) || []).filter(function (f) { return str(f.q).trim() && str(f.a).trim(); });
    var social = ((s.contact && s.contact.social) || []).map(webHref).filter(Boolean);
    return {
      offer: on("offer") && offers.length > 0,
      about: on("about") && !!str(s.about && s.about.text).trim(),
      gallery: on("gallery") && photos.length > 0,
      reviews: on("reviews") && reviews.length > 0,
      hours: on("hours") && (hasHours(s.hours && s.hours.days) || !!str(s.hours && s.hours.note).trim() || !!str(s.hours && s.hours.area).trim() || !!str(profile.address).trim()),
      faq: on("faq") && faq.length > 0,
      contact: true,
      lists: { offers: offers, reviews: reviews, photos: photos, faq: faq, social: social }
    };
  }
  function offerList(s, items) {
    var o = s.offer || {};
    var pick = Array.isArray(o.itemIds) ? o.itemIds : [];
    var byId = {};
    (items || []).forEach(function (it) { byId[it.id] = it; });
    return pick.map(function (id) { return byId[id]; }).filter(function (it) { return it && str(it.name).trim(); });
  }

  // Things worth fixing before the site goes online. Honest nudges, never blockers.
  function checklist(site, profile, items) {
    var s = site || {}, out = [];
    var sec = sections(s, profile, items);
    var kind = KINDS[s.kind] || KINDS.other;
    if (!str(profile.name).trim()) out.push({ id: "name", text: "Add your business name." });
    if (!telHref(profile.phone) && !mailHref(profile.email)) out.push({ id: "contact", text: "Add a phone number or email so customers can reach you." });
    if (str(s.intro).trim() === kind.intro) out.push({ id: "intro", text: "Make the welcome words your own; they're still the starter text.", soft: true });
    if (!sec.offer) out.push({ id: "offer", text: "Pick a few things you offer, so visitors know what you do.", soft: true });
    if (!hasHours(s.hours && s.hours.days) && !str(s.hours && s.hours.note).trim()) out.push({ id: "hours", text: "Add your hours, or a note like \"By appointment\".", soft: true });
    var noAlt = sec.lists.photos.filter(function (p) { return !str(p.alt).trim(); }).length;
    if (noAlt) out.push({ id: "alt", text: "Describe " + (noAlt === 1 ? "one photo" : noAlt + " photos") + " in a few words, for visitors who use screen readers.", soft: true });
    return out;
  }

  // ---------- styles for the published page
  function css(p, type, fontUrls) {
    var faces = "";
    if (fontUrls && fontUrls.fraunces && type.fonts.indexOf("fraunces") >= 0) {
      faces += "@font-face{font-family:'Fraunces';font-weight:400 700;font-display:swap;src:url(" + fontUrls.fraunces + ") format('woff2')}";
    }
    if (fontUrls && fontUrls.sans && type.fonts.indexOf("sans") >= 0) {
      faces += "@font-face{font-family:'Source Sans 3';font-weight:400 700;font-display:swap;src:url(" + fontUrls.sans + ") format('woff2')}";
    }
    return faces +
      ":root{--bg:" + p.bg + ";--panel:" + p.panel + ";--ink:" + p.ink + ";--muted:" + p.muted + ";--line:" + p.line + ";--accent:" + p.accent + ";--soft:" + p.soft + ";--head:" + type.head + ";--body:" + type.body + "}" +
      "*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}" +
      "@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}" +
      "body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 var(--body)}" +
      "img{max-width:100%;display:block}a{color:var(--accent);text-underline-offset:3px}" +
      "h1,h2,h3{font-family:var(--head);font-weight:600;line-height:1.15;margin:0;letter-spacing:-.005em;text-wrap:balance}" +
      "h1{font-size:clamp(36px,6vw,60px)}h2{font-size:clamp(28px,4vw,38px)}h3{font-size:20px}p{margin:0}" +
      ".wrap{max-width:1080px;margin:0 auto;padding:0 20px}" +
      ".skip{position:absolute;left:-999px;top:8px;background:var(--panel);padding:8px 14px;border-radius:8px;z-index:9}.skip:focus{left:8px}" +
      ":focus-visible{outline:3px solid var(--accent);outline-offset:2px}" +
      ".top{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}" +
      ".top .wrap{display:flex;align-items:center;gap:20px;min-height:68px}" +
      ".brand{display:flex;align-items:center;gap:12px;color:var(--ink);text-decoration:none;font:600 21px/1.1 var(--head);min-width:0}" +
      ".brand img{width:42px;height:42px;object-fit:contain;border-radius:10px}" +
      ".brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".nav{display:flex;gap:4px;margin-left:auto}.nav a{padding:9px 13px;border-radius:999px;color:var(--muted);text-decoration:none;font-weight:600;font-size:16px}" +
      ".nav a:hover{background:var(--soft);color:var(--ink)}" +
      ".btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 24px;border-radius:999px;background:var(--accent);color:#fff;font-weight:600;font-size:16px;text-decoration:none;border:1px solid transparent;transition:filter .2s,box-shadow .2s}" +
      ".btn:hover{filter:brightness(.92);box-shadow:0 8px 20px -10px rgba(60,40,20,.45)}" +
      ".btn.ghost{background:var(--panel);color:var(--ink);border-color:var(--line)}.btn.ghost:hover{background:var(--soft);filter:none;box-shadow:none}" +
      ".btn.sm{min-height:44px;padding:0 18px;font-size:15px}" +
      ".top .btn{flex:none}" +
      ".hero{padding:72px 0 64px;background:linear-gradient(180deg,var(--soft),var(--bg) 85%)}" +
      ".hero .wrap{display:grid;gap:44px;align-items:center}.hero.photo .wrap{grid-template-columns:1.05fr 1fr}" +
      ".hero-copy{display:grid;gap:18px;justify-items:start}.hero:not(.photo) .hero-copy{max-width:760px}" +
      ".eyebrow{font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}" +
      ".lede{font-size:20px;color:var(--muted);max-width:54ch}" +
      ".acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}" +
      ".hero-img{border-radius:22px;overflow:hidden;box-shadow:0 24px 50px -24px rgba(60,40,20,.45);aspect-ratio:4/3;background:var(--soft)}" +
      ".hero-img img{width:100%;height:100%;object-fit:cover}" +
      "section.band{padding:68px 0;border-top:1px solid var(--line)}section.band.alt{background:var(--panel)}" +
      ".band-head{display:grid;gap:10px;margin-bottom:30px;max-width:640px}.band-head p{color:var(--muted)}" +
      ".offers{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));align-items:start;gap:14px;list-style:none;margin:0;padding:0}" +
      ".offer{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:18px 22px;border-radius:14px;background:var(--panel);border:1px solid var(--line)}" +
      ".band.alt .offer{background:var(--bg)}" +
      ".offer b{font-weight:600}.offer span{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--accent);font-weight:600}.offer small{color:var(--muted);font-weight:400}" +
      ".note{margin-top:18px;color:var(--muted)}" +
      ".about{display:grid;grid-template-columns:1fr 1.4fr;gap:44px;align-items:start}.about-text{display:grid;gap:14px;font-size:18px}" +
      ".sign{font-family:var(--head);font-style:italic;color:var(--muted)}" +
      ".gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:0}.gallery>:only-child{max-width:520px}" +
      ".gallery figure{margin:0;display:grid;gap:8px}.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:14px;background:var(--soft)}" +
      ".gallery figcaption{font-size:15px;color:var(--muted);font-style:italic}" +
      ".reviews{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.reviews>:only-child{max-width:720px}" +
      ".reviews blockquote{margin:0;padding:24px 26px;border-radius:16px;background:var(--bg);border:1px solid var(--line);display:grid;gap:12px}" +
      ".reviews p{font-family:var(--head);font-size:19px;line-height:1.5}.reviews cite{font-style:normal;color:var(--muted);font-weight:600;font-size:15px}" +
      ".visit{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:28px;align-items:start}.visit>:only-child{max-width:560px}" +
      ".card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px 28px;display:grid;gap:14px}" +
      ".hours{width:100%;border-collapse:collapse}.hours th,.hours td{padding:9px 0;border-bottom:1px solid var(--line);text-align:left;font-weight:400}" +
      ".hours th{font-weight:600;padding-right:16px}.hours td{text-align:right;font-variant-numeric:tabular-nums}.hours tr:last-child th,.hours tr:last-child td{border-bottom:0}" +
      ".hours .closed td{color:var(--muted)}" +
      "address{font-style:normal}" +
      ".faq{display:grid;gap:10px;max-width:780px}" +
      ".faq details{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:0 22px}" +
      ".faq summary{cursor:pointer;font-weight:600;padding:16px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}" +
      ".faq summary::-webkit-details-marker{display:none}.faq summary::after{content:'+';color:var(--accent);font-size:22px;line-height:1}" +
      ".faq details[open] summary::after{content:'\\2212'}.faq details p{padding:0 0 18px;color:var(--muted)}" +
      ".contact{background:var(--accent);color:#fff;border-radius:26px;padding:48px;display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:center}" +
      ".contact h2{color:#fff}.contact p{opacity:.9}.contact .btn{background:#fff;color:var(--ink)}.contact .btn:hover{filter:none;background:var(--soft)}" +
      ".contact .btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}.contact .btn.ghost:hover{background:rgba(255,255,255,.12)}" +
      ".contact-copy{display:grid;gap:14px;justify-items:start}.contact-side{display:grid;gap:18px}" +
      ".ways{display:grid;gap:10px;list-style:none;margin:0;padding:0}.ways a{color:#fff}" +
      ".ways li{display:grid;gap:0}.ways small{opacity:.8;font-size:14px;text-transform:uppercase;letter-spacing:.06em}" +
      ".social{display:flex;gap:8px;flex-wrap:wrap}.social a{color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:999px;padding:6px 14px;text-decoration:none;font-weight:600;font-size:15px}" +
      ".social a:hover{background:rgba(255,255,255,.12)}" +
      "footer{padding:36px 0 44px;color:var(--muted);font-size:15px}footer .wrap{display:flex;gap:10px 24px;flex-wrap:wrap;justify-content:space-between}" +
      "footer a{color:var(--muted)}" +
      "@media (max-width:860px){.hero.photo .wrap,.about,.visit,.contact{grid-template-columns:1fr}.hero{padding:48px 0 44px}.hero.photo .hero-img{order:-1}" +
      ".contact{padding:34px 26px;border-radius:20px}.nav{display:none}.top .btn{margin-left:auto}section.band{padding:52px 0}}" +
      "@media (max-width:560px){.top .wide{display:none}}@media (max-width:420px){.brand{font-size:18px}.top .btn{padding:0 14px}.offer{flex-direction:column;gap:4px}}" +
      "@media print{.top,.skip{display:none}section.band,.hero{padding:24px 0;background:none}.contact{color:var(--ink);background:none;border:1px solid var(--line)}.contact h2,.ways a,.social a{color:var(--ink)}}";
  }

  function faviconHref(profile, p) {
    var logo = imgSrc(profile.logo);
    if (logo) return logo;
    var letter = (str(profile.name).trim().charAt(0) || "S").toUpperCase().replace(/[^A-Z0-9]/, "S");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="' + p.accent + '"/>' +
      '<text x="32" y="44" font-family="Georgia,serif" font-size="36" font-weight="600" text-anchor="middle" fill="#fff">' + letter + "</text></svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  // Schema.org details so search engines show the right name, hours and phone.
  function jsonLd(site, profile, url) {
    var s = site || {};
    var d = { "@context": "https://schema.org", "@type": "LocalBusiness", name: str(profile.name).trim() || "My business" };
    if (str(s.intro).trim()) d.description = str(s.intro).trim();
    if (url) d.url = url;
    if (telHref(profile.phone)) d.telephone = str(profile.phone).trim();
    if (mailHref(profile.email)) d.email = str(profile.email).trim();
    if (str(profile.address).trim()) d.address = str(profile.address).trim().replace(/\s*\n\s*/g, ", ");
    if (str(s.hours && s.hours.area).trim()) d.areaServed = str(s.hours.area).trim();
    var days = (s.hours && s.hours.days) || [];
    var spec = [];
    days.forEach(function (x, i) {
      if (x && !x.closed && /^\d{2}:\d{2}$/.test(x.open || "") && /^\d{2}:\d{2}$/.test(x.close || "")) {
        spec.push({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/" + DAYS[i], opens: x.open, closes: x.close });
      }
    });
    if (s.hours && s.hours.show !== false && spec.length) d.openingHoursSpecification = spec;
    var social = ((s.contact && s.contact.social) || []).map(webHref).filter(Boolean);
    if (social.length) d.sameAs = social;
    // "<" is escaped so nothing typed in a field can close the script element.
    return JSON.stringify(d).replace(/</g, "\\u003c");
  }

  // ---------- the page
  // opts: { pro, fonts: { fraunces, sans } (font file URLs or data: URLs), year }
  function build(site, profile, items, opts) {
    var s = site || {}, pr = profile || {};
    opts = opts || {};
    var p = palette(s, opts.pro);
    var type = TYPES[(s.look || {}).type] || TYPES.classic;
    var kind = KINDS[s.kind] || KINDS.other;
    var name = str(pr.name).trim() || "My business";
    var sec = sections(s, pr, items);
    var L = sec.lists;
    var tel = telHref(pr.phone), mail = mailHref(pr.email), quoteMail = mailHref(pr.email, "Quote request");
    var url = webHref(pr.website);
    var tagline = str(s.tagline).trim();
    var headline = str(s.headline).trim() || name;
    var intro = str(s.intro).trim();
    var title = name + (tagline ? " | " + tagline : "");
    var logo = imgSrc(pr.logo);
    var map = mapHref(pr.address);
    var year = opts.year || new Date().getFullYear();

    var nav = [];
    if (sec.offer) nav.push(["offer", (s.offer && str(s.offer.title).trim()) || kind.offer]);
    if (sec.about) nav.push(["about", "About"]);
    if (sec.hours) nav.push(["visit", "Hours"]);
    nav.push(["contact", "Contact"]);
    var topBtn = tel ? '<a class="btn sm" href="' + esc(tel) + '">Call<span class="wide"> ' + esc(str(pr.phone).trim()) + "</span></a>"
      : mail ? '<a class="btn sm" href="' + esc(mail) + '">Email us</a>' : "";

    var acts = [];
    if (tel) acts.push('<a class="btn" href="' + esc(tel) + '">Call us</a>');
    if (s.contact && s.contact.quoteButton !== false && quoteMail) acts.push('<a class="btn' + (tel ? " ghost" : "") + '" href="' + esc(quoteMail) + '">Ask for a quote</a>');
    else if (mail) acts.push('<a class="btn' + (tel ? " ghost" : "") + '" href="' + esc(mail) + '">Email us</a>');
    if (sec.offer) acts.push('<a class="btn ghost" href="#offer">See ' + esc(((s.offer && str(s.offer.title).trim()) || kind.offer).toLowerCase()) + "</a>");

    var heroImg = imgSrc(s.heroPhoto && s.heroPhoto.src);
    var out = [];
    out.push('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">');
    out.push("<title>" + esc(title) + "</title>");
    if (intro) out.push('<meta name="description" content="' + esc(intro.slice(0, 300)) + '">');
    out.push('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:' + (opts.preview ? " 'self'" : "") + '; base-uri \'none\'; form-action \'none\'">');
    out.push('<meta name="theme-color" content="' + p.bg + '">');
    out.push('<meta property="og:type" content="website"><meta property="og:title" content="' + esc(title) + '">' + (intro ? '<meta property="og:description" content="' + esc(intro.slice(0, 300)) + '">' : ""));
    if (url) out.push('<link rel="canonical" href="' + esc(url) + '"><meta property="og:url" content="' + esc(url) + '">');
    out.push('<link rel="icon" href="' + esc(faviconHref(pr, p)) + '">');
    out.push("<style>" + css(p, type, opts.fonts) + "</style>");
    out.push('<script type="application/ld+json">' + jsonLd(s, pr, url) + "</script>");
    out.push("</head>\n<body>");
    out.push('<a class="skip" href="#main">Skip to content</a>');
    out.push('<header class="top"><div class="wrap"><a class="brand" href="#main">' + (logo ? '<img src="' + logo + '" alt="">' : "") + "<span>" + esc(name) + "</span></a>" +
      '<nav class="nav" aria-label="Sections">' + nav.map(function (n) { return '<a href="#' + n[0] + '">' + esc(n[1]) + "</a>"; }).join("") + "</nav>" + topBtn + "</div></header>");
    out.push('<main id="main">');

    out.push('<section class="hero' + (heroImg ? " photo" : "") + '"><div class="wrap"><div class="hero-copy">' +
      (tagline ? '<p class="eyebrow">' + esc(tagline) + "</p>" : "") + "<h1>" + esc(headline) + "</h1>" +
      (intro ? paras(intro, "lede") : "") + (acts.length ? '<div class="acts">' + acts.join("") + "</div>" : "") + "</div>" +
      (heroImg ? '<div class="hero-img"><img src="' + heroImg + '" alt="' + esc(s.heroPhoto.alt) + '"></div>' : "") + "</div></section>");

    var alt = false;
    function band(id, inner) { alt = !alt; return '<section class="band' + (alt ? " alt" : "") + '" id="' + id + '"><div class="wrap">' + inner + "</div></section>"; }

    if (sec.offer) {
      var o = s.offer || {};
      var showPrices = o.showPrices !== false;
      out.push(band("offer", '<div class="band-head"><h2>' + esc(str(o.title).trim() || kind.offer) + "</h2>" + (str(o.intro).trim() ? paras(o.intro) : "") + "</div>" +
        '<ul class="offers">' + L.offers.map(function (it) {
          var price = showPrices && it.price > 0 ? money(it.price, pr) + (it.unit && it.unit !== "each" ? " <small>/ " + esc(it.unit) + "</small>" : "") : "";
          return '<li class="offer"><b>' + esc(it.name) + "</b>" + (price ? "<span>" + (o.from ? "<small>from </small>" : "") + price + "</span>" : "") + "</li>";
        }).join("") + "</ul>" + (str(o.note).trim() ? paras(o.note, "note") : "")));
    }
    if (sec.about) {
      var a = s.about || {};
      out.push(band("about", '<div class="about"><h2>' + esc(str(a.title).trim() || "About us") + '</h2><div class="about-text">' + paras(a.text) +
        (str(pr.owner).trim() && a.sign !== false ? '<p class="sign">' + esc(str(pr.owner).trim()) + "</p>" : "") + "</div></div>"));
    }
    if (sec.gallery) {
      out.push(band("photos", '<div class="band-head"><h2>' + esc(str(s.gallery.title).trim() || "A look at our work") + '</h2></div><div class="gallery">' +
        L.photos.map(function (ph) {
          return "<figure><img src=\"" + ph.src + '" alt="' + esc(ph.alt) + '" loading="lazy">' + (str(ph.caption).trim() ? "<figcaption>" + esc(ph.caption) + "</figcaption>" : "") + "</figure>";
        }).join("") + "</div>"));
    }
    if (sec.reviews) {
      out.push(band("kind-words", '<div class="band-head"><h2>Kind words</h2></div><div class="reviews">' + L.reviews.map(function (r) {
        return "<blockquote>" + paras(r.text) + (str(r.name).trim() ? "<cite>" + esc(r.name) + "</cite>" : "") + "</blockquote>";
      }).join("") + "</div>"));
    }
    if (sec.hours) {
      var h = s.hours || {};
      var hoursCard = hasHours(h.days) || str(h.note).trim()
        ? '<div class="card"><h3>Hours</h3>' + (hasHours(h.days) ? '<table class="hours"><tbody>' + hourRows(h.days, pr.locale).map(function (r) {
          return "<tr" + (r.closed ? ' class="closed"' : "") + '><th scope="row">' + r.label + "</th><td>" + esc(r.text) + "</td></tr>";
        }).join("") + "</tbody></table>" : "") + (str(h.note).trim() ? paras(h.note, "muted") : "") + "</div>" : "";
      var where = str(pr.address).trim() || str(h.area).trim()
        ? '<div class="card"><h3>' + (str(pr.address).trim() ? "Where to find us" : "Where we work") + "</h3>" +
          (str(pr.address).trim() && h.showAddress !== false ? "<address>" + esc(str(pr.address).trim()).replace(/\n/g, "<br>") + "</address>" : "") +
          (str(h.area).trim() ? paras(h.area) : "") +
          (map && h.showAddress !== false ? '<p><a class="btn ghost sm" href="' + esc(map) + '" rel="noopener">Get directions</a></p>' : "") + "</div>" : "";
      out.push(band("visit", '<div class="band-head"><h2>' + (hoursCard ? "Hours and location" : "Location") + '</h2></div><div class="visit">' + hoursCard + where + "</div>"));
    }
    if (sec.faq) {
      out.push(band("questions", '<div class="band-head"><h2>Questions</h2></div><div class="faq">' + L.faq.map(function (f) {
        return "<details><summary>" + esc(f.q) + "</summary>" + paras(f.a) + "</details>";
      }).join("") + "</div>"));
    }

    var c = s.contact || {};
    var ways = [];
    if (tel) ways.push('<li><small>Call or text</small><a href="' + esc(tel) + '">' + esc(str(pr.phone).trim()) + "</a></li>");
    if (mail) ways.push('<li><small>Email</small><a href="' + esc(mail) + '">' + esc(str(pr.email).trim()) + "</a></li>");
    if (str(c.pay).trim()) ways.push("<li><small>Ways to pay</small><span>" + esc(c.pay) + "</span></li>");
    out.push('<section class="band" id="contact"><div class="wrap"><div class="contact"><div class="contact-copy"><h2>' + esc(str(c.title).trim() || "Get in touch") + "</h2>" +
      paras(str(c.text).trim() || "We'd be glad to hear from you.") +
      (tel || mail ? '<div class="acts">' + (tel ? '<a class="btn" href="' + esc(tel) + '">Call us</a>' : "") + (mail ? '<a class="btn' + (tel ? " ghost" : "") + '" href="' + esc(quoteMail || mail) + '">Send an email</a>' : "") + "</div>" : "") +
      "</div><div class=\"contact-side\">" + (ways.length ? '<ul class="ways">' + ways.join("") + "</ul>" : "") +
      (L.social.length ? '<div class="social">' + L.social.map(function (u) { return '<a href="' + esc(u) + '" rel="noopener">' + esc(socialName(u)) + "</a>"; }).join("") + "</div>" : "") +
      "</div></div></div></section>");
    out.push("</main>");
    out.push('<footer><div class="wrap"><span>&copy; ' + year + " " + esc(name) + "</span>" +
      (opts.pro ? "" : '<span>Made with <a href="https://daxtinenichols.github.io/fair-measure/">Fair Measure</a></span>') + "</div></footer>");
    out.push("</body>\n</html>\n");
    return out.join("\n");
  }

  // A fresh site, filled in from what the business has already told us.
  function starter(kindId, profile, items) {
    var k = KINDS[kindId] ? kindId : "other";
    var kind = KINDS[k];
    var days = [];
    // Hours start blank (every day closed) so we never publish hours the owner didn't set.
    for (var i = 0; i < 7; i++) days.push({ closed: true, open: "09:00", close: "17:00" });
    return {
      kind: k,
      tagline: kind.tagline,
      headline: str(profile && profile.name).trim(),
      intro: kind.intro,
      heroPhoto: null,
      offer: { show: true, title: kind.offer, itemIds: (items || []).slice(0, 8).map(function (it) { return it.id; }), showPrices: true, from: false, note: "" },
      about: { show: true, title: "About us", text: "", sign: true },
      gallery: { show: true, title: "A look at our work", photos: [] },
      reviews: { show: true, list: [] },
      hours: { show: true, days: days, note: "", area: "", showAddress: true },
      faq: { show: true, list: kind.faq.map(function (q) { return { q: q, a: "" }; }) },
      contact: { show: true, title: "Get in touch", text: "", pay: "", social: [], quoteButton: true },
      look: { palette: "parchment", type: "classic", custom: "" }
    };
  }

  function slug(name) {
    var s = str(name).toLowerCase().normalize ? str(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "") : str(name).toLowerCase();
    return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "my-business";
  }

  return {
    PALETTES: PALETTES, TYPES: TYPES, KINDS: KINDS, DAYS: DAYS,
    build: build, starter: starter, sections: sections, checklist: checklist,
    hourRows: hourRows, fmtTime: fmtTime, readableAccent: readableAccent, contrast: contrast, hexRgb: hexRgb,
    telHref: telHref, mailHref: mailHref, webHref: webHref, mapHref: mapHref, socialName: socialName, imgSrc: imgSrc,
    jsonLd: jsonLd, slug: slug, esc: esc
  };
});
