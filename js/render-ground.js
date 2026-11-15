/*
 * The look of the ground: soil colour, grain, pebbles, twigs and the mound.
 * Purely cosmetic. It uses its own random stream so scenery never changes
 * how the ants behave.
 */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};
  var C = AH.CONFIG, TAU = Math.PI * 2;

  function hash2(ix, iy, seed) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  function fbm(x, y, seed, oct) {
    var s = 0, a = 0.5, n = 0;
    for (var o = 0; o < oct; o++) { s += a * vnoise(x, y, seed + o * 17); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
    return s / n;
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function Ground(sim) {
    this.world = sim.world;
    this.rng = new AH.Rng((sim.seed * 7919 + 13) >>> 0);
    this.seed = sim.seed | 0;
    this.scale = 2;              // baked pixels per millimetre
    this.pelletsBaked = 0;
    this.buildDecor();
    this.buildTiles();
    this.bake();
  }

  /* ---------- scenery objects ---------- */

  Ground.prototype.buildDecor = function () {
    var rng = this.rng, W = this.world, i, k;
    var pebbleCols = [[132, 126, 118], [156, 140, 118], [108, 102, 98], [168, 156, 138], [140, 112, 90], [92, 84, 78]];
    this.pebbles = [];
    for (i = 0; i < 620; i++) {
      var r = rng.next() < 0.85 ? rng.range(0.45, 1.5) : rng.range(1.5, 3.4);
      var x = rng.range(6, W.w - 6), y = rng.range(6, W.h - 6);
      if (Math.hypot(x - W.nestX, y - W.nestY) < C.nest.moundR * 0.9) continue;
      var n = 6 + rng.int(4), pts = [];
      for (k = 0; k < n; k++) {
        var a = (k + rng.range(-0.3, 0.3)) / n * TAU, rr = r * rng.range(0.72, 1.1);
        pts.push(Math.cos(a) * rr, Math.sin(a) * rr * rng.range(0.8, 1));
      }
      this.pebbles.push({ x: x, y: y, r: r, pts: pts, col: pebbleCols[rng.int(pebbleCols.length)], l: Math.round(rng.range(-12, 14)) });
    }
    this.twigs = [];
    for (i = 0; i < 80; i++) {
      var len = rng.range(12, 70), ang = rng.range(0, TAU);
      var tx = rng.range(20, W.w - 20), ty = rng.range(20, W.h - 20);
      if (Math.hypot(tx - W.nestX, ty - W.nestY) < 60) continue;
      var dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2, bend = rng.range(-0.16, 0.16) * len;
      var straw = rng.next() < 0.6;
      this.twigs.push({
        x0: tx - dx, y0: ty - dy, x1: tx + dx, y1: ty + dy,
        cx: tx - Math.sin(ang) * bend, cy: ty + Math.cos(ang) * bend,
        w: straw ? rng.range(0.45, 0.9) : rng.range(0.9, 1.9),
        col: straw ? [196, 176, 128] : [98, 76, 56], r: len / 2 + 2, mx: tx, my: ty
      });
    }
    this.leaves = [];
    for (i = 0; i < 26; i++) {
      var lx = rng.range(30, W.w - 30), ly = rng.range(30, W.h - 30);
      if (Math.hypot(lx - W.nestX, ly - W.nestY) < 80) continue;
      var tone = rng.range(0, 1);
      this.leaves.push({
        x: lx, y: ly, len: rng.range(9, 22), wid: rng.range(0.32, 0.5), rot: rng.range(0, TAU),
        col: [Math.round(118 + 40 * tone), Math.round(84 + 28 * tone), Math.round(48 + 14 * tone)],
        curl: rng.range(-0.25, 0.25)
      });
    }
  };

  function smoothPoly(ctx, pts, n, ox, oy) {
    ctx.moveTo(ox + (pts[0] + pts[(n - 1) * 2]) / 2, oy + (pts[1] + pts[(n - 1) * 2 + 1]) / 2);
    for (var k = 0; k < n; k++) {
      var x = pts[k * 2], y = pts[k * 2 + 1], nx = pts[((k + 1) % n) * 2], ny = pts[((k + 1) % n) * 2 + 1];
      ctx.quadraticCurveTo(ox + x, oy + y, ox + (x + nx) / 2, oy + (y + ny) / 2);
    }
    ctx.closePath();
  }

  function drawPebble(ctx, p) {
    var pts = p.pts, n = pts.length / 2, k, c = p.col;
    ctx.beginPath();
    smoothPoly(ctx, pts, n, p.x + p.r * 0.2, p.y + p.r * 0.28);
    ctx.fillStyle = 'rgba(20,14,8,0.34)';
    ctx.fill();
    ctx.beginPath();
    smoothPoly(ctx, pts, n, p.x, p.y);
    ctx.fillStyle = 'rgb(' + (c[0] + p.l) + ',' + (c[1] + p.l) + ',' + (c[2] + p.l) + ')';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p.x - p.r * 0.22, p.y - p.r * 0.26, p.r * 0.42, p.r * 0.3, -0.6, 0, TAU);
    ctx.fillStyle = 'rgba(255,250,240,0.2)';
    ctx.fill();
  }

  function drawTwig(ctx, t) {
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t.x0 + t.w * 0.5, t.y0 + t.w * 0.7);
    ctx.quadraticCurveTo(t.cx + t.w * 0.5, t.cy + t.w * 0.7, t.x1 + t.w * 0.5, t.y1 + t.w * 0.7);
    ctx.strokeStyle = 'rgba(20,14,8,0.3)'; ctx.lineWidth = t.w; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(t.x0, t.y0); ctx.quadraticCurveTo(t.cx, t.cy, t.x1, t.y1);
    ctx.strokeStyle = 'rgb(' + t.col[0] + ',' + t.col[1] + ',' + t.col[2] + ')'; ctx.lineWidth = t.w; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,220,0.22)'; ctx.lineWidth = t.w * 0.32; ctx.stroke();
  }

  function leafPath(ctx, l) {
    var h = l.len / 2, w = l.len * l.wid;
    ctx.beginPath();
    ctx.moveTo(-h, 0);
    ctx.bezierCurveTo(-h * 0.4, -w, h * 0.5, -w * 0.9, h, l.curl * w);
    ctx.bezierCurveTo(h * 0.5, w * 0.9, -h * 0.4, w, -h, 0);
    ctx.closePath();
  }
  function drawLeaf(ctx, l) {
    var c = l.col;
    ctx.save();
    ctx.translate(l.x + 0.6, l.y + 0.9); ctx.rotate(l.rot);
    leafPath(ctx, l); ctx.fillStyle = 'rgba(20,14,8,0.3)'; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(l.x, l.y); ctx.rotate(l.rot);
    leafPath(ctx, l);
    ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; ctx.fill();
    ctx.strokeStyle = 'rgba(60,38,20,0.55)'; ctx.lineWidth = 0.22;
    ctx.beginPath(); ctx.moveTo(-l.len / 2, 0); ctx.quadraticCurveTo(0, l.curl * l.len * l.wid * 0.5, l.len / 2, l.curl * l.len * l.wid);
    ctx.stroke();
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    for (var k = -3; k <= 3; k++) {
      if (k === 0) continue;
      var bx = k / 4 * l.len / 2;
      ctx.moveTo(bx, 0); ctx.lineTo(bx + l.len * 0.09, -l.len * l.wid * 0.55);
      ctx.moveTo(bx, 0); ctx.lineTo(bx + l.len * 0.09, l.len * l.wid * 0.55);
    }
    ctx.stroke();
    ctx.restore();
  }

  var PELLET_COLS = ['#9c8362', '#ab9370', '#8b7355', '#b8a17c', '#7f684c', '#a58d6b'];
  var NPC = PELLET_COLS.length;
  function pelletColor(shade) { return PELLET_COLS[(shade * NPC) | 0] || PELLET_COLS[0]; }

  /* An irregular grain rather than a disc; the shape is fixed by the grain's index. */
  function grainPath(ctx, x, y, r, i) {
    var n = 5 + (i >> 2) % 3, a0 = (i * 0.618034) % 1 * TAU;
    for (var k = 0; k < n; k++) {
      var h = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; h -= Math.floor(h);
      var a = a0 + (k + (h - 0.5) * 0.5) / n * TAU, rr = r * (0.74 + 0.42 * h);
      if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  /* ---------- baked ground image ---------- */

  Ground.prototype.bake = function () {
    var W = this.world, sc = this.scale, seed = this.seed, x, y, i;
    // low-frequency soil colour at half a pixel per millimetre
    var bw = Math.ceil(W.w / 2), bh = Math.ceil(W.h / 2);
    var base = makeCanvas(bw, bh), bctx = base.getContext('2d');
    var img = bctx.createImageData(bw, bh), d = img.data, p = 0;
    for (y = 0; y < bh; y++) {
      for (x = 0; x < bw; x++) {
        var n1 = fbm(x / 105, y / 105, seed + 1, 4);
        var n2 = fbm(x / 23, y / 23, seed + 51, 3);
        var n3 = vnoise(x / 3.2, y / 3.2, seed + 97);
        var t = 0.5 + (n1 - 0.5) * 1.25 + (n2 - 0.5) * 0.55 + (n3 - 0.5) * 0.14;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        d[p++] = 106 + 62 * t; d[p++] = 86 + 54 * t; d[p++] = 62 + 46 * t; d[p++] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);

    var gw = W.w * sc, gh = W.h * sc;
    var g = this.canvas = makeCanvas(gw, gh), ctx = this.ctx = g.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, 0, 0, gw, gh);

    // fine grain
    var gi = ctx.getImageData(0, 0, gw, gh), gd = gi.data, n = gw * gh, s = (seed * 2654435761) >>> 0;
    for (i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      var v = ((s >>> 24) - 128) * 0.17, k4 = i * 4;
      gd[k4] += v; gd[k4 + 1] += v; gd[k4 + 2] += v * 0.9;
    }
    ctx.putImageData(gi, 0, 0);

    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    var rng = this.rng;
    // dark flecks of organic matter
    ctx.fillStyle = 'rgba(40,28,18,0.4)';
    for (i = 0; i < 5200; i++) {
      var fx = rng.range(0, W.w), fy = rng.range(0, W.h), fs = rng.range(0.25, 0.7);
      ctx.fillRect(fx, fy, fs, fs * rng.range(0.6, 1.6));
    }
    // pale mineral grains
    ctx.fillStyle = 'rgba(232,220,196,0.38)';
    for (i = 0; i < 4200; i++) ctx.fillRect(rng.range(0, W.w), rng.range(0, W.h), 0.45, 0.45);

    this.bakeMound(ctx);
    for (i = 0; i < this.leaves.length; i++) drawLeaf(ctx, this.leaves[i]);
    for (i = 0; i < this.twigs.length; i++) drawTwig(ctx, this.twigs[i]);
    for (i = 0; i < this.pebbles.length; i++) drawPebble(ctx, this.pebbles[i]);

    // the refuse pile sits on slightly stained ground
    var mg = ctx.createRadialGradient(W.middenX, W.middenY, 2, W.middenX, W.middenY, 26);
    mg.addColorStop(0, 'rgba(48,36,26,0.3)'); mg.addColorStop(1, 'rgba(48,36,26,0)');
    ctx.fillStyle = mg; ctx.fillRect(W.middenX - 26, W.middenY - 26, 52, 52);

    // the patch fades out at its edges
    var e = 26, grad;
    grad = ctx.createLinearGradient(0, 0, e, 0); grad.addColorStop(0, 'rgba(26,20,14,0.6)'); grad.addColorStop(1, 'rgba(26,20,14,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, e, W.h);
    grad = ctx.createLinearGradient(W.w, 0, W.w - e, 0); grad.addColorStop(0, 'rgba(26,20,14,0.6)'); grad.addColorStop(1, 'rgba(26,20,14,0)');
    ctx.fillStyle = grad; ctx.fillRect(W.w - e, 0, e, W.h);
    grad = ctx.createLinearGradient(0, 0, 0, e); grad.addColorStop(0, 'rgba(26,20,14,0.6)'); grad.addColorStop(1, 'rgba(26,20,14,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W.w, e);
    grad = ctx.createLinearGradient(0, W.h, 0, W.h - e); grad.addColorStop(0, 'rgba(26,20,14,0.6)'); grad.addColorStop(1, 'rgba(26,20,14,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, W.h - e, W.w, e);

    this.syncPellets();
  };

  Ground.prototype.bakeMound = function (ctx) {
    var W = this.world, nx = W.nestX, ny = W.nestY, R = C.nest.moundR * 1.3, g;
    // shadow side of the crater rim, then the pale excavated soil itself
    g = ctx.createRadialGradient(nx + 3, ny + 4, R * 0.25, nx + 3, ny + 4, R * 1.05);
    g.addColorStop(0, 'rgba(40,28,16,0)'); g.addColorStop(0.55, 'rgba(40,28,16,0.28)'); g.addColorStop(1, 'rgba(40,28,16,0)');
    ctx.fillStyle = g; ctx.fillRect(nx - R * 1.3, ny - R * 1.3, R * 2.6, R * 2.6);
    g = ctx.createRadialGradient(nx, ny, 0, nx, ny, R);
    g.addColorStop(0, 'rgba(86,66,44,0.75)');
    g.addColorStop(0.16, 'rgba(150,126,92,0.8)');
    g.addColorStop(0.42, 'rgba(196,172,134,0.72)');
    g.addColorStop(0.75, 'rgba(184,160,122,0.4)');
    g.addColorStop(1, 'rgba(180,156,120,0)');
    ctx.fillStyle = g; ctx.fillRect(nx - R, ny - R, R * 2, R * 2);
    g = ctx.createRadialGradient(nx - 4, ny - 5, R * 0.2, nx - 4, ny - 5, R * 0.8);
    g.addColorStop(0, 'rgba(255,244,220,0)'); g.addColorStop(0.6, 'rgba(255,244,220,0.14)'); g.addColorStop(1, 'rgba(255,244,220,0)');
    ctx.fillStyle = g; ctx.fillRect(nx - R, ny - R, R * 2, R * 2);
  };

  /* Stamp any soil grains dropped since the last call into the baked image. */
  Ground.prototype.syncPellets = function () {
    var p = this.world.pellets, ctx = this.ctx, sc = this.scale;
    if (this.pelletsBaked >= p.length) return;
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    for (var i = this.pelletsBaked; i < p.length; i += 4) {
      var r = p[i + 2];
      ctx.fillStyle = 'rgba(30,20,10,0.3)';
      ctx.beginPath(); ctx.arc(p[i] + r * 0.3, p[i + 1] + r * 0.4, r, 0, TAU); ctx.fill();
      ctx.fillStyle = pelletColor(p[i + 3]);
      ctx.beginPath(); ctx.arc(p[i], p[i + 1], r, 0, TAU); ctx.fill();
    }
    this.pelletsBaked = p.length;
  };

  /* ---------- fine detail that only shows when zoomed in ---------- */

  Ground.prototype.buildTiles = function () {
    var S = 256, rng = this.rng, t = makeCanvas(S, S), ctx = t.getContext('2d'), i;
    var img = ctx.createImageData(S, S), d = img.data;
    for (i = 0; i < S * S; i++) {
      var v = rng.next();
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v < 0.5 ? 20 : 255;
      d[i * 4 + 3] = Math.abs(v - 0.5) * 34;
    }
    ctx.putImageData(img, 0, 0);
    // individual sand grains, wrapped so the tile repeats without seams
    for (i = 0; i < 760; i++) {
      var x = rng.range(0, S), y = rng.range(0, S), r = rng.range(0.8, 3.1), light = rng.next() < 0.55;
      var a = rng.range(0.07, 0.22), sq = rng.range(0.7, 1), rot = rng.range(0, TAU);
      for (var ox = -S; ox <= S; ox += S) {
        for (var oy = -S; oy <= S; oy += S) {
          if (x + ox < -6 || x + ox > S + 6 || y + oy < -6 || y + oy > S + 6) continue;
          ctx.fillStyle = 'rgba(28,18,10,' + (a * 0.9) + ')';
          ctx.beginPath(); ctx.ellipse(x + ox + r * 0.3, y + oy + r * 0.4, r, r * sq, rot, 0, TAU); ctx.fill();
          ctx.fillStyle = light ? 'rgba(236,222,196,' + a + ')' : 'rgba(92,72,52,' + a * 1.3 + ')';
          ctx.beginPath(); ctx.ellipse(x + ox, y + oy, r, r * sq, rot, 0, TAU); ctx.fill();
        }
      }
    }
    this.tile = t;
    this.tilePxPerMm = 20;
    this.pattern = null;
  };

  /* ---------- per-frame drawing ---------- */

  Ground.prototype.draw = function (ctx, Z, ox, oy, W, H, view, zCss) {
    var Wd = this.world, sc = this.scale;
    // visible part of the world, clamped to the patch
    var x0 = Math.max(0, view.x0), y0 = Math.max(0, view.y0);
    var x1 = Math.min(Wd.w, view.x1), y1 = Math.min(Wd.h, view.y1);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, x0 * sc, y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc,
      x0 * Z + ox, y0 * Z + oy, (x1 - x0) * Z, (y1 - y0) * Z);

    if (zCss > 3.2) {
      var alpha = Math.min(1, (zCss - 3.2) / 6);
      if (!this.pattern) this.pattern = ctx.createPattern(this.tile, 'repeat');
      var ts = Z / this.tilePxPerMm, tp = this.tilePxPerMm;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.setTransform(ts, 0, 0, ts, ox, oy);
      ctx.fillStyle = this.pattern;
      ctx.fillRect(x0 * tp, y0 * tp, (x1 - x0) * tp, (y1 - y0) * tp);
      ctx.restore();

      // redraw nearby scenery crisply over the blurred baked version
      ctx.setTransform(Z, 0, 0, Z, ox, oy);
      var i, m = 6;
      for (i = 0; i < this.leaves.length; i++) {
        var l = this.leaves[i];
        if (l.x > x0 - 14 && l.x < x1 + 14 && l.y > y0 - 14 && l.y < y1 + 14) drawLeaf(ctx, l);
      }
      for (i = 0; i < this.twigs.length; i++) {
        var t = this.twigs[i];
        if (t.mx > x0 - t.r && t.mx < x1 + t.r && t.my > y0 - t.r && t.my < y1 + t.r) drawTwig(ctx, t);
      }
      for (i = 0; i < this.pebbles.length; i++) {
        var p = this.pebbles[i];
        if (p.x > x0 - m && p.x < x1 + m && p.y > y0 - m && p.y < y1 + m) drawPebble(ctx, p);
      }
      this.drawPelletsLive(ctx, x0, y0, x1, y1);
    }
  };

  Ground.prototype.drawPelletsLive = function (ctx, x0, y0, x1, y1) {
    var p = this.world.pellets, n = p.length, i, b;
    // skip quickly when the mound is nowhere near the view
    var W = this.world, R = C.nest.moundR * 2.2;
    if (W.nestX < x0 - R || W.nestX > x1 + R || W.nestY < y0 - R || W.nestY > y1 + R) return;
    ctx.fillStyle = 'rgba(26,17,8,0.38)';
    ctx.beginPath();
    for (i = 0; i < n; i += 4) {
      var x = p[i], y = p[i + 1], r = p[i + 2];
      if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) continue;
      grainPath(ctx, x + r * 0.32, y + r * 0.44, r, i);
    }
    ctx.fill();
    for (b = 0; b < NPC; b++) {
      ctx.fillStyle = PELLET_COLS[b];
      ctx.beginPath();
      for (i = 0; i < n; i += 4) {
        if (((p[i + 3] * NPC) | 0) !== b) continue;
        var px = p[i], py = p[i + 1], pr = p[i + 2];
        if (px < x0 - 1 || px > x1 + 1 || py < y0 - 1 || py > y1 + 1) continue;
        grainPath(ctx, px, py, pr, i);
      }
      ctx.fill();
    }
    // the lit side of each grain
    ctx.fillStyle = 'rgba(255,244,220,0.2)';
    ctx.beginPath();
    for (i = 0; i < n; i += 4) {
      var qx = p[i], qy = p[i + 1], qr = p[i + 2];
      if (qx < x0 - 1 || qx > x1 + 1 || qy < y0 - 1 || qy > y1 + 1) continue;
      ctx.moveTo(qx - qr * 0.2 + qr * 0.45, qy - qr * 0.28);
      ctx.ellipse(qx - qr * 0.2, qy - qr * 0.28, qr * 0.45, qr * 0.3, -0.6, 0, TAU);
    }
    ctx.fill();
  };

  AH.Ground = Ground;
  AH.pelletColor = pelletColor;
})(typeof window !== 'undefined' ? window : globalThis);
