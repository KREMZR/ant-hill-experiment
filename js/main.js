/* The page: main loop, saving, pointer and keyboard input, readouts. */
(function () {
  'use strict';
  var AH = window.AH, C = AH.CONFIG, S = AH.STATE, CARRY = AH.CARRY;
  var $ = function (id) { return document.getElementById(id); };

  var canvas = $('view');
  var renderer = new AH.Renderer(canvas);
  var sim = null, running = false, busy = false, last = 0, frameNo = 0;
  var paused = false, speed = 1, tool = 'look';
  var seed = C.seed;
  var options = { workers: C.colony.workers, trailLifetime: C.trail.lifetime, naturalFood: true };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- starting, restoring and saving ---------- */

  var MAX_CATCH_UP = 6 * 3600;   // the most time away, in seconds, the colony will live through
  var HINT = 'Scroll to zoom, drag to move. Click an ant to see what it is doing.';

  function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  var tabId = newId();

  /*
   * Several tabs can have this page open, but there is one saved colony. The
   * tab in use owns the save. The others leave it alone until they are used
   * again, or until the owner has gone quiet (closed, or hidden and frozen).
   */
  var OWNER_KEY = 'ant-hill-owner', OWNER_QUIET = 12000;
  function isOwner() {
    try {
      var o = JSON.parse(localStorage.getItem(OWNER_KEY) || 'null');
      if (!o || o.id === tabId) return true;
      if (Date.now() - o.at > OWNER_QUIET) { claim(); return true; }
      return false;
    } catch (e) { return true; }   // nothing to coordinate through: behave as the only tab
  }
  function claim() {
    try { localStorage.setItem(OWNER_KEY, JSON.stringify({ id: tabId, at: Date.now() })); } catch (e) { /* see isOwner */ }
  }

  function showLoading(text) {
    $('loading-text').textContent = text;
    $('loading-bar').hidden = true; $('loading-skip').hidden = true;
    $('loading').hidden = false;
  }

  /* Puts a simulation on screen. */
  function show(s) {
    sim = s;
    renderer.setSim(sim);
    renderer.resize();
    renderer.cam.z = clamp(Math.min(renderer.cssW / 470, renderer.cssH / 350), 2.2, 5);
    renderer.clampCam();
    closeInspector();
    setTool('look');
    updateReadout();
    window.AH_APP = { sim: sim, renderer: renderer };
  }

  function go() {
    $('loading').hidden = true;
    busy = false;
    last = performance.now();
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  /* replace: write this colony over whatever is saved (only when a new colony was asked for). */
  function startNew(firstRun, replace) {
    busy = true;
    showLoading('Laying out the ground');
    setTimeout(function () {
      var s = new AH.Sim({
        seed: seed, workers: options.workers,
        trailLifetime: options.trailLifetime, naturalFood: options.naturalFood
      });
      s.colonyId = newId();
      show(s);
      claim();
      go();
      save(false, replace);
      if (firstRun) toast(HINT, 6000);
    }, 30);
  }

  /* Switches this tab to a saved colony. Returns false if the snapshot cannot be used. */
  function adopt(snap) {
    var s = null;
    try { s = AH.Save.restore(snap); } catch (e) { s = null; }
    if (!s) return false;
    seed = snap.seed;
    options = { workers: snap.workers0, trailLifetime: snap.trailLifetime, naturalFood: snap.naturalFood };
    show(s);
    var ui = snap.ui || {};
    if (ui.cam) { renderer.cam.x = ui.cam.x; renderer.cam.y = ui.cam.y; renderer.cam.z = ui.cam.z; renderer.clampCam(); }
    if (ui.speed) setSpeed(ui.speed);
    setTrailView(!!ui.showTrail);
    claim();
    if (ui.paused) {
      setPaused(true);
      go();
      toast('Picked up where you left off. The colony is still paused.', 5000);
      return true;
    }
    var away = (Date.now() - snap.savedAt) / 1000;
    liveThrough(away, function (lived) {
      go();
      save();
      var msg = 'Picked up where you left off.';
      if (away > MAX_CATCH_UP && lived >= MAX_CATCH_UP - 1) msg = 'You were away longer than the colony can catch up on, so it lived through ' + fmtAway(lived) + ' of it.';
      else if (lived >= 60) msg = 'While you were away the colony lived through ' + fmtAway(lived) + '.';
      toast(msg, 7000);
    });
    return true;
  }

  /*
   * Brings back the saved colony: when the page opens, and when this tab finds
   * that the save holds a different colony from the one it is running.
   */
  function restoreSaved(opening) {
    busy = true;
    if (!opening) showLoading('Bringing the colony over from your other tab');
    AH.Save.load(function (snap, ok) {
      if (snap && adopt(snap)) return;
      // Opening with nothing usable: start a colony. An old save that cannot be
      // read any more is replaced; a save that could not be reached is left alone.
      if (opening) startNew(true, ok && !!snap);
      else go();
    });
  }

  function fmtAway(sec) {
    var m = Math.round(sec / 60), h = Math.floor(m / 60);
    if (m < 1) return Math.round(sec) + ' seconds';
    if (h < 1) return m + ' min';
    return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }

  /*
   * The colony keeps living while nobody watches: run the simulation through
   * the time away, in short bursts so the page stays responsive.
   */
  function liveThrough(seconds, done) {
    var total = Math.min(Math.max(0, seconds), MAX_CATCH_UP), left = total;
    if (total < 5) { done(0); return; }
    var stop = false, began = performance.now(), shown = total > 240;
    busy = true;
    if (shown) {
      showLoading('The colony carried on without you. Catching up on ' + fmtAway(total) + '.');
      $('loading-bar').hidden = false; $('loading-skip').hidden = false;
      $('loading-fill').style.width = '0%';
      $('loading-skip').onclick = function () { stop = true; };
    }
    (function burst() {
      var t0 = performance.now();
      while (left > 1e-6 && performance.now() - t0 < 40) {
        var dt = Math.min(0.1, left);
        sim.step(dt);
        left -= dt;
      }
      if (shown) $('loading-fill').style.width = Math.round((1 - left / total) * 100) + '%';
      // give up after 45 seconds of work, so a huge colony never holds the page up for long
      if (left > 1e-6 && !stop && performance.now() - began < 45000) setTimeout(burst, 0);
      else done(total - left);
    })();
  }

  /*
   * A hidden tab is frozen, so it is saved once as it is hidden and not again:
   * the save's timestamp then marks when the colony last actually ran.
   */
  function save(evenIfHidden, replace) {
    if (!sim || busy || !isOwner()) return;
    if (document.hidden && evenIfHidden !== true) return;
    claim();   // doubles as a sign of life for the other tabs
    var snap = AH.Save.snapshot(sim), cam = renderer.cam;
    snap.writer = tabId;
    snap.ui = { cam: { x: cam.x, y: cam.y, z: cam.z }, speed: speed, paused: paused, showTrail: renderer.showTrail };
    AH.Save.store(snap, replace === true, function (result) {
      // The save holds a different colony: this one was only started because
      // the save could not be read at the time. Go back to the saved one.
      if (result === 'other-colony' && !busy) restoreSaved(false);
    });
  }

  setInterval(function () { save(); }, 5000);
  window.addEventListener('pagehide', function () { save(); });
  document.addEventListener('pointerdown', claim, true);   // using a tab makes it the one that saves

  // a hidden tab stops drawing, so the colony catches up when the tab is shown again
  var hiddenAt = 0, hiddenSimTime = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = Date.now(); hiddenSimTime = sim ? sim.time : 0;
      save(true);
      return;
    }
    var since = hiddenAt;
    hiddenAt = 0;
    if (!sim || busy) return;
    busy = true;   // hold the loop while checking what was saved in the meantime
    AH.Save.load(function (snap) {
      // another tab took the colony further, or started a new one: follow it
      if (snap && snap.writer !== tabId && (snap.colonyId !== sim.colonyId || snap.time > sim.time + 1)) {
        showLoading('Bringing the colony over from your other tab');
        if (adopt(snap)) return;
      }
      claim();
      if (!since || paused) { go(); return; }
      liveThrough((Date.now() - since) / 1000 - (sim.time - hiddenSimTime), function (lived) {
        go();
        if (lived >= 60) toast('While this tab was hidden the colony lived through ' + fmtAway(lived) + '.', 5000);
      });
    });
  });

  /* ---------- main loop ---------- */

  function frame(now) {
    if (busy) { last = now; requestAnimationFrame(frame); return; }   // catching up or rebuilding
    var dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && sim) {
      var want = dtReal * speed, maxStep = speed <= 1 ? 0.05 : 0.1, t0 = performance.now();
      while (want > 1e-4) {
        var dt = Math.min(maxStep, want);
        sim.step(dt);
        want -= dt;
        if (performance.now() - t0 > 13) break;   // keep the picture smooth; run a little slow instead
      }
    }
    renderer.draw(dtReal, paused ? 0 : Math.min(speed, 2));
    if (++frameNo % 8 === 0) { updateReadout(); updateInspector(); }
    requestAnimationFrame(frame);
  }

  /* ---------- readouts ---------- */

  function fmtClock(t) {
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateReadout() {
    if (!sim) return;
    var col = sim.colony;
    $('c-workers').textContent = col.workers.toLocaleString();
    $('c-out').textContent = col.outside.toLocaleString();
    $('c-delivered').textContent = col.delivered.toLocaleString();
    $('c-brood').textContent = (col.brood.length - col.broodHead).toLocaleString();
    $('c-day').textContent = 'day ' + (Math.floor(col.days) + 1);
    var r = 1 - col.hunger;
    $('c-reserve-fill').style.width = Math.round(r * 100) + '%';
    $('c-reserve-text').textContent = r < 0.2 ? 'hungry' : r < 0.55 ? 'getting by' : r < 0.85 ? 'well fed' : 'full';
    $('clock').textContent = fmtClock(sim.time);
  }

  function describe(i) {
    var col = sim.colony, st = col.state[i], c = col.carry[i];
    var alarmed = col.agit[i] > 0 ? 'Alarmed. ' : '';
    switch (st) {
      case S.IN_NEST:
        if (col.idlePos[i] >= 0) return 'Inside the nest, waiting for a reason to go out.';
        return col.memQ[i] > 0 && col.memFails[i] === 0
          ? 'Inside the nest, sharing out what it brought back.'
          : 'Inside the nest, resting after a trip that found nothing.';
      case S.EMERGE: return 'Climbing out of the nest.';
      case S.SCOUT: return alarmed + 'Scouting. With no trail to follow it wanders, keeping track of the way home.';
      case S.FOLLOW:
        return alarmed + (col.lost[i] > 0.6 ? 'It has lost the trail and is casting about for it.' : 'Following a pheromone trail away from the nest.');
      case S.TO_FOOD: return alarmed + 'Heading back to food it remembers.';
      case S.SEARCH_FOOD: return alarmed + 'Searching the spot where it expected food.';
      case S.APPROACH: return 'Closing in on food.';
      case S.FEED: return col.ftype[i] === 1 ? 'Drinking sugar water.' : 'Getting a grip on a crumb.';
      case S.RETURN:
        if (c === CARRY.SUGAR || c === CARRY.CRUMB) {
          return alarmed + (col.lay[i] > 0 ? 'Carrying food home and marking a trail as it goes.' : 'Carrying food home without marking a trail.');
        }
        return alarmed + (col.temp[i] ? 'Heading back inside.' : 'Heading home with nothing.');
      case S.SEARCH_NEST: return 'By its own reckoning it should be home. Searching for the entrance.';
      case S.ENTER: return 'Going down into the nest.';
      case S.DUMP:
        return c === CARRY.SOIL ? 'Carrying a grain of soil out to the mound.' : 'Carrying a dead nestmate to the refuse pile.';
    }
    return '';
  }

  function updateInspector() {
    var i = renderer.selected(), box = $('inspector');
    if (i < 0) { if (!box.hidden) closeInspector(); return; }
    var col = sim.colony, st = col.state[i], c = col.carry[i];
    $('i-name').textContent = (col.temp[i] ? 'Nest worker ' : 'Forager ') + col.uid[i];
    $('i-doing').textContent = describe(i);
    var load = Math.round(Math.min(1, col.load[i]) * 100), carry;
    if (st === S.FEED && col.ftype[i] === 1) carry = 'drinking, crop ' + load + '% full';
    else if (c === CARRY.SUGAR) carry = 'sugar water, crop ' + load + '% full';
    else if (c === CARRY.CRUMB) carry = 'a crumb';
    else if (c === CARRY.SOIL) carry = 'a grain of soil';
    else if (c === CARRY.CORPSE) carry = 'a dead nestmate';
    else carry = 'nothing';
    $('i-carry').textContent = carry;
    $('i-trips').textContent = col.trips[i];
    var inside = st === S.IN_NEST;
    $('i-speed').textContent = inside ? 'inside' : Math.round(col.v[i]) + ' mm/s';
    var dx = col.x[i] - col.nx, dy = col.y[i] - col.ny;
    $('i-dist').textContent = inside ? 'inside' : Math.round(Math.hypot(dx, dy)) + ' mm';
    $('i-err').textContent = inside ? 'inside' : Math.round(Math.hypot(col.pix[i] - dx, col.piy[i] - dy)) + ' mm';
    $('i-mem').textContent = col.memQ[i] > 0 ? Math.round(Math.hypot(col.memX[i], col.memY[i])) + ' mm out' : 'none';
    var bar = function (id, v) { $(id).style.setProperty('--v', (inside ? 0 : Math.round(v / (v + 1.5) * 100)) + '%'); };
    bar('i-sl', col.sL[i]); bar('i-sc', col.sC[i]); bar('i-sr', col.sR[i]);
  }

  function openInspector(i) {
    renderer.selUid = sim.colony.uid[i]; renderer.selIndex = i;
    $('inspector').hidden = false;
    updateInspector();
  }

  function closeInspector() {
    renderer.selUid = 0; renderer.selIndex = -1; renderer.follow = false;
    $('inspector').hidden = true;
    $('i-follow').setAttribute('aria-pressed', 'false');
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  /* ---------- tools ---------- */

  function setTool(name) {
    tool = name;
    document.querySelectorAll('.tool').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.tool === name ? 'true' : 'false');
    });
    canvas.classList.toggle('placing', name !== 'look');
  }

  function click(px, py) {
    if (!sim) return;
    var w = renderer.screenToWorld(px, py), i;
    switch (tool) {
      case 'look':
        i = renderer.pickAnt(px, py);
        if (i >= 0) openInspector(i); else closeInspector();
        break;
      case 'sugar':
        if (!sim.addSugar(w.x, w.y, 200, 0.9)) toast('Not there. Pick open ground away from the mound and rocks.');
        break;
      case 'crumbs':
        if (!sim.addCrumbs(w.x, w.y, 80)) toast('Not there. Pick open ground away from the mound and rocks.');
        break;
      case 'rock':
        if (!sim.addRock(w.x, w.y, sim.rng.range(14, 32))) toast('No room for a rock there.');
        break;
      case 'remove':
        if (!sim.eraseAt(w.x, w.y)) toast('Nothing to remove there. Click a rock or some food.');
        break;
      case 'disturb':
        sim.poke(w.x, w.y);
        renderer.ripples.push({ x: w.x, y: w.y, t: 0 });
        break;
    }
  }

  function setPaused(p) {
    paused = p;
    var b = $('btn-pause');
    b.classList.toggle('paused', p);
    b.setAttribute('aria-label', p ? 'Resume' : 'Pause');
  }

  function setSpeed(v) {
    speed = v;
    document.querySelectorAll('#speeds button').forEach(function (b) {
      b.setAttribute('aria-pressed', +b.dataset.speed === v ? 'true' : 'false');
    });
    if (paused) setPaused(false);
  }

  function setTrailView(on) {
    renderer.showTrail = on;
    $('btn-trail').setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ---------- pointer: drag to pan, pinch or wheel to zoom, click to use the tool ---------- */

  var pointers = new Map(), drag = null, pinch = null;

  function pinchState() {
    var p = Array.from(pointers.values());
    return {
      cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2,
      d: Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y))
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    else if (pointers.size === 2) { drag = null; pinch = pinchState(); }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var cam = renderer.cam;
    if (pinch && pointers.size === 2) {
      var p = pinchState();
      renderer.zoomAt(p.cx, p.cy, p.d / pinch.d);
      cam.x -= (p.cx - pinch.cx) / cam.z; cam.y -= (p.cy - pinch.cy) / cam.z;
      renderer.clampCam();
      pinch = p;
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
      drag.moved = true;
      canvas.classList.add('dragging');
      if (renderer.follow) { renderer.follow = false; $('i-follow').setAttribute('aria-pressed', 'false'); }
    }
    if (drag.moved) {
      cam.x -= (e.clientX - drag.x) / cam.z; cam.y -= (e.clientY - drag.y) / cam.z;
      renderer.clampCam();
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });

  function pointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (drag && !drag.moved && e.type === 'pointerup') { click(e.clientX, e.clientY); if (tool !== 'look') save(); }
    drag = null;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
  }, { passive: false });

  window.addEventListener('resize', function () { if (sim) renderer.resize(); });

  /* ---------- buttons and keys ---------- */

  document.querySelectorAll('.tool').forEach(function (b) {
    b.addEventListener('click', function () { setTool(b.dataset.tool); });
  });
  document.querySelectorAll('#speeds button').forEach(function (b) {
    b.addEventListener('click', function () { setSpeed(+b.dataset.speed); });
  });
  $('btn-pause').addEventListener('click', function () { setPaused(!paused); });
  $('btn-trail').addEventListener('click', function () { setTrailView(!renderer.showTrail); });
  $('btn-about').addEventListener('click', function () { $('about').showModal(); });
  $('btn-new').addEventListener('click', function () { $('newcolony').showModal(); });
  $('c-fold').addEventListener('click', function () {
    var folded = document.querySelector('.colony').classList.toggle('folded');
    this.setAttribute('aria-expanded', folded ? 'false' : 'true');
    this.setAttribute('aria-label', folded ? 'Show the colony numbers' : 'Hide the colony numbers');
  });
  $('i-close').addEventListener('click', closeInspector);
  $('i-follow').addEventListener('click', function () {
    renderer.follow = !renderer.follow;
    this.setAttribute('aria-pressed', renderer.follow ? 'true' : 'false');
    if (renderer.follow && renderer.cam.z < 6) renderer.cam.z = 9;
  });
  $('i-sense').addEventListener('click', function () {
    renderer.showSense = !renderer.showSense;
    this.setAttribute('aria-pressed', renderer.showSense ? 'true' : 'false');
  });

  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); d.close(); });
    });
  });

  $('new-form').addEventListener('submit', function () {
    options.workers = +$('n-size').value;
    options.trailLifetime = +$('n-life').value;
    options.naturalFood = $('n-natural').checked;
    if (!$('n-same').checked) seed = 1 + Math.floor(Math.random() * 99999);
    setTrailView(false);
    startNew(false, true);
  });

  var TOOL_KEYS = { '1': 'look', '2': 'sugar', '3': 'crumbs', '4': 'rock', '5': 'remove', '6': 'disturb' };
  window.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === ' ') { e.preventDefault(); setPaused(!paused); }
    else if (k === 'p' || k === 'P') setTrailView(!renderer.showTrail);
    else if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    else if (k === 'Escape') { if (tool !== 'look') setTool('look'); else closeInspector(); }
    else if (k === '+' || k === '=') renderer.zoomAt(renderer.cssW / 2, renderer.cssH / 2, 1.3);
    else if (k === '-' || k === '_') renderer.zoomAt(renderer.cssW / 2, renderer.cssH / 2, 1 / 1.3);
    else if ((k === 'f' || k === 'F') && renderer.selUid) $('i-follow').click();
  });

  restoreSaved(true);
})();
