/* Fair Measure site chrome: shared header, footer, tool list, toast and confirm dialog.
   Every page loads this first. Links are built from the site root so the site works
   both at /fair-measure/ on github.io and at the root of a custom domain. */
(function () {
  "use strict";
  var FM = (window.FM = window.FM || {});
  var script = document.currentScript;
  FM.contact = "fairmeasuresupport@gmail.com";
  FM.root = script ? script.src.replace(/shared\/chrome\.js(\?.*)?$/, "") : "/";

  // The one list of tools. The home page, the header menu and the footer all read it.
  FM.tools = [
    { id: "invoices", name: "Quotes & Invoices", path: "invoices/", status: "live",
      blurb: "Clean quotes and invoices in minutes. Saved customers and items, tax, deposits, and a printout you'll be proud to send." },
    { id: "pricing", name: "Price Builder", path: "pricing/", status: "live",
      blurb: "Cost out a product or a job, pay yourself a fair wage, and see the price that keeps your doors open." },
    { id: "customers", name: "Customer Book", path: "customers/", status: "live",
      blurb: "Every customer, note and follow-up in one quiet place, filled in automatically from your quotes and invoices." },
    { id: "cash", name: "Cash Book", path: "cash/", status: "live",
      blurb: "Money in, money out, miles driven, and how much to set aside for quarterly taxes." },
    { id: "shifts", name: "Shift Planner", path: "shifts/", status: "live",
      blurb: "A simple staff schedule with swaps and sick-day cover, without per-person fees." },
    { id: "shopfront", name: "Shopfront Studio", path: "shopfront/", status: "live",
      blurb: "A warm, simple website for your business, built from the details you've already entered." },
    { id: "time", name: "Time Book", path: "time/", status: "live",
      blurb: "Start the clock, log your hours by customer and job, and turn them into an invoice in one step." }
  ];

  FM.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  FM.logo = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#e5ebf2"/>' +
    '<path d="M20 9v21M13 30.5h14" stroke="#2e4560" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M9 14.5h22" stroke="#2e4560" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="20" cy="9" r="2" fill="#9c7630"/>' +
    '<path d="M9 15l-4 8h8z M31 15l-4 8h8z" fill="none" stroke="#9c7630" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M5 23a4 2.2 0 0 0 8 0M27 23a4 2.2 0 0 0 8 0" fill="#f5ead0" stroke="#9c7630" stroke-width="1.8"/></svg>';

  function link(path) { return FM.root + path; }
  FM.link = link;

  function header(current) {
    var nav = [
      ["", "Home", "home"],
      ["invoices/", "Quotes & Invoices", "invoices"],
      ["pricing/", "Price Builder", "pricing"],
      ["#tools", "All tools", "tools"],
      ["settings/", "My business", "settings"]
    ];
    var items = nav.map(function (n) {
      var href = n[0].charAt(0) === "#" ? link("") + n[0] : link(n[0]);
      var cur = n[2] === current ? ' aria-current="page"' : "";
      return '<a href="' + href + '"' + cur + ">" + n[1] + "</a>";
    }).join("");
    return '<div class="wrap">' +
      '<a class="fm-brand" href="' + link("") + '">' + FM.logo +
      '<span><b>Fair Measure</b><small>Honest tools for small business</small></span></a>' +
      '<button class="fm-menu-btn" type="button" aria-expanded="false" aria-controls="fm-nav" aria-label="Menu">' +
      '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
      '<nav class="fm-nav" id="fm-nav" aria-label="Main">' + items + "</nav></div>";
  }

  function footer() {
    var tools = FM.tools.map(function (t) {
      return t.status === "live"
        ? '<li><a href="' + link(t.path) + '">' + FM.esc(t.name) + "</a></li>"
        : "<li>" + FM.esc(t.name) + ' <span class="pill">Soon</span></li>';
    }).join("");
    var year = new Date().getFullYear();
    return '<div class="wrap">' +
      '<div><a class="fm-brand" href="' + link("") + '">' + FM.logo + "<span><b>Fair Measure</b></span></a>" +
      '<p class="verse">"A false balance is an abomination to the Lord, but a just weight is his delight." Proverbs 11:1</p></div>' +
      "<div><h4>Tools</h4><ul>" + tools + "</ul></div>" +
      "<div><h4>About</h4><ul>" +
      '<li><a href="' + link("about/") + '">Who we are</a></li>' +
      '<li><a href="' + link("#pricing") + '">Pricing</a></li>' +
      '<li><a href="' + link("privacy/") + '">Privacy</a></li>' +
      '<li><a href="' + link("terms/") + '">Terms of sale</a></li>' +
      '<li><a href="' + link("refunds/") + '">Refunds</a></li>' +
      '<li><a href="mailto:' + FM.contact + '">' + FM.contact + "</a></li>" +
      "</ul></div>" +
      '<p class="legal">&copy; ' + year + " Fair Measure. Your business data stays in your browser on your device. " +
      "Our tools help with paperwork and arithmetic; they are not legal, tax or accounting advice.</p></div>";
  }

  FM.toast = function (msg) {
    var t = document.querySelector(".fm-toast");
    if (!t) { t = document.createElement("div"); t.className = "fm-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(FM._toastTimer);
    FM._toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  };

  // A promise-based confirm built on <dialog>, so we never use the browser's grey box.
  FM.confirm = function (opts) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog");
      d.className = "fm-dialog";
      d.innerHTML = '<form method="dialog" class="dlg-body"><h3>' + FM.esc(opts.title) + "</h3>" +
        (opts.body ? '<p class="muted">' + FM.esc(opts.body) + "</p>" : "") +
        '<div class="dlg-actions"><button class="btn ghost" value="no">' + FM.esc(opts.cancel || "Keep it") + "</button>" +
        '<button class="btn ' + (opts.danger ? "danger" : "") + '" value="yes">' + FM.esc(opts.ok || "Yes") + "</button></div></form>";
      document.body.appendChild(d);
      d.addEventListener("close", function () { resolve(d.returnValue === "yes"); d.remove(); });
      d.showModal();
    });
  };

  FM.mountChrome = function (current) {
    var top = document.getElementById("fm-top");
    if (top) {
      top.className = "fm-top no-print";
      top.innerHTML = header(current);
      var btn = top.querySelector(".fm-menu-btn"), nav = top.querySelector(".fm-nav");
      btn.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(open));
      });
      nav.addEventListener("click", function (e) { if (e.target.tagName === "A") { nav.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); } });
    }
    var foot = document.getElementById("fm-foot");
    if (foot) { foot.className = "fm-foot no-print"; foot.innerHTML = footer(); }
  };

  document.addEventListener("DOMContentLoaded", function () {
    FM.mountChrome(document.body.getAttribute("data-page") || "");
    // Skip links move focus without touching the address hash, which some tools use for routing.
    var skip = document.querySelector(".skip");
    if (skip) skip.addEventListener("click", function (e) {
      var target = document.getElementById(skip.getAttribute("href").slice(1));
      if (!target) return;
      e.preventDefault();
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus();
    });
  });
})();
