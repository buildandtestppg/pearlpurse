// Renders the published builds table from /releases.json (CSP: external same-origin script).
fetch('/releases.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(function (rs) {
    var t = document.getElementById('builds');
    rs.slice(-5).reverse().forEach(function (r) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.textContent = r.version;
      var td2 = document.createElement('td'); td2.className = 'mono'; td2.textContent = r.bundle;
      var td3 = document.createElement('td'); td3.className = 'mono'; td3.title = 'click to copy'; td3.style.cursor = 'pointer';
      td3.textContent = r.sha256.slice(0, 24) + '…';
      td3.onclick = function () { navigator.clipboard.writeText(r.sha256); };
      var td4 = document.createElement('td'); td4.className = 'mono'; td4.textContent = r.tag || r.commit || '—';
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      t.appendChild(tr);
    });
  })
  .catch(function (e) {
    var t = document.getElementById('builds');
    var tr = document.createElement('tr');
    var td = document.createElement('td'); td.colSpan = 3;
    td.textContent = 'Could not load releases.json — check github.com/buildandtestppg/pearlpurse/releases.json (' + e.message + ')';
    tr.appendChild(td); t.appendChild(tr);
  });
