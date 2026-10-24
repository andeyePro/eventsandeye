// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../../LICENSE.
// The andeye mark, drawn live from the brand geometry (viewBox 0 0 365 235,
// stroke 17, translate 18.0915,17.9436) with an eyelid wink: only the two
// lid cubics' control points move; the corners and the left flourish stay
// fixed.
//
// The iris sits centred in the eye aperture, its circle top and bottom
// meeting the aperture's high and low points, and is CLIPPED by the aperture
// between the two lids — so a closing lid crops it from view exactly like a
// real eyelid over an iris.
//
// andeyeEye(el, opts) mounts into an <svg> element:
//   colour : stroke colour (default the brand blue #56C1FF)
//   iris   : 'none' | 'fill' | 'stroke'   (stroke = same 17px line width)
//   glyph  : null | 'clock' | 'code' | 'tick' | 'people' | 'calendar'   (drawn inside the iris)
//   blink  : true = a few natural blinks, then still (respects prefers-reduced-motion)
(function (global) {
  'use strict';
  var T = { x: 18.0915, y: 17.9436 };
  function P(x, y) { return { x: x + T.x, y: y + T.y }; }
  // [p0, c1, c2, p1] per cubic, pre-translated into the viewBox.
  var OPEN = [
    [P(145, 157), P(-95, -27), P(177, -2), P(59, 76)],
    [P(59, 76), P(-37.95, 140.08), P(54, 236), P(122, 137)],
    [P(122, 137), P(205.86, 14.91), P(311, 137), P(311, 137)],
    [P(311, 137), P(311, 137), P(232, 221), P(145, 157)],
  ];
  var W = 17;   // the brand stroke width
  // The eye's true LEFT CORNER: where the two strokes of the & cross — the
  // point ON curve 0 at u=0.03565 (numerically, curve 1 meets it at v≈0.996
  // within 0.01px). Both lids hinge HERE, and the tail retracts ALONG ITS
  // OWN CURVE (a de Casteljau trim of curve 0's leading arc, never an
  // endpoint drag, which would swell the &'s top loop). The winking mark is a single loop, no tail left behind;
  // the tail exists only as the draw-on's starting point.
  var CROSS = P(121.243, 138.111);
  var TAIL_CROSS_U = 0.03565;
  // The trailing [u, 1] part of a cubic — the same curve minus its lead-in.
  function trailing(c, u) {
    function m(a, b) { return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; }
    var q0 = m(c[0], c[1]), q1 = m(c[1], c[2]), q2 = m(c[2], c[3]);
    var r0 = m(q0, q1), r1 = m(q1, q2);
    return [m(r0, r1), r1, q2, c[3]];
  }
  // Closed-pose tuning: lift 0, smooth 1. Any more lift and the lower lid
  // crosses above the upper; any less smoothing and the upper lid overshoots
  // the lower. andeyeEye.tune() adjusts from these defaults.
  var TUNE = { lift: 0, smooth: 1 };
  function closedPose() {
    return {
      top: { c1: P(171.03, 187.18 - 22 * TUNE.smooth), c2: P(258.9, 178.05 - 6 * TUNE.smooth) },
      bot: { c1: P(311, 141 - 6 * TUNE.lift), c2: P(220, 190 - 26 * TUNE.lift) },
    };
  }

  function lerp(a, b, w) { return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }; }
  function cubics(wink) {
    var closed = closedPose();
    var c = OPEN.map(function (seg) { return seg.slice(); });
    c[0] = trailing(c[0], TAIL_CROSS_U * wink);   // tail retracts along itself
    c[2] = [c[2][0], lerp(c[2][1], closed.top.c1, wink), lerp(c[2][2], closed.top.c2, wink), c[2][3]];
    c[3] = [c[3][0], lerp(c[3][1], closed.bot.c1, wink), lerp(c[3][2], closed.bot.c2, wink),
            lerp(c[3][3], CROSS, wink)];
    return c;
  }
  function seg(c) {
    return 'C' + c[1].x.toFixed(2) + ',' + c[1].y.toFixed(2)
      + ' ' + c[2].x.toFixed(2) + ',' + c[2].y.toFixed(2)
      + ' ' + c[3].x.toFixed(2) + ',' + c[3].y.toFixed(2);
  }
  // Each cubic renders as its OWN path:
  // the eye's right corner is a degenerate cusp (two control points sit on
  // the endpoint), and a single compound path with round joins grows a spur
  // there on the first wink frames — per-segment strokes with round caps
  // meet cleanly instead.
  function segmentPaths(cs) {
    return cs.map(function (c) {
      return 'M' + c[0].x.toFixed(2) + ',' + c[0].y.toFixed(2) + seg(c);
    });
  }
  // The APERTURE (between the two lids): top lid forward, bottom lid onward —
  // cubics 2 and 3 already run corner→corner→back, forming the closed lens.
  function aperturePath(cs) {
    return 'M' + cs[2][0].x.toFixed(2) + ',' + cs[2][0].y.toFixed(2)
      + seg(cs[2]) + seg(cs[3]) + 'Z';
  }
  function pointOn(c, u) {
    var v = 1 - u, a = v * v * v, b = 3 * v * v * u, d = 3 * v * u * u, e = u * u * u;
    return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
             y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
  }
  // Iris geometry from the OPEN pose: centred between the aperture corners,
  // radius = half the aperture's vertical extent (top of circle meets the
  // lid's high point, bottom meets the low point).
  function irisGeometry() {
    var open = cubics(0);
    var hi = Infinity, lo = -Infinity;
    for (var i = 0; i <= 48; i++) {
      hi = Math.min(hi, pointOn(open[2], i / 48).y);
      lo = Math.max(lo, pointOn(open[3], i / 48).y);
    }
    var cx = (open[2][0].x + open[2][3].x) / 2;
    return { cx: cx, cy: (hi + lo) / 2, r: (lo - hi) / 2 };
  }

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function andeyeEye(svg, opts) {
    opts = opts || {};
    var colour = opts.colour || '#56C1FF';
    var iris = opts.iris || 'none';
    var glyph = opts.glyph || null;
    svg.setAttribute('viewBox', '0 0 365 235');
    svg.setAttribute('fill', 'none');
    var uid = 'eye' + Math.random().toString(36).slice(2, 8);

    var clip = null, irisGroup = null, g = irisGeometry();
    if (iris !== 'none') {
      clip = el('clipPath', { id: uid }, el('defs', {}, svg));
      var clipShape = el('path', { d: aperturePath(cubics(0)) }, clip);
      irisGroup = el('g', { 'clip-path': 'url(#' + uid + ')' }, svg);
      // The iris appears AFTER the mark has drawn on: hidden while a draw-on is in flight, fading in the moment the
      // stroke completes. Pages that never draw on (blink only) keep it
      // visible from the start.
      irisGroup.style.transition = 'opacity 0.35s ease';
      if (iris === 'fill') {
        el('circle', { cx: g.cx, cy: g.cy, r: g.r, fill: colour }, irisGroup);
      } else {
        // Stroke variant: the 17px line straddles the radius, so pull the
        // circle in by half a stroke to keep its OUTER edge on the lid
        // high/low points.
        el('circle', { cx: g.cx, cy: g.cy, r: g.r - W / 2, stroke: colour,
                       'stroke-width': W, fill: 'none' }, irisGroup);
      }
      if (glyph === 'clock') {
        // Hands read against a FILLED iris in the page background colour;
        // against a stroke iris they share the mark's line.
        var hand = iris === 'fill' ? (opts.background || '#0c0f16') : colour;
        el('path', { d: 'M' + g.cx + ',' + g.cy + ' L' + g.cx + ',' + (g.cy - g.r * 0.62)
                       + ' M' + g.cx + ',' + g.cy + ' L' + (g.cx + g.r * 0.45) + ',' + (g.cy + g.r * 0.28),
                     stroke: hand, 'stroke-width': W * 0.7, 'stroke-linecap': 'round' }, irisGroup);
      } else if (glyph === 'tick') {
        // A confirmation tick across the iris, in the page colour on a filled iris.
        var tickCol = iris === 'fill' ? (opts.background || '#0c0f16') : colour;
        el('path', { d: 'M' + (g.cx - g.r * 0.45) + ',' + (g.cy + g.r * 0.02)
                       + ' L' + (g.cx - g.r * 0.1) + ',' + (g.cy + g.r * 0.36)
                       + ' L' + (g.cx + g.r * 0.48) + ',' + (g.cy - g.r * 0.34),
                     stroke: tickCol, 'stroke-width': W * 0.85, 'stroke-linecap': 'round',
                     'stroke-linejoin': 'round', fill: 'none' }, irisGroup);
      } else if (glyph === 'people') {
        // A small group: two people behind, one in front, cut out in the page colour on a filled iris.
        // Each is a head and rounded shoulders; the front one is outlined in the iris colour so the
        // three stay distinct at favicon size.
        var pc = iris === 'fill' ? (opts.background || '#0c0f16') : colour;
        var gap = iris === 'fill' ? colour : (opts.background || '#0c0f16');
        var person = function (x, headY, headR, w, top, bottom, ring) {
          var attrs = ring ? { fill: pc, stroke: gap, 'stroke-width': g.r * 0.07 } : { fill: pc };
          el('path', Object.assign({ d: 'M' + (x - w) + ',' + bottom + ' V' + (top + w * 0.75)
                       + ' A' + w + ',' + (w * 0.75) + ' 0 0 1 ' + (x + w) + ',' + (top + w * 0.75)
                       + ' V' + bottom + ' Z' }, attrs), irisGroup);
          el('circle', Object.assign({ cx: x, cy: headY, r: headR }, attrs), irisGroup);
        };
        var b = g.cy + g.r * 0.52;
        person(g.cx - g.r * 0.4, g.cy - g.r * 0.2, g.r * 0.14, g.r * 0.22, g.cy + g.r * 0.02, b, false);
        person(g.cx + g.r * 0.4, g.cy - g.r * 0.2, g.r * 0.14, g.r * 0.22, g.cy + g.r * 0.02, b, false);
        person(g.cx, g.cy - g.r * 0.3, g.r * 0.18, g.r * 0.3, g.cy - g.r * 0.02, b + g.r * 0.04, true);
      } else if (glyph === 'calendar') {
        // A calendar page: outline, header rule and two binder rings, in the page colour on a filled iris.
        var cc = iris === 'fill' ? (opts.background || '#0c0f16') : colour;
        var cw = W * 0.6, x0 = g.cx - g.r * 0.46, x1 = g.cx + g.r * 0.46, y0 = g.cy - g.r * 0.36, y1 = g.cy + g.r * 0.44;
        el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: g.r * 0.1,
                     stroke: cc, 'stroke-width': cw, fill: 'none' }, irisGroup);
        el('path', { d: 'M' + x0 + ',' + (g.cy - g.r * 0.1) + ' H' + x1
                       + ' M' + (g.cx - g.r * 0.22) + ',' + (g.cy - g.r * 0.52) + ' V' + (g.cy - g.r * 0.24)
                       + ' M' + (g.cx + g.r * 0.22) + ',' + (g.cy - g.r * 0.52) + ' V' + (g.cy - g.r * 0.24),
                     stroke: cc, 'stroke-width': cw, 'stroke-linecap': 'round', fill: 'none' }, irisGroup);
      } else if (glyph === 'code') {
        // A ">" FILLING the circle: two strokes spanning the iris interior.
        var inset = iris === 'fill' ? 0.62 : 0.66;
        var gx = g.cx - g.r * 0.42, gy = g.r * inset;
        var mark = iris === 'fill' ? (opts.background || '#0c0f16') : colour;
        el('path', { d: 'M' + gx + ',' + (g.cy - gy)
                       + ' L' + (g.cx + g.r * 0.5) + ',' + g.cy
                       + ' L' + gx + ',' + (g.cy + gy),
                     stroke: mark, 'stroke-width': W, 'stroke-linecap': 'round',
                     'stroke-linejoin': 'round', fill: 'none' }, irisGroup);
      }
    }
    var outlineGroup = el('g', { stroke: colour, 'stroke-width': W,
                                 'stroke-linecap': 'round', fill: 'none' }, svg);
    var outlineSegs = segmentPaths(cubics(0)).map(function (d) {
      return el('path', { d: d }, outlineGroup);
    });

    // wink 0..1 (eyelid close), draw 0..1 (draw-on reveal by arc length —
    // segments appear in order, the active one partially, via dash tricks).
    // The iris rides the draw: invisible until the stroke completes.
    function setPose(wink, draw) {
      if (irisGroup) irisGroup.style.opacity = (draw != null && draw < 1) ? '0' : '1';
      var cs = cubics(wink);
      var ds = segmentPaths(cs);
      for (var i = 0; i < outlineSegs.length; i++) {
        outlineSegs[i].setAttribute('d', ds[i]);
        if (draw == null || draw >= 1) {
          outlineSegs[i].removeAttribute('stroke-dasharray');
          outlineSegs[i].removeAttribute('stroke-dashoffset');
          outlineSegs[i].style.visibility = '';
        }
      }
      if (draw != null && draw < 1) {
        var lens = outlineSegs.map(function (p) { return p.getTotalLength(); });
        var total = lens.reduce(function (a, b) { return a + b; }, 0);
        var target = total * Math.max(draw, 0);
        for (var j = 0; j < outlineSegs.length; j++) {
          if (target >= lens[j]) {
            outlineSegs[j].removeAttribute('stroke-dasharray');
            outlineSegs[j].style.visibility = '';
            target -= lens[j];
          } else if (target > 0) {
            outlineSegs[j].style.visibility = '';
            outlineSegs[j].setAttribute('stroke-dasharray',
              target + ' ' + (lens[j] - target + 1));
            target = 0;
          } else {
            outlineSegs[j].style.visibility = 'hidden';
          }
        }
      }
      if (clip) clip.firstChild.setAttribute('d', aperturePath(cs));
    }
    function setWink(w) { setPose(w, null); }

    var reduced = global.matchMedia
      && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Page-load draw-on: the pen draws the mark from the tail (~1.2s), and
    // the iris fades in as the stroke completes.
    if (opts.drawOn && !reduced) {
      var drawStart = null;
      function drawFrame(ts) {
        if (!drawStart) drawStart = ts;
        var t = Math.min((ts - drawStart) / 1200, 1);
        setPose(0, t * t * (3 - 2 * t));
        if (t < 1) global.requestAnimationFrame(drawFrame);
      }
      setPose(0, 0);
      global.requestAnimationFrame(drawFrame);
    }
    if (opts.blink !== false && !reduced) {
      // A natural blink: quick close, brief hold, slightly slower open,
      // then quiet for a few seconds. Ease with smoothstep. It stops after
      // a few blinks, so the page does not move indefinitely.
      var next = 1800 + Math.random() * 2500;
      var start = null, phase = 'idle', blinksLeft = 6;
      function smooth(t) { return t * t * (3 - 2 * t); }
      function frame(ts) {
        if (phase === 'idle') {
          if (ts >= next) { phase = 'blink'; start = ts; }
        } else {
          var t = ts - start;
          var w = t < 130 ? smooth(t / 130)
                : t < 190 ? 1
                : t < 360 ? 1 - smooth((t - 190) / 170)
                : 0;
          setWink(w);
          if (t >= 360) {
            if (--blinksLeft === 0) return;
            phase = 'idle'; next = ts + 2600 + Math.random() * 3200;
          }
        }
        global.requestAnimationFrame(frame);
      }
      global.requestAnimationFrame(frame);
    }
    return { setWink: setWink, setPose: setPose, iris: g };
  }
  // Global closed-pose tuning: affects every mounted eye's NEXT pose update
  // (blinking eyes pick it up on the next blink). Values 0..1; see closedPose() for what they move.
  andeyeEye.tune = function (t) {
    if (t && typeof t.lift === 'number') TUNE.lift = t.lift;
    if (t && typeof t.smooth === 'number') TUNE.smooth = t.smooth;
  };
  global.andeyeEye = andeyeEye;
})(window);
