/*
 * The colony and its ants.
 *
 * Each ant only knows what a real ant could know: what its two antennae
 * touch, its own running estimate of where the nest is (path integration),
 * one remembered food site, and whether it is carrying anything. Trails,
 * recruitment and path selection are not programmed anywhere; they come out
 * of many ants following these local rules.
 */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};
  var C = AH.CONFIG;
  var TAU = Math.PI * 2;
  var wrap = AH.wrapAngle;

  var S = AH.STATE = {
    IN_NEST: 0, EMERGE: 1, SCOUT: 2, FOLLOW: 3, TO_FOOD: 4, SEARCH_FOOD: 5,
    APPROACH: 6, FEED: 7, RETURN: 8, SEARCH_NEST: 9, ENTER: 10, DUMP: 11
  };
  var CARRY = AH.CARRY = { NONE: 0, SUGAR: 1, CRUMB: 2, SOIL: 3, CORPSE: 4 };

  function Colony(world, rng, opts) {
    opts = opts || {};
    var n = this.cap = C.maxAgents, cc = C.colony;
    this.world = world; this.rng = rng;
    this.nx = world.nestX; this.ny = world.nestY;

    var F = function () { return new Float32Array(n); };
    this.x = F(); this.y = F(); this.th = F(); this.v = F(); this.om = F(); this.wn = F();
    this.timer = F(); this.pause = F(); this.tripT = F(); this.tripMax = F();
    this.lost = F(); this.progD = F(); this.progT = F(); this.wallT = F();
    this.agit = F(); this.contactCd = F(); this.stuck = F();
    this.pix = F(); this.piy = F(); this.piC = F(); this.piS = F();
    this.memX = F(); this.memY = F(); this.memQ = F();
    this.badX = F(); this.badY = F(); this.badUntil = F();
    this.lay = F(); this.layAcc = F(); this.load = F(); this.carryQ = F(); this.drink = F();
    this.tgx = F(); this.tgy = F();
    this.size = F(); this.spd = F();
    this.anim = F(); this.odo = F(); this.look = F(); this.lookT = F(); this.marking = F();
    this.sL = F(); this.sC = F(); this.sR = F();
    this.born = F();
    this.state = new Uint8Array(n); this.nextState = new Uint8Array(n);
    this.carry = new Uint8Array(n); this.temp = new Uint8Array(n); this.alive = new Uint8Array(n);
    this.memFails = new Uint8Array(n); this.ftype = new Uint8Array(n);
    this.wall = new Int8Array(n);
    this.tgt = new Int32Array(n); this.tbit = new Int32Array(n);
    this.idlePos = new Int32Array(n).fill(-1);
    this.uid = new Uint32Array(n); this.trips = new Uint16Array(n);
    this.uidSeq = 0;
    this.count = 0;
    this.free = [];
    this.idle = [];

    this.hs = C.world.hashCell;
    this.hw = Math.ceil(world.w / this.hs) + 1;
    this.hh = Math.ceil(world.h / this.hs) + 1;
    this.hHead = new Int32Array(this.hw * this.hh);
    this.hNext = new Int32Array(n);

    // colony-level state
    this.workers = opts.workers || cc.workers;
    this.days = 0;
    this.t = 0;
    this.store = this.workers * cc.storePerWorker * cc.startStore;
    this.hunger = 1 - cc.startStore;
    this.excite = 0;
    this.brood = [];
    this.broodHead = 0;
    this.eggAcc = 0; this.deathAcc = 0; this.soilAcc = 0; this.recAcc = 0; this.scoutAcc = 0;
    this.foragerAcc = 0; this.corpseQueue = 0; this.corpseCd = 0;
    this.delivered = 0; this.deliveredSugar = 0; this.deliveredCrumbs = 0;
    this.bornTotal = 0; this.diedTotal = 0;
    this.outside = 0;
    this.stateCount = new Uint16Array(12);
    this.nRecruited = 0; this.nFollowFound = 0; this.nScoutFound = 0; this.nMemoryFound = 0;

    var nb = Math.round(cc.eggRate * cc.devDays * 0.7 * this.workers / cc.workers), k;
    for (k = 0; k < nb; k++) this.brood.push(rng.range(0, cc.devDays));
    this.brood.sort(function (a, b) { return a - b; });

    var nf = Math.round(this.workers * cc.foragerFrac);
    for (k = 0; k < nf; k++) {
      var i = this.alloc(false);
      if (i < 0) break;
      this.born[i] = -rng.range(60, 300);
      this.addIdle(i);
    }
  }

  /* ---------- slots ---------- */

  Colony.prototype.alloc = function (temp) {
    var i, rng = this.rng, A = C.ant;
    if (this.free.length) i = this.free.pop();
    else if (this.count < this.cap) i = this.count++;
    else return -1;
    this.alive[i] = 1;
    this.temp[i] = temp ? 1 : 0;
    this.uid[i] = ++this.uidSeq;
    this.size[i] = Math.max(3.1, Math.min(5, A.length + rng.gauss() * A.lengthSd));
    this.spd[i] = Math.max(11, A.speed + rng.gauss() * A.speedSd);
    this.state[i] = S.IN_NEST; this.nextState[i] = S.IN_NEST;
    this.x[i] = this.nx; this.y[i] = this.ny; this.th[i] = 0; this.v[i] = 0; this.om[i] = 0; this.wn[i] = 0;
    this.timer[i] = 0; this.pause[i] = 0; this.tripT[i] = 0; this.tripMax[i] = 600;
    this.lost[i] = 0; this.progD[i] = 0; this.progT[i] = 0; this.wallT[i] = 0; this.wall[i] = 0;
    this.agit[i] = 0; this.contactCd[i] = 0; this.stuck[i] = 0;
    this.pix[i] = 0; this.piy[i] = 0; this.piC[i] = 1; this.piS[i] = 0;
    this.memX[i] = 0; this.memY[i] = 0; this.memQ[i] = 0; this.memFails[i] = 0;
    this.badX[i] = 0; this.badY[i] = 0; this.badUntil[i] = 0;
    this.lay[i] = 0; this.layAcc[i] = 0; this.load[i] = 0; this.carryQ[i] = 0; this.drink[i] = 60;
    this.carry[i] = 0; this.ftype[i] = 0; this.tgt[i] = 0; this.tbit[i] = -1;
    this.anim[i] = 0; this.odo[i] = 0; this.look[i] = 0; this.lookT[i] = 0; this.marking[i] = 0;
    this.sL[i] = 0; this.sC[i] = 0; this.sR[i] = 0;
    this.trips[i] = 0; this.born[i] = this.days;
    this.idlePos[i] = -1;
    return i;
  };

  Colony.prototype.release = function (i) {
    if (this.idlePos[i] >= 0) this.removeIdle(i);
    this.alive[i] = 0;
    this.state[i] = S.IN_NEST;
    this.free.push(i);
  };

  Colony.prototype.addIdle = function (i) {
    this.idlePos[i] = this.idle.length;
    this.idle.push(i);
  };

  Colony.prototype.removeIdle = function (i) {
    var k = this.idlePos[i], last = this.idle.pop();
    if (last !== i) { this.idle[k] = last; this.idlePos[last] = k; }
    this.idlePos[i] = -1;
  };

  Colony.prototype.popIdle = function () {
    if (!this.idle.length) return -1;
    var i = this.idle[this.rng.int(this.idle.length)];
    this.removeIdle(i);
    return i;
  };

  /* ---------- the nest interior (not drawn, so modelled as rates) ---------- */

  Colony.prototype.updateColony = function (dt) {
    var cc = C.colony, rng = this.rng, i;
    var dDays = dt * cc.lifeAccel / 86400;
    this.days += dDays;
    this.t += dt;

    this.store = Math.max(0, this.store - this.workers * cc.consumption * dDays);
    var target = this.workers * cc.storePerWorker;
    this.hunger = Math.max(0, Math.min(1, 1 - this.store / target));

    // the queen lays faster when the colony is well fed
    var sizeK = this.workers / cc.workers;
    this.eggAcc += cc.eggRate * sizeK * (0.25 + 0.75 * (1 - this.hunger)) * dDays;
    while (this.eggAcc >= 1) {
      this.eggAcc -= 1;
      this.brood.push(this.days + cc.devDays * rng.range(0.92, 1.08));
    }
    // brood that has finished developing emerges if there was food to raise it
    while (this.broodHead < this.brood.length && this.brood[this.broodHead] <= this.days) {
      if (this.store < cc.broodCost + target * cc.broodReserve) break;
      this.store -= cc.broodCost;
      this.broodHead++;
      this.workers++; this.bornTotal++;
      this.foragerAcc += cc.foragerFrac;
      if (this.foragerAcc >= 1) {
        this.foragerAcc -= 1;
        i = this.alloc(false);
        if (i >= 0) this.addIdle(i);
      }
    }
    if (this.broodHead > 512) { this.brood.splice(0, this.broodHead); this.broodHead = 0; }

    // old workers die inside and are carried out to the refuse pile
    this.deathAcc += this.workers / cc.lifespanDays * dDays;
    while (this.deathAcc >= 1) {
      this.deathAcc -= 1;
      if (this.workers <= 20) break;
      this.workers--; this.diedTotal++;
      if (rng.next() < cc.foragerFrac && this.idle.length > 5) this.release(this.popIdle());
      this.corpseQueue++;
    }
    if (this.corpseCd > 0) this.corpseCd -= dt;
    if (this.corpseQueue > 0 && this.corpseCd <= 0) {
      this.corpseQueue--; this.corpseCd = rng.range(4, 12);
      this.spawnDump(CARRY.CORPSE);
    }

    // digging: soil grains are carried up and dropped on the mound
    this.soilAcc += cc.soilRate * Math.sqrt(sizeK) * dt;
    while (this.soilAcc >= 1) { this.soilAcc -= 1; this.spawnDump(CARRY.SOIL); }

    // recruitment: successful foragers stir nestmates into leaving along the trail
    this.excite -= this.excite * Math.min(1, dt / cc.exciteDecay);
    this.recAcc += this.excite * dt / cc.recruitLag;
    while (this.recAcc >= 1) {
      this.recAcc -= 1;
      i = this.popIdle();
      if (i < 0) { this.recAcc = 0; break; }
      this.excite = Math.max(0, this.excite - 1);
      this.nRecruited++;
      this.emerge(i, S.FOLLOW, this.chooseTrailDirection(i));
    }

    // scouts: a slow trickle that grows when the colony is hungry
    this.scoutAcc += this.idle.length * cc.scoutRate * (0.25 + 1.25 * this.hunger) * dt;
    while (this.scoutAcc >= 1) {
      this.scoutAcc -= 1;
      i = this.popIdle();
      if (i < 0) break;
      this.emerge(i, S.SCOUT, rng.range(0, TAU));
    }
  };

  /*
   * A recruit at the entrance picks which way to set off. Each direction is
   * weighted by the trail pheromone there using Deneubourg's choice function
   * (k + c)^n, so a stronger trail is chosen disproportionately often.
   */
  Colony.prototype.chooseTrailDirection = function (i) {
    var T = C.trail, W = this.world, K = T.hubSamples, sum = 0, w = this._hubW || (this._hubW = new Float32Array(K)), k;
    // an ant that recently followed a trail to nothing is reluctant to take that way again
    var wary = this.badUntil[i] > this.t, badAng = wary ? Math.atan2(this.badY[i], this.badX[i]) : 0;
    for (k = 0; k < K; k++) {
      var a = k / K * TAU;
      var c = W.sampleTrail(this.nx + Math.cos(a) * T.hubRadius, this.ny + Math.sin(a) * T.hubRadius);
      w[k] = Math.pow(T.choiceK + c / (1 + c / T.senseSat), T.choiceN);
      if (wary && Math.abs(wrap(a - badAng)) < 0.6) w[k] *= 0.08;
      sum += w[k];
    }
    var r = this.rng.next() * sum;
    for (k = 0; k < K; k++) { r -= w[k]; if (r <= 0) break; }
    if (k >= K) k = K - 1;
    return (k + this.rng.range(-0.5, 0.5)) / K * TAU;
  };

  Colony.prototype.emerge = function (i, st, ang) {
    var rng = this.rng, A = C.ant;
    this.state[i] = S.EMERGE; this.nextState[i] = st;
    this.anim[i] = 0;
    this.x[i] = this.nx + Math.cos(ang) * 0.8; this.y[i] = this.ny + Math.sin(ang) * 0.8;
    this.th[i] = ang; this.v[i] = 0; this.om[i] = 0; this.wn[i] = 0;
    this.tripT[i] = 0; this.tripMax[i] = rng.range(A.tripTime[0], A.tripTime[1]);
    this.pause[i] = 0; this.lost[i] = 0; this.progD[i] = 0; this.progT[i] = 0;
    this.wall[i] = 0; this.wallT[i] = 0; this.stuck[i] = 0; this.load[i] = 0;
    this.agit[i] = 0;   // an alarm from the last trip has worn off by now
    if (this.temp[i]) { this.piC[i] = 1; this.piS[i] = 0; }
    else {
      // this trip's compass and step-counting error
      var b = rng.gauss() * A.piBiasSd, o = 1 + rng.gauss() * A.piOdoSd;
      this.piC[i] = Math.cos(b) * o; this.piS[i] = Math.sin(b) * o;
    }
    this.pix[i] = this.x[i] - this.nx; this.piy[i] = this.y[i] - this.ny;
    if (st !== S.TO_FOOD) this.lay[i] = 0;
    this.layAcc[i] = 0;
  };

  Colony.prototype.spawnDump = function (kind) {
    var i = this.alloc(true);
    if (i < 0) return;
    var rng = this.rng, W = this.world, a, d, tx, ty;
    if (kind === CARRY.SOIL) {
      a = rng.range(0, TAU);
      d = Math.max(7, C.nest.moundR * 0.6 + rng.gauss() * C.nest.moundR * 0.22);
      tx = this.nx + Math.cos(a) * d; ty = this.ny + Math.sin(a) * d * 0.94;
    } else {
      tx = W.middenX + rng.gauss() * 9; ty = W.middenY + rng.gauss() * 9;
      a = Math.atan2(ty - this.ny, tx - this.nx) + rng.gauss() * 0.3;
    }
    this.carry[i] = kind; this.tgx[i] = tx; this.tgy[i] = ty;
    this.emerge(i, S.DUMP, a);
  };

  Colony.prototype.enterNest = function (i) {
    var cc = C.colony, rng = this.rng, c = this.carry[i];
    if (this.temp[i]) { this.release(i); return; }
    this.state[i] = S.IN_NEST; this.anim[i] = 0; this.v[i] = 0;
    if (c === CARRY.SUGAR || c === CARRY.CRUMB) {
      var q = this.carryQ[i];
      this.store += this.load[i] * (c === CARRY.SUGAR ? 0.4 + 0.6 * q : 1);
      this.delivered++;
      if (c === CARRY.SUGAR) this.deliveredSugar++; else this.deliveredCrumbs++;
      // a forager that marked the trail also rouses nestmates
      this.excite += this.lay[i] > 0
        ? cc.recruitPerTrip * (0.4 + 0.6 * q) * (0.5 + this.hunger)
        : 0.15;
      this.timer[i] = rng.range(cc.unload[0], cc.unload[1]);
    } else {
      this.timer[i] = rng.range(cc.rest[0], cc.rest[1]);
    }
    this.carry[i] = 0; this.load[i] = 0;
  };

  Colony.prototype.rested = function (i) {
    var cc = C.colony, rng = this.rng;
    this.timer[i] = 0;
    if (this.memQ[i] > 0 && rng.next() < cc.returnProb * (0.35 + 0.65 * Math.min(1, this.hunger * 2))) {
      this.emerge(i, S.TO_FOOD, Math.atan2(this.memY[i], this.memX[i]) + rng.gauss() * 0.3);
    } else {
      this.addIdle(i);
    }
  };

  /* ---------- one time step ---------- */

  Colony.prototype.buildHash = function () {
    var head = this.hHead, nxt = this.hNext, hs = this.hs, hw = this.hw;
    head.fill(-1);
    for (var i = 0, n = this.count; i < n; i++) {
      if (!this.alive[i] || this.state[i] === S.IN_NEST) continue;
      var c = ((this.y[i] / hs) | 0) * hw + ((this.x[i] / hs) | 0);
      nxt[i] = head[c]; head[c] = i;
    }
  };

  Colony.prototype.step = function (dt) {
    this.updateColony(dt);
    this.buildHash();
    var sc = this.stateCount, out = 0;
    sc.fill(0);
    for (var i = 0, n = this.count; i < n; i++) {
      if (!this.alive[i]) continue;
      var st = this.state[i];
      if (st === S.IN_NEST) {
        var t = this.timer[i];
        if (t > 0) { t -= dt; this.timer[i] = t; if (t <= 0) this.rested(i); }
        continue;
      }
      sc[st]++; out++;
      this.stepAnt(i, dt);
    }
    this.outside = out;
  };

  Colony.prototype.beginSearch = function (i, cx, cy, time) {
    this.state[i] = S.SEARCH_FOOD;
    this.tgx[i] = cx; this.tgy[i] = cy; this.timer[i] = time;
  };

  Colony.prototype.searchFailed = function (i) {
    if (this.memQ[i] > 0) {
      this.memFails[i]++;
      if (this.memFails[i] >= C.ant.memGiveUp) this.memQ[i] = 0;
    }
    // remember the place that had nothing, so the same stale trail is not followed again
    this.badX[i] = this.tgx[i]; this.badY[i] = this.tgy[i];
    this.badUntil[i] = this.t + C.ant.avoidTime;
    this.lay[i] = 0;
    this.state[i] = this.rng.next() < 0.6 ? S.RETURN : S.SCOUT;
  };

  Colony.prototype.pickBit = function (i, f) {
    var bits = f.bits, n = bits.length, best = -1, bd = 1e12, rng = this.rng, k, b, dx, dy, d;
    for (var t = 0; t < 8; t++) {
      k = rng.int(n); b = bits[k];
      if (b.taken) continue;
      dx = b.x - this.x[i]; dy = b.y - this.y[i]; d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) for (k = 0; k < n; k++) if (!bits[k].taken) { best = k; break; }
    this.tbit[i] = best;
    return best >= 0;
  };

  Colony.prototype.afterFeed = function (i) {
    var rng = this.rng, T = C.trail, load = this.load[i];
    if (load >= 0.3) {
      var q = this.carryQ[i];
      this.carry[i] = this.ftype[i] === 1 ? CARRY.SUGAR : CARRY.CRUMB;
      // remember where this was, in the ant's own path-integration coordinates
      this.memX[i] = this.pix[i]; this.memY[i] = this.piy[i];
      this.memQ[i] = q; this.memFails[i] = 0;
      this.badUntil[i] = 0;
      this.trips[i]++;
      // richer food, a fuller crop and a hungrier colony all make marking more likely
      var p = (T.layBase + T.layQuality * q) * (0.6 + 0.6 * this.hunger) * (load >= 0.7 ? 1 : 0.35);
      this.lay[i] = rng.next() < p ? 0.5 + 0.5 * q : 0;
      this.layAcc[i] = 0;
      this.state[i] = S.RETURN;
      this.th[i] = wrap(this.th[i] + Math.PI + rng.gauss() * 0.35);
      this.pause[i] = rng.range(0.2, 0.8);
    } else {
      this.load[i] = 0;
      this.beginSearch(i, this.pix[i], this.piy[i], rng.range(20, 40));
    }
  };

  Colony.prototype.stepFeed = function (i, dt) {
    var W = this.world, f = W.foodById[this.tgt[i]];
    this.v[i] = 0; this.om[i] = 0;
    if (!f) { this.afterFeed(i); return; }
    if (f.type === 'sugar') {
      var px = this.x[i], py = this.y[i], L = this.size[i];
      var dx = f.x - px, dy = f.y - py, d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      var want = f.r + L * 0.45;
      // keep the mouthparts at the edge as the drop shrinks
      this.th[i] = wrap(this.th[i] + wrap(Math.atan2(dy, dx) - this.th[i]) * Math.min(1, dt * 5));
      if (d > want + 0.2) {
        var stp = Math.min(d - want, 5 * dt);
        this.x[i] = px + dx / d * stp; this.y[i] = py + dy / d * stp;
        this.odo[i] += stp;
      } else if (d < want - 0.3) {
        var back = Math.min(want - d, 5 * dt);
        this.x[i] = px - dx / d * back; this.y[i] = py - dy / d * back;
        this.odo[i] += back;
      }
      this.spreadAtEdge(i, dt);
      var take = dt / this.drink[i];
      if (take > f.amount) take = f.amount;
      this.load[i] += take; f.amount -= take;
      W.shrinkSugar(f);
      if (f.amount <= 0.001) W.removeFood(f);
      if (this.load[i] >= 1 || f.dead) this.afterFeed(i);
    } else {
      this.timer[i] -= dt;
      if (this.timer[i] <= 0) {
        var bit = f.bits[this.tbit[i]];
        if (bit && !bit.taken) {
          bit.taken = true; f.amount -= 1; W.foodStamp++;
          this.load[i] = 1;
          if (f.amount <= 0) W.removeFood(f);
          this.afterFeed(i);
        } else if (this.pickBit(i, f)) {
          this.state[i] = S.APPROACH;
        } else {
          this.afterFeed(i);
        }
      }
    }
  };

  Colony.prototype.spreadAtEdge = function (i, dt) {
    var hs = this.hs, hw = this.hw, hh = this.hh, head = this.hHead, nxt = this.hNext;
    var qx = this.x[i], qy = this.y[i], space = C.ant.personalSpace * 1.1;
    var cx0 = (qx / hs) | 0, cy0 = (qy / hs) | 0, pushX = 0, pushY = 0;
    for (var yy = cy0 - 1; yy <= cy0 + 1; yy++) {
      if (yy < 0 || yy >= hh) continue;
      for (var xx = cx0 - 1; xx <= cx0 + 1; xx++) {
        if (xx < 0 || xx >= hw) continue;
        var j = head[yy * hw + xx];
        while (j >= 0) {
          if (j !== i && this.state[j] === S.FEED) {
            var ex = qx - this.x[j], ey = qy - this.y[j], e2 = ex * ex + ey * ey;
            if (e2 < space * space && e2 > 1e-6) {
              var e = Math.sqrt(e2), ov = (space - e) / e;
              pushX += ex * ov; pushY += ey * ov;
            }
          }
          j = nxt[j];
        }
      }
    }
    if (pushX !== 0 || pushY !== 0) {
      var k = Math.min(1, dt * 4);
      this.x[i] = qx + pushX * k; this.y[i] = qy + pushY * k;
      this.odo[i] += Math.sqrt(pushX * pushX + pushY * pushY) * k;
    }
  };

  Colony.prototype.stepAnt = function (i, dt) {
    var W = this.world, rng = this.rng, A = C.ant, T = C.trail;
    var st = this.state[i];
    var px = this.x[i], py = this.y[i], h = this.th[i], L = this.size[i];
    var nx = this.nx, ny = this.ny;

    if (st === S.EMERGE) {
      this.anim[i] += dt / A.emergeTime;
      var ve = A.emergeSpeed;
      this.x[i] = px + Math.cos(h) * ve * dt; this.y[i] = py + Math.sin(h) * ve * dt;
      this.v[i] = ve; this.odo[i] += ve * dt;
      this.pix[i] = this.x[i] - nx; this.piy[i] = this.y[i] - ny;
      if (this.anim[i] >= 1) { this.anim[i] = 1; this.state[i] = this.nextState[i]; }
      return;
    }
    if (st === S.ENTER) {
      this.anim[i] -= dt / A.enterTime;
      var kk = Math.min(1, dt * 5);
      this.x[i] = px + (nx - px) * kk; this.y[i] = py + (ny - py) * kk;
      this.odo[i] += 3 * dt;
      if (this.anim[i] <= 0) this.enterNest(i);
      return;
    }

    this.tripT[i] += dt;
    if (this.contactCd[i] > 0) this.contactCd[i] -= dt;
    if (this.wallT[i] > 0) this.wallT[i] -= dt;
    if (this.lookT[i] > 0) this.lookT[i] -= dt;
    if (this.marking[i] > 0) this.marking[i] -= dt;

    var dxn = px - nx, dyn = py - ny;
    var dNest = Math.sqrt(dxn * dxn + dyn * dyn);
    var nearNest = dNest < C.nest.recogR;
    // close to home the mound and nest odour correct the ant's position estimate
    if (nearNest) { this.pix[i] = dxn; this.piy[i] = dyn; }

    var agit = this.agit[i];
    if (agit > 0) { agit -= dt; this.agit[i] = agit; }
    if (W.alarmActive && agit < 1 && W.sampleAlarm(px, py) > C.alarm.threshold) {
      agit = this.agit[i] = rng.range(5, 10);
      if (st === S.FEED) { this.afterFeed(i); st = this.state[i]; }
    }

    if (st === S.FEED) { this.stepFeed(i, dt); return; }

    // --- what the antennae pick up ---
    var ch = Math.cos(h), sh = Math.sin(h);
    var ah = L * A.senseAhead, al = L * A.senseSide;
    var lx = px + ch * ah - sh * al, ly = py + sh * ah + ch * al;
    var rx = px + ch * ah + sh * al, ry = py + sh * ah - ch * al;
    var sL = W.sampleTrail(lx, ly), sR = W.sampleTrail(rx, ry);
    var sC = W.sampleTrail(px + ch * ah * 1.1, py + sh * ah * 1.1);
    this.sL[i] = sL; this.sC[i] = sC; this.sR[i] = sR;
    var tot = sL + sC + sR;
    var resp = tot / (tot + T.halfResponse);
    // Weber's law: the turn depends on the relative, not absolute, difference
    var bias = (sL - sR) / (tot + 1e-4);

    var goal = 0, goalW = 0, trailW = 0, sigma = A.wanderScout, speedF = 1, pauseRate = 0;
    var carry = this.carry[i];
    var pix = this.pix[i], piy = this.piy[i];
    var dx, dy, d, f;
    // is it near a spot it remembers as a dead end?
    var wary = false;
    if (this.badUntil[i] > this.t) {
      dx = this.badX[i] - pix; dy = this.badY[i] - piy;
      wary = dx * dx + dy * dy < A.avoidRange * A.avoidRange;
    }

    switch (st) {
      case S.SCOUT:
        speedF = 0.85; pauseRate = 0.1;
        if (dNest < 130) { goal = Math.atan2(dyn, dxn); goalW = 0.4 * (1 - dNest / 130); }
        if (!wary && tot > T.joinThreshold && rng.next() < T.joinRate * resp * dt) {
          st = this.state[i] = S.FOLLOW;
          this.lost[i] = 0; this.progD[i] = Math.sqrt(pix * pix + piy * piy); this.progT[i] = 0;
        } else if (this.tripT[i] > this.tripMax[i]) {
          st = this.state[i] = S.RETURN;
        }
        break;

      case S.FOLLOW:
        trailW = 1;
        sigma = A.wanderCast + (A.wanderTrail - A.wanderCast) * resp;
        speedF = 0.72 + 0.33 * resp; pauseRate = 0.03;
        goal = Math.atan2(dyn, dxn); goalW = 0.3 * (1 - resp);
        if (wary) { st = this.state[i] = rng.next() < 0.5 ? S.RETURN : S.SCOUT; break; }
        if (tot < T.lostThreshold) {
          this.lost[i] += dt;
          if (this.lost[i] > T.lostTime) { this.beginSearch(i, pix, piy, rng.range(30, 60)); st = S.SEARCH_FOOD; }
        } else {
          this.lost[i] = 0;
        }
        // a trail has no arrow on it; an outbound ant that finds itself
        // getting closer to home turns round
        this.progT[i] += dt;
        if (this.progT[i] > 3) {
          d = Math.sqrt(pix * pix + piy * piy);
          if (d < this.progD[i] - 12 && dNest > 60 && rng.next() < 0.8) {
            h = wrap(h + Math.PI + rng.gauss() * 0.3); this.wn[i] = 0;
          }
          this.progD[i] = d; this.progT[i] = 0;
        }
        if (st === S.FOLLOW && this.tripT[i] > this.tripMax[i]) st = this.state[i] = S.RETURN;
        break;

      case S.TO_FOOD:
        dx = this.memX[i] - pix; dy = this.memY[i] - piy; d = Math.sqrt(dx * dx + dy * dy);
        goal = Math.atan2(dy, dx); goalW = 1 - 0.6 * resp; trailW = 0.8;
        sigma = 0.55 - 0.25 * resp; pauseRate = 0.02;
        if (d < 10) { this.beginSearch(i, this.memX[i], this.memY[i], rng.range(40, 80)); st = S.SEARCH_FOOD; }
        else if (this.tripT[i] > this.tripMax[i] * 1.5) st = this.state[i] = S.RETURN;
        break;

      case S.SEARCH_FOOD:
        dx = this.tgx[i] - pix; dy = this.tgy[i] - piy; d = Math.sqrt(dx * dx + dy * dy);
        goal = Math.atan2(dy, dx); goalW = Math.min(1.6, (d / 22) * (d / 22));
        sigma = A.wanderSearch; speedF = 0.8; pauseRate = 0.14;
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) { this.searchFailed(i); st = this.state[i]; }
        break;

      case S.APPROACH:
        f = W.foodById[this.tgt[i]];
        if (!f) { this.beginSearch(i, pix, piy, rng.range(15, 30)); st = S.SEARCH_FOOD; break; }
        var tx, ty, want;
        if (f.type === 'sugar') { tx = f.x; ty = f.y; want = f.r + L * 0.45; }
        else {
          var bit = f.bits[this.tbit[i]];
          if (!bit || bit.taken) {
            if (!this.pickBit(i, f)) { this.beginSearch(i, pix, piy, rng.range(15, 30)); st = S.SEARCH_FOOD; break; }
            bit = f.bits[this.tbit[i]];
          }
          tx = bit.x; ty = bit.y; want = L * 0.5;
        }
        dx = tx - px; dy = ty - py; d = Math.sqrt(dx * dx + dy * dy);
        if (d <= want + 0.6) {
          this.state[i] = S.FEED; this.v[i] = 0; this.om[i] = 0;
          this.carryQ[i] = f.quality; this.ftype[i] = f.type === 'sugar' ? 1 : 2;
          this.drink[i] = rng.range(A.drinkTime[0], A.drinkTime[1]);
          this.timer[i] = rng.range(A.handleTime[0], A.handleTime[1]);
          this.th[i] = wrap(h + wrap(Math.atan2(dy, dx) - h) * 0.5);
          return;
        }
        goal = Math.atan2(dy, dx); goalW = 2; sigma = 0.25;
        speedF = 0.75 * Math.max(0.3, Math.min(1, (d - want) / 4));
        // if the edge is crowded, walk round it looking for a gap
        if (this.v[i] < 2.5 && d < want + 7) {
          this.stuck[i] += dt;
          if (this.stuck[i] > 0.6) {
            this.wall[i] = rng.next() < 0.5 ? 1 : -1; this.wallT[i] = rng.range(1, 2); this.stuck[i] = 0;
          }
        } else {
          this.stuck[i] = 0;
        }
        if (this.wallT[i] > 0 && d < want + 9) goal += this.wall[i] * 1.25;
        break;

      case S.RETURN:
        d = Math.sqrt(pix * pix + piy * piy);
        goal = Math.atan2(-piy, -pix);
        sigma = A.wanderHome; pauseRate = 0.015;
        if (nearNest) {
          goalW = 1.6; trailW = 0.15;
          if (dNest < C.nest.entranceR + 0.8) { this.state[i] = S.ENTER; this.anim[i] = 1; return; }
        } else {
          goalW = 1 - 0.75 * resp; trailW = 0.9;
          // the home vector has run out but there is no nest here
          if (d < 8) { st = this.state[i] = S.SEARCH_NEST; this.timer[i] = 0; }
        }
        break;

      case S.SEARCH_NEST:
        this.timer[i] += dt;
        d = Math.sqrt(pix * pix + piy * piy);
        var Rs = 25 + 1.5 * this.timer[i];
        goal = Math.atan2(-piy, -pix); goalW = Math.min(2, (d / Rs) * (d / Rs)); trailW = 0.5;
        sigma = 1.7; speedF = 0.9;
        if (nearNest) st = this.state[i] = S.RETURN;
        break;

      case S.DUMP:
        dx = this.tgx[i] - px; dy = this.tgy[i] - py; d = Math.sqrt(dx * dx + dy * dy);
        goal = Math.atan2(dy, dx); goalW = 1.4; sigma = 0.5; speedF = 0.8;
        if (d < 2.5 || this.tripT[i] > 240) {
          if (carry === CARRY.SOIL) W.addPellet(px + ch * L * 0.5, py + sh * L * 0.5);
          else W.addCorpse(px + ch * L * 0.6, py + sh * L * 0.6);
          carry = this.carry[i] = 0;
          this.pause[i] = 0.7;
          st = this.state[i] = S.RETURN;
        }
        break;
    }

    if (agit > 0) { sigma += 2.2; speedF *= 1.6; pauseRate = 0; }

    // --- wandering: a smoothly varying turn rate gives a winding, ant-like path ---
    var wn = this.wn[i], tw = A.wanderTau;
    wn += -wn / tw * dt + sigma * Math.sqrt(2 * dt / tw) * rng.gauss();
    var wmax = 3 * sigma + 1;
    if (wn > wmax) wn = wmax; else if (wn < -wmax) wn = -wmax;

    // --- obstacles felt by the antennae ---
    var bl = W.blocked(lx, ly), br = W.blocked(rx, ry);
    var bf = W.blocked(px + ch * L * 0.75, py + sh * L * 0.75);
    var obs = bl || br || bf, omObs = 0;
    if (obs) {
      var side = this.wall[i];
      if (this.wallT[i] <= 0 || side === 0) {
        if (bl && !br) side = -1;
        else if (br && !bl) side = 1;
        else if (goalW > 0) side = wrap(goal - h) >= 0 ? 1 : -1;
        else side = rng.next() < 0.5 ? 1 : -1;
        this.wall[i] = side;
      }
      this.wallT[i] = 1.2;
      omObs = side * A.avoidTurn * (bf ? 1.4 : 1);
      speedF *= bf ? 0.35 : 0.7;
    }

    // --- steering: trail, goal and wandering combined ---
    var da = wrap(goal - h);
    if (da > 1.3) da = 1.3; else if (da < -1.3) da = -1.3;
    var om = trailW * T.gain * bias * resp + goalW * A.goalGain * da + wn;
    if (obs) om = om * 0.35 + omObs;
    var omMax = agit > 0 ? A.maxTurn * 1.3 : A.maxTurn;
    if (om > omMax) om = omMax; else if (om < -omMax) om = -omMax;

    var vt = this.spd[i] * speedF * (1 - 0.45 * Math.min(1, Math.abs(om) / A.maxTurn));
    if (carry >= CARRY.CRUMB) vt *= 0.85;
    if (this.pause[i] > 0) { this.pause[i] -= dt; vt = 0; om *= 0.25; }
    else if (pauseRate > 0 && rng.next() < pauseRate * dt) this.pause[i] = rng.range(0.25, 1.1);

    var v = this.v[i];
    if (vt > v) v = Math.min(vt, v + A.accel * dt); else v = Math.max(vt, v - A.decel * dt);

    // --- move ---
    h = wrap(h + om * dt);
    var c2 = Math.cos(h), s2 = Math.sin(h), ds = v * dt;
    var qx = px + c2 * ds, qy = py + s2 * ds;
    if (W.blocked(qx, qy)) {
      if (!W.blocked(qx, py)) qy = py;
      else if (!W.blocked(px, qy)) qx = px;
      else { qx = px; qy = py; }
      v *= 0.5;
      h = wrap(h + (this.wall[i] || 1) * 2.5 * dt);
    }

    // --- other ants: keep a little space, and stop to check who it is ---
    var hs = this.hs, hw = this.hw, hh = this.hh, head = this.hHead, nxt = this.hNext;
    var cx0 = (qx / hs) | 0, cy0 = (qy / hs) | 0;
    var pushX = 0, pushY = 0, space = A.personalSpace, cr = L * A.contactRange;
    var canContact = this.contactCd[i] <= 0 && this.pause[i] <= 0 && agit <= 0;
    for (var yy = cy0 - 1; yy <= cy0 + 1; yy++) {
      if (yy < 0 || yy >= hh) continue;
      for (var xx = cx0 - 1; xx <= cx0 + 1; xx++) {
        if (xx < 0 || xx >= hw) continue;
        var j = head[yy * hw + xx];
        while (j >= 0) {
          if (j !== i) {
            var ex = qx - this.x[j], ey = qy - this.y[j];
            var e2 = ex * ex + ey * ey;
            if (e2 < 16 && e2 > 1e-6) {
              var e = Math.sqrt(e2);
              if (e < space) { var ov = (space - e) / e; pushX += ex * ov; pushY += ey * ov; }
              if (canContact && e < cr && -(ex * c2 + ey * s2) / e > 0.6) {
                var headOn = Math.cos(this.th[j] - h) < -0.3;
                if (rng.next() < (headOn ? A.contactPHead : A.contactPSame)) {
                  this.pause[i] = rng.range(0.1, 0.4);
                  this.look[i] = wrap(Math.atan2(-ey, -ex) - h);
                  this.lookT[i] = this.pause[i] + 0.1;
                }
                this.contactCd[i] = 1.2 + rng.next();
                wn += (c2 * (-ey) - s2 * (-ex)) > 0 ? -1.6 : 1.6;   // step round the other ant
                canContact = false;
              }
            }
          }
          j = nxt[j];
        }
      }
    }
    if (pushX !== 0 || pushY !== 0) {
      var pk = Math.min(1, dt * 9) * (dNest < 10 ? 0.15 : 0.5);
      var ux = qx + pushX * pk, uy = qy + pushY * pk;
      if (!W.blocked(ux, uy)) { qx = ux; qy = uy; }
    }

    // --- path integration: add this step to the running estimate of position ---
    var mvx = qx - px, mvy = qy - py;
    var moved = Math.sqrt(mvx * mvx + mvy * mvy);
    this.pix[i] += mvx * this.piC[i] - mvy * this.piS[i];
    this.piy[i] += mvx * this.piS[i] + mvy * this.piC[i];

    // --- trail laying: dabs of pheromone from the tip of the gaster ---
    var layI = this.lay[i];
    if (layI > 0 && ((st === S.RETURN && (carry === CARRY.SUGAR || carry === CARRY.CRUMB)) || st === S.TO_FOOD)) {
      this.layAcc[i] += moved;
      if (this.layAcc[i] >= T.markSpacing) {
        this.layAcc[i] -= T.markSpacing;
        var gx = qx - c2 * L * 0.45, gy = qy - s2 * L * 0.45;
        var here = W.sampleTrail(gx, gy);
        var amt = T.markAmount * layI * (st === S.TO_FOOD ? T.outboundLay : 1) / (1 + here / T.crowdHalf);
        W.depositTrail(gx, gy, amt);
        this.marking[i] = 0.25;
      }
    }

    // --- has it walked into food? ---
    if (carry === 0 && agit <= 0 && (st === S.SCOUT || st === S.FOLLOW || st === S.TO_FOOD || st === S.SEARCH_FOOD)) {
      f = W.foodAt(qx + c2 * L * 0.4, qy + s2 * L * 0.4);
      if (f) {
        if (st === S.FOLLOW) this.nFollowFound++;
        else if (st === S.SCOUT) this.nScoutFound++;
        else if (st === S.TO_FOOD) this.nMemoryFound++;
        this.state[i] = S.APPROACH; this.tgt[i] = f.uid; this.stuck[i] = 0;
        if (f.type !== 'sugar') this.pickBit(i, f);
      }
    }

    this.x[i] = qx; this.y[i] = qy; this.th[i] = h; this.v[i] = v; this.om[i] = om; this.wn[i] = wn;
    this.odo[i] += moved + Math.abs(om) * dt * L * 0.22;
    if (this.odo[i] > 60000) this.odo[i] -= 60000;
  };

  /* ---------- disturbances from outside ---------- */

  Colony.prototype.poke = function (x, y) {
    var R = C.alarm.pokeRadius, rng = this.rng, hit = 0;
    for (var i = 0, n = this.count; i < n; i++) {
      if (!this.alive[i]) continue;
      var st = this.state[i];
      if (st === S.IN_NEST || st === S.EMERGE || st === S.ENTER) continue;
      var dx = this.x[i] - x, dy = this.y[i] - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) continue;
      this.agit[i] = rng.range(7, 13);
      this.pause[i] = 0;
      this.th[i] = wrap(Math.atan2(dy, dx) + rng.gauss() * 0.7);
      if (st === S.FEED) this.afterFeed(i);
      else if (st === S.APPROACH) this.beginSearch(i, this.pix[i], this.piy[i], rng.range(20, 40));
      hit++;
    }
    this.world.depositAlarm(x, y, C.alarm.pokeAmount * (hit > 0 ? 1 : 0.4));
    return hit;
  };

  /* Ants standing where a rock has just landed scramble out from under it. */
  Colony.prototype.clearFromRock = function (rock) {
    var W = this.world, rng = this.rng;
    for (var i = 0, n = this.count; i < n; i++) {
      if (!this.alive[i] || this.state[i] === S.IN_NEST) continue;
      if (!W.blocked(this.x[i], this.y[i])) continue;
      var a = Math.atan2(this.y[i] - rock.y, this.x[i] - rock.x);
      for (var r = rock.r * 0.6; r < rock.r * 1.6; r += 1.5) {
        var qx = rock.x + Math.cos(a) * r, qy = rock.y + Math.sin(a) * r;
        if (!W.blocked(qx, qy)) { this.x[i] = qx; this.y[i] = qy; break; }
      }
      this.th[i] = a; this.agit[i] = rng.range(3, 6);
      if (this.state[i] === S.FEED) this.afterFeed(i);
    }
  };

  Colony.prototype.findByUid = function (uid) {
    for (var i = 0, n = this.count; i < n; i++) if (this.alive[i] && this.uid[i] === uid) return i;
    return -1;
  };

  AH.Colony = Colony;
})(typeof window !== 'undefined' ? window : globalThis);
