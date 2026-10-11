/* Home page: tool cards from the shared list, and the Pro button state. */
(function () {
  "use strict";
  var FM = window.FM;
  var icons = {
    invoices: '<path d="M9 4h10l4 4v20H9z"/><path d="M19 4v4h4M13 14h6M13 18h6M13 22h4"/>',
    pricing: '<path d="M16 5v22M7 10h18"/><path d="M7 10l-3 7h6zM25 10l-3 7h6z"/><path d="M11 27h10"/>',
    customers: '<circle cx="16" cy="12" r="5"/><path d="M7 27c1-5 4.5-7.5 9-7.5s8 2.5 9 7.5"/>',
    cash: '<rect x="5" y="9" width="22" height="15" rx="3"/><circle cx="16" cy="16.5" r="3.5"/><path d="M9 13v7M23 13v7"/>',
    shifts: '<rect x="5" y="7" width="22" height="20" rx="3"/><path d="M5 13h22M11 4v5M21 4v5M10 18h4M10 22h4M18 18h4"/>',
    shopfront: '<path d="M5 13l2-7h18l2 7"/><path d="M5 13c0 2 1.5 3.5 3.7 3.5S12.3 15 12.3 13c0 2 1.6 3.5 3.7 3.5s3.7-1.5 3.7-3.5c0 2 1.5 3.5 3.6 3.5S27 15 27 13"/><path d="M7 16.5V27h18V16.5M13 27v-6h6v6"/>',
    time: '<circle cx="16" cy="17.5" r="9.5"/><path d="M16 12v5.5l3.5 2.5M13 4.5h6M16 4.5v3.5"/>'
  };
  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.getElementById("tool-grid");
    grid.innerHTML = FM.tools.map(function (t) {
      var live = t.status === "live";
      var tag = live ? "a" : "div";
      return "<" + tag + ' class="tool' + (live ? " live" : "") + '"' + (live ? ' href="' + FM.link(t.path) + '"' : "") + ">" +
        '<span class="tool-icon"><svg viewBox="0 0 32 32" aria-hidden="true">' + (icons[t.id] || "") + "</svg></span>" +
        "<h3>" + FM.esc(t.name) + "</h3><p>" + FM.esc(t.blurb) + "</p>" +
        (live ? '<span class="tool-go">Open it <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>' : '<span class="pill">Coming soon</span>') +
        "</" + tag + ">";
    }).join("");

    var L = FM.license;
    document.getElementById("pro-price").textContent = L.config.price;
    var buy = document.getElementById("buy-pro"), note = document.getElementById("buy-note");
    if (L.isPro()) {
      buy.textContent = "You have Pro. Thank you!";
      buy.href = FM.link("settings/#pro");
    } else if (L.available()) {
      buy.href = L.config.checkoutUrl;
      buy.rel = "noopener";
      note.textContent = "Checkout is handled by our payment partner, who emails your license key.";
    } else {
      buy.textContent = "Pro is coming soon";
      buy.removeAttribute("href");
      buy.setAttribute("aria-disabled", "true");
      buy.classList.add("is-off");
      note.textContent = "Everything in Free works today. Pro opens shortly.";
    }
  });
})();
