/* Relic mode tracker: adds a checkbox column to the tables under #relics and #tasks and a notes box.
   State lives in this browser's localStorage only. See docs/guide/relic-mode-player-guide.md. */
(function () {
  var KEY = "lostcityrs-relic-tracker-v1";
  var state = { relics: {}, tasks: {}, notes: "" };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && typeof s === "object") {
        state.relics = s.relics || {};
        state.tasks = s.tasks || {};
        state.notes = typeof s.notes === "string" ? s.notes : "";
      }
    } catch (e) { /* storage blocked or corrupt: start empty */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function tableAfter(id) {
    var el = document.getElementById(id);
    while (el && el.nextElementSibling) {
      el = el.nextElementSibling;
      if (el.tagName === "TABLE") return el;
      var inner = el.querySelector && el.querySelector("table"); // Material wraps tables in a scroll div
      if (inner) return inner;
      if (/^H[1-6]$/.test(el.tagName)) return null;
    }
    return null;
  }

  function setup(kind, headerLabel, noun) {
    var table = tableAfter(kind);
    var bar = document.querySelector('.relic-tracker-bar[data-for="' + kind + '"]');
    if (!table || !bar) return;
    table.classList.add("relic-table");
    var rows = Array.prototype.slice.call(table.tBodies[0].rows);
    var headRow = table.tHead.rows[0];
    var th = document.createElement("th");
    th.textContent = headerLabel;
    headRow.insertBefore(th, headRow.cells[0]);
    var tierCol = kind === "tasks" ? 1 : -1;

    var count = document.createElement("span");
    count.className = "relic-count";
    var hide = document.createElement("label");
    var hideBox = document.createElement("input");
    hideBox.type = "checkbox";
    hide.appendChild(hideBox);
    hide.appendChild(document.createTextNode(" hide ticked"));
    var reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset " + noun;
    bar.appendChild(count);
    bar.appendChild(hide);
    bar.appendChild(reset);

    var boxes = rows.map(function (tr) {
      var id = tr.cells[0].textContent.trim();
      var td = document.createElement("td");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute("aria-label", headerLabel + " " + id);
      box.checked = !!state[kind][id];
      box.addEventListener("change", function () {
        if (box.checked) state[kind][id] = 1; else delete state[kind][id];
        save();
        refresh();
      });
      td.appendChild(box);
      tr.insertBefore(td, tr.cells[0]);
      return { tr: tr, id: id, box: box, tier: tierCol >= 0 ? parseInt(tr.cells[tierCol + 1].textContent, 10) : 0 };
    });

    function currentTier() {
      // Lowest tier that still has an unticked task (same rule as relic_current_tier).
      for (var t = 1; t <= 4; t++) {
        for (var i = 0; i < boxes.length; i++) {
          if (boxes[i].tier === t && !boxes[i].box.checked) return t;
        }
      }
      return 4;
    }

    function refresh() {
      var done = boxes.filter(function (b) { return b.box.checked; }).length;
      var tier = kind === "tasks" ? currentTier() : 0;
      count.textContent = done + " / " + boxes.length + " " + noun + (kind === "tasks" ? " (current tier: " + tier + ")" : "");
      boxes.forEach(function (b) {
        b.tr.classList.toggle("relic-done", b.box.checked);
        b.tr.classList.toggle("relic-hidden", hideBox.checked && b.box.checked);
        b.tr.classList.toggle("relic-locked", kind === "tasks" && !b.box.checked && b.tier > tier);
      });
    }

    hideBox.addEventListener("change", refresh);
    reset.addEventListener("click", function () {
      if (!window.confirm("Clear every tick in the " + noun + " list?")) return;
      state[kind] = {};
      boxes.forEach(function (b) { b.box.checked = false; });
      save();
      refresh();
    });
    refresh();
  }

  function setupNotes() {
    var host = document.getElementById("relic-tracker-notes");
    if (!host) return;
    var label = document.createElement("label");
    label.textContent = "Your notes (declined relics, plans)";
    label.setAttribute("for", "relic-notes-box");
    var area = document.createElement("textarea");
    area.id = "relic-notes-box";
    area.rows = 4;
    area.value = state.notes;
    area.addEventListener("input", function () { state.notes = area.value; save(); });
    host.appendChild(label);
    host.appendChild(area);
  }

  function init() {
    if (!document.getElementById("relic-tracker-notes")) return;
    load();
    setupNotes();
    setup("relics", "Have", "relics");
    setup("tasks", "Done", "tasks");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
