// Home page behaviour (CSP: external same-origin script).
// 1) Returning users (vault present) skip marketing → straight into the wallet.
//    Append ?stay to browse the home page anyway.
// 2) Live network stats from the same-origin relay.
(function () {
  try {
    var vault = null;
    for (var i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i).indexOf("pearlpurse") === 0) { vault = true; break; }
    }
    if (vault && !/[?&]stay/.test(location.search)) {
      // preserve payment URIs (web+pearl handler lands here with ?uri=) through the jump
      var q = /[?&]uri=/.test(location.search) ? location.search : "";
      location.replace("/app" + q);
      return;
    }
  } catch (e) { /* storage blocked — show marketing */ }

  var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  fetch("/api/prlstats/api/difficulty").then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (m) {
      if (m.prl_price_usd) document.getElementById("st-price").textContent = "$" + m.prl_price_usd.toFixed(2);
      var df = parseFloat(m.current_difficulty);
      if (df > 0 && (document.getElementById("st-diff").textContent === "—")) {
        document.getElementById("st-diff").textContent = df >= 1e6 ? (df / 1e6).toFixed(1) + "M" : df >= 1e3 ? (df / 1e3).toFixed(1) + "k" : String(Math.round(df));
      }
      var hv = parseFloat(m.current_hashrate_hs);
      if (hv > 0) {
        document.getElementById("st-hash").textContent = hv >= 1e18 ? (hv / 1e18).toFixed(1) + " EH/s" : hv >= 1e15 ? (hv / 1e15).toFixed(1) + " PH/s" : hv >= 1e12 ? (hv / 1e12).toFixed(1) + " TH/s" : "—";
      }
    })
    .catch(function () {});
  fetch("/api/v2/").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (j) {
      var b = j.blockbook || {};
      if (!b.bestHeight) throw new Error("no data");
      set("st-block", Number(b.bestHeight).toLocaleString());
      set("st-mempool", b.mempoolSize != null ? b.mempoolSize : "—");
      if (b.difficulty) { var df = parseFloat(b.difficulty); set("st-diff", df >= 1e6 ? (df / 1e6).toFixed(1) + "M" : df >= 1e3 ? (df / 1e3).toFixed(1) + "k" : String(Math.round(df))); }
      set("st-status", (b.inSync && b.inSyncMempool ? "Pearl mainnet · synced" : "Pearl mainnet · syncing…") +
        (b.lastBlockTime ? " · latest block " + b.lastBlockTime.slice(11, 16) + " UTC" : ""));
      return fetch("/api/v1/estimatefee/5");
    })
    .then(function (r) { if (!r.ok) throw new Error("fee http"); return r.json(); })
    .then(function (j) {
      var f = parseFloat(j.result);
      if (f > 0) {
        var t = f >= 1 ? f.toFixed(2) : f.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
        set("st-fee", t + " PRL");
      }
    })
    .catch(function () { set("st-status", "network status unavailable — wallet still works"); });
})();
