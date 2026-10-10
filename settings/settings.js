/* My business: profile, Pro license, backup and restore. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, L = FM.license, esc = FM.esc;
  var CURRENCIES = [["USD", "US dollar"], ["CAD", "Canadian dollar"], ["EUR", "Euro"], ["GBP", "British pound"], ["AUD", "Australian dollar"],
    ["NZD", "New Zealand dollar"], ["MXN", "Mexican peso"], ["PHP", "Philippine peso"], ["INR", "Indian rupee"], ["ZAR", "South African rand"],
    ["NGN", "Nigerian naira"], ["KES", "Kenyan shilling"], ["PLN", "Polish zloty"], ["BRL", "Brazilian real"]];
  var NUMS = ["taxRate", "termsDays", "quoteValidDays", "nextInvoice", "nextQuote"];
  var logo = "";

  function $(id) { return document.getElementById(id); }

  function fillProfile() {
    var p = S.profile(), f = $("profile");
    f.currency.innerHTML = CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + " · " + c[1] + "</option>"; }).join("");
    Object.keys(p).forEach(function (k) { if (f[k] && f[k].type !== "file") f[k].value = p[k] == null ? "" : p[k]; });
    logo = p.logo || "";
    showLogo();
    $("look-note").textContent = L.isPro() ? "Used for the top band and headings on your documents." : "Your logo and color show on documents with Pro. You can set them up now.";
  }
  function showLogo() {
    $("logo-box").innerHTML = logo ? '<img src="' + esc(logo) + '" alt="Your logo">' : "No logo";
    $("logo-clear").hidden = !logo;
  }

  // Shrinks a picture to a sensible size so it fits comfortably in browser storage.
  function readLogo(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 5 * 1024 * 1024) return reject(new Error("That image is over 5 MB. Try a smaller one."));
      var r = new FileReader();
      r.onerror = function () { reject(new Error("We couldn't read that file.")); };
      r.onload = function () {
        if (file.type === "image/svg+xml") {
          if (r.result.length > 150000) return reject(new Error("That SVG is too large. Try a PNG instead."));
          return resolve(r.result);
        }
        var img = new Image();
        img.onerror = function () { reject(new Error("That file doesn't look like an image.")); };
        img.onload = function () {
          var scale = Math.min(1, 600 / img.width, 300 / img.height);
          var c = document.createElement("canvas");
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          var png = c.toDataURL("image/png");
          resolve(png.length < 180000 ? png : c.toDataURL("image/jpeg", 0.85));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function bindProfile() {
    var f = $("profile");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var patch = {};
      Array.prototype.forEach.call(f.elements, function (el) {
        if (!el.name) return;
        patch[el.name] = NUMS.indexOf(el.name) >= 0 ? (parseFloat(el.value) || 0) : el.value.trim();
      });
      ["nextInvoice", "nextQuote"].forEach(function (k) { patch[k] = Math.max(1, Math.round(patch[k])); });
      ["termsDays", "quoteValidDays"].forEach(function (k) { patch[k] = Math.max(0, Math.round(patch[k])); });
      patch.logo = logo;
      try { S.saveProfile(patch); $("saved-note").textContent = "Saved"; FM.toast("Your details are saved"); }
      catch (err) { FM.toast(err.message); }
      setTimeout(function () { $("saved-note").textContent = ""; }, 3000);
    });
    $("logo-file").addEventListener("change", function () {
      var file = this.files[0]; if (!file) return;
      readLogo(file).then(function (data) { logo = data; showLogo(); FM.toast("Logo ready. Save to keep it."); }, function (err) { FM.toast(err.message); });
      this.value = "";
    });
    $("logo-clear").addEventListener("click", function () { logo = ""; showLogo(); });
  }

  function renderPro() {
    var box = $("pro-body");
    if (L.isPro()) {
      box.innerHTML = '<p><span class="pill green">Active</span> Pro is unlocked on this device (key ' + esc(L.maskedKey()) + "). Thank you for supporting honest software.</p>" +
        '<p class="muted">Using another device? Enter the same key there. Need help or a refund? Write to <a href="mailto:fairmeasuresupport@gmail.com">fairmeasuresupport@gmail.com</a>.</p>' +
        '<div><button type="button" class="btn ghost small" id="pro-off">Remove the key from this device</button></div>';
      $("pro-off").addEventListener("click", function () {
        FM.confirm({ title: "Remove Pro from this device?", body: "Your data stays. You can enter the key again any time.", ok: "Remove" }).then(function (y) { if (y) { L.deactivate(); renderPro(); fillProfile(); } });
      });
      return;
    }
    var buy = L.available()
      ? '<a class="btn gold" href="' + esc(L.config.checkoutUrl) + '" rel="noopener">Get Pro for ' + esc(L.config.price) + " once</a>"
      : '<span class="pill gold">Coming soon</span>';
    box.innerHTML = "<p>One payment of " + esc(L.config.price) + " unlocks every tool, with no subscription.</p>" +
      "<ul><li>Unlimited customers, items, prices, quotes and invoices</li><li>Your logo and color on documents, without our footer line</li><li>Every new tool for two years, and it keeps working forever</li><li>30-day refund, no questions asked</li></ul>" +
      "<div>" + buy + "</div>" +
      '<form id="key-form" class="field" novalidate><span>Already bought it? Enter your license key</span>' +
      '<div class="key-row"><input name="key" autocomplete="off" spellcheck="false" placeholder="From your receipt email"><button class="btn" type="submit">Unlock Pro</button></div>' +
      '<p class="err" id="key-err" role="alert"></p></form>';
    $("key-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = this.querySelector("button"), err = $("key-err");
      btn.disabled = true; err.textContent = "";
      L.activate(this.key.value).then(function () { FM.toast("Pro is unlocked. Thank you!"); renderPro(); fillProfile(); },
        function (x) { err.textContent = x.message; btn.disabled = false; });
    });
  }

  function renderBackup() {
    var last = FM.backup.last();
    $("last-backup").textContent = last ? "Last backup from this device: " + new Date(last).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) + "." : "You haven't downloaded a backup from this device yet.";
  }

  function bindBackup() {
    $("do-backup").addEventListener("click", function () { FM.backup.download(); renderBackup(); FM.toast("Backup downloaded"); });
    $("restore-file").addEventListener("change", function () {
      var file = this.files[0]; this.value = "";
      if (!file) return;
      var r = new FileReader();
      r.onload = function () {
        var data;
        try { data = JSON.parse(r.result); } catch (e) { FM.toast("That file isn't a Fair Measure backup."); return; }
        var counts = S.collections.map(function (c) { return (Array.isArray(data[c]) ? data[c].length : 0) + " " + c; }).join(", ");
        FM.confirm({
          title: "Restore this backup?",
          body: "It holds " + counts + ". Combine keeps what's on this device and adds anything newer from the file. Replace makes this device match the file exactly.",
          ok: "Combine", cancel: "Replace instead"
        }).then(function (merge) {
          var go = merge ? Promise.resolve(true) : FM.confirm({ title: "Replace everything on this device?", body: "Records on this device that aren't in the file will be removed.", ok: "Replace", danger: true });
          return go.then(function (yes) {
            if (!yes) return;
            try { S.importAll(data, merge ? "merge" : "replace"); FM.toast("Backup restored"); fillProfile(); }
            catch (e) { FM.toast(e.message); }
          });
        });
      };
      r.readAsText(file);
    });
    $("erase").addEventListener("click", function () {
      FM.confirm({ title: "Erase everything?", body: "Every customer, item, quote, invoice and your details will be removed from this device. This can't be undone.", ok: "Erase everything", danger: true })
        .then(function (y) { if (y) { S.eraseAll(); fillProfile(); renderPro(); renderBackup(); FM.toast("Everything was erased"); } });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fillProfile(); bindProfile(); renderPro(); renderBackup(); bindBackup();
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  });
})();
