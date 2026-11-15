/*
 * Saving the colony in this browser, so it is still there after the page is
 * closed. The whole state goes into IndexedDB: every ant, the pheromone
 * field, the food, the rocks and the colony's stores.
 */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};
  var VERSION = 2;   // bump when the saved shape changes; older saves are then discarded

  var ARRAYS = [
    'x', 'y', 'th', 'v', 'om', 'wn', 'timer', 'pause', 'tripT', 'tripMax', 'lost', 'progD', 'progT',
    'wallT', 'agit', 'contactCd', 'stuck', 'pix', 'piy', 'piC', 'piS', 'memX', 'memY', 'memQ',
    'badX', 'badY', 'badUntil', 'lay', 'layAcc', 'load', 'carryQ', 'drink', 'tgx', 'tgy', 'size', 'spd',
    'anim', 'odo', 'look', 'lookT', 'marking', 'sL', 'sC', 'sR', 'born',
    'state', 'nextState', 'carry', 'temp', 'alive', 'memFails', 'ftype', 'wall', 'tgt', 'tbit', 'uid', 'trips'
  ];
  var SCALARS = [
    'workers', 'days', 't', 'store', 'hunger', 'excite', 'eggAcc', 'deathAcc', 'soilAcc', 'recAcc',
    'scoutAcc', 'foragerAcc', 'corpseQueue', 'corpseCd', 'delivered', 'deliveredSugar', 'deliveredCrumbs',
    'bornTotal', 'diedTotal', 'nRecruited', 'nFollowFound', 'nScoutFound', 'nMemoryFound', 'uidSeq', 'count',
    'outside'
  ];

  function snapshot(sim) {
    var W = sim.world, col = sim.colony, n = col.count, i, k;
    var arrays = {}, scalars = {};
    for (i = 0; i < ARRAYS.length; i++) { k = ARRAYS[i]; arrays[k] = col[k].slice(0, n); }
    for (i = 0; i < SCALARS.length; i++) { k = SCALARS[i]; scalars[k] = col[k]; }
    // only the rows of the pheromone grid that hold anything
    var has = W.ty1 >= W.ty0, y0 = has ? W.ty0 : 0, y1 = has ? W.ty1 : -1;
    return {
      v: VERSION, savedAt: Date.now(), colonyId: sim.colonyId,
      seed: sim.seed, workers0: sim.workers0, trailLifetime: W.trailLifetime, naturalFood: sim.naturalFood,
      time: sim.time, foodTimer: sim.foodTimer, foodScale: sim.foodScale,
      rng: { s: sim.rng.s, spare: sim.rng.spare },
      world: {
        trailY0: y0, trail: W.trail.slice(y0 * W.gw, (y1 + 1) * W.gw),
        box: [W.tx0, W.tx1, W.ty0, W.ty1], decayAcc: W.decayAcc, decayCount: W.decayCount,
        rocks: W.rocks.map(function (r) {
          return { id: r.id, x: r.x, y: r.y, r: r.r, pts: r.pts.slice(), tone: r.tone, seed: r.seed };
        }),
        rockSeq: W.rockSeq, foodSeq: W.foodSeq,
        foods: W.foods.map(function (f) {
          return {
            uid: f.uid, type: f.type, x: f.x, y: f.y, amount: f.amount, initial: f.initial,
            quality: f.quality, r: f.r, seed: f.seed,
            bits: f.bits ? f.bits.map(function (b) {
              return { x: b.x, y: b.y, s: b.s, rot: b.rot, shade: b.shade, taken: b.taken };
            }) : null
          };
        }),
        pellets: new Float32Array(W.pellets),
        corpses: W.corpses.map(function (c) { return { x: c.x, y: c.y, rot: c.rot, size: c.size }; }),
        middenX: W.middenX, middenY: W.middenY
      },
      colony: {
        arrays: arrays, scalars: scalars,
        free: col.free.slice(), idle: col.idle.slice(), brood: col.brood.slice(col.broodHead)
      }
    };
  }

  /* Rebuilds a running simulation from a snapshot, or returns null if it cannot be used. */
  function restore(snap) {
    if (!snap || snap.v !== VERSION || !snap.world || !snap.colony) return null;
    var sim = new AH.Sim({
      seed: snap.seed, workers: snap.workers0, trailLifetime: snap.trailLifetime,
      naturalFood: snap.naturalFood, starterFood: false
    });
    var W = sim.world, col = sim.colony, w = snap.world, c = snap.colony, i, k;

    W.trail.fill(0);
    W.trail.set(w.trail, w.trailY0 * W.gw);
    W.tx0 = w.box[0]; W.tx1 = w.box[1]; W.ty0 = w.box[2]; W.ty1 = w.box[3];
    W.decayAcc = w.decayAcc; W.decayCount = w.decayCount;
    W.middenX = w.middenX; W.middenY = w.middenY;

    W.rocks = w.rocks.map(function (r) {
      return { id: r.id, x: r.x, y: r.y, r: r.r, pts: r.pts.slice(), tone: r.tone, seed: r.seed };
    });
    W.rockSeq = w.rockSeq;
    W.obst.fill(0);
    for (i = 0; i < W.rocks.length; i++) W.rasterRock(W.rocks[i]);
    W.rockStamp++;

    W.foods = []; W.foodById = {};
    for (i = 0; i < w.foods.length; i++) {
      var s = w.foods[i], f = {
        uid: s.uid, type: s.type, x: s.x, y: s.y, amount: s.amount, initial: s.initial,
        quality: s.quality, r: s.r, mapR: 0, dead: false, seed: s.seed,
        bits: s.bits ? s.bits.map(function (b) {
          return { x: b.x, y: b.y, s: b.s, rot: b.rot, shade: b.shade, taken: b.taken };
        }) : null
      };
      W.foods.push(f); W.foodById[f.uid] = f;
    }
    W.foodSeq = w.foodSeq;
    W.rebuildFoodMap();

    W.pellets = Array.from(w.pellets); W.pelletStamp++;
    W.corpses = w.corpses.map(function (o) { return { x: o.x, y: o.y, rot: o.rot, size: o.size }; });

    col.alive.fill(0);
    for (i = 0; i < ARRAYS.length; i++) {
      k = ARRAYS[i];
      if (!c.arrays[k] || c.arrays[k].length > col[k].length) return null;
      col[k].set(c.arrays[k]);
    }
    for (i = 0; i < SCALARS.length; i++) { k = SCALARS[i]; col[k] = c.scalars[k]; }
    col.free = c.free.slice();
    col.idle = c.idle.slice();
    col.idlePos.fill(-1);
    for (i = 0; i < col.idle.length; i++) col.idlePos[col.idle[i]] = i;
    col.brood = c.brood.slice(); col.broodHead = 0;

    sim.colonyId = snap.colonyId;
    sim.time = snap.time; sim.foodTimer = snap.foodTimer; sim.foodScale = snap.foodScale;
    sim.rng.s = snap.rng.s; sim.rng.spare = snap.rng.spare;
    return sim;
  }

  /* ---------- storage ---------- */

  var DB = 'ant-hill', STORE = 'state', KEY = 'colony', db = null;

  function open(cb) {
    if (db) { cb(db); return; }
    var done = false, finish = function (d) { if (!done) { done = true; db = d; cb(d); } };
    try {
      var rq = root.indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { finish(rq.result); };
      rq.onerror = rq.onblocked = function () { finish(null); };
    } catch (e) { finish(null); }
    setTimeout(function () { finish(null); }, 3000);   // storage that never answers counts as unavailable
  }

  /* cb(snapshot or null, ok). ok is false when storage could not be read at all. */
  function load(cb) {
    open(function (d) {
      if (!d) { cb(null, false); return; }
      try {
        var rq = d.transaction(STORE).objectStore(STORE).get(KEY);
        rq.onsuccess = function () { cb(rq.result || null, true); };
        rq.onerror = function () { cb(null, false); };
      } catch (e) { cb(null, false); }
    });
  }

  /*
   * Writes the snapshot, and reports 'written', 'other-colony' or 'failed'.
   * A colony is never written over a different one unless replace is set,
   * which only happens when the person asks for a new colony. So a page that
   * could not read the save, and started afresh, cannot wipe out the real one.
   */
  function store(snap, replace, cb) {
    var say = function (r) { if (cb) cb(r); };
    open(function (d) {
      if (!d) { say('failed'); return; }
      try {
        var tx = d.transaction(STORE, 'readwrite'), os = tx.objectStore(STORE), rq = os.get(KEY), result = 'failed';
        rq.onsuccess = function () {
          var cur = rq.result;
          if (cur && !replace && cur.v === VERSION && cur.colonyId !== snap.colonyId) { result = 'other-colony'; return; }
          os.put(snap, KEY);
          result = 'written';
        };
        tx.oncomplete = function () { say(result); };
        tx.onerror = tx.onabort = function () { say('failed'); };
      } catch (e) { say('failed'); }
    });
  }

  function clear() {
    open(function (d) {
      if (!d) return;
      try { d.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY); } catch (e) { /* nothing to clear */ }
    });
  }

  AH.Save = { snapshot: snapshot, restore: restore, load: load, store: store, clear: clear };
})(typeof window !== 'undefined' ? window : globalThis);
