/* A short confetti burst for an admit, drawn on a temporary full-window canvas. No dependencies.
   Skipped entirely under prefers-reduced-motion. Usage: window.cfConfetti(). */
(function () {
  var PIECES = 120;
  var DURATION = 1600;

  function tokens() {
    var css = getComputedStyle(document.documentElement);
    var read = function (name, fallback) { return (css.getPropertyValue(name) || "").trim() || fallback; };
    return [read("--coral", "#cc785c"), read("--success", "#5db872"), read("--accent-amber", "#e8a55a"), read("--accent-teal", "#5db8a6"), read("--ink", "#141413")];
  }

  function cfConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var canvas = document.createElement("canvas");
    var ratio = window.devicePixelRatio || 1;
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
    document.body.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    if (!ctx) { canvas.remove(); return; }
    ctx.scale(ratio, ratio);
    var colors = tokens();
    var pieces = [];
    for (var i = 0; i < PIECES; i++) {
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      var speed = 7 + Math.random() * 9;
      pieces.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.2,
        y: h * 0.62,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 0.4,
        rot: Math.random() * Math.PI,
        w: 5 + Math.random() * 4,
        h: 9 + Math.random() * 6,
        color: colors[i % colors.length],
      });
    }
    var start = performance.now();
    function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, w, h);
      var fade = Math.max(0, 1 - Math.max(0, t - DURATION * 0.6) / (DURATION * 0.4));
      for (var j = 0; j < pieces.length; j++) {
        var p = pieces[j];
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t < DURATION) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  window.cfConfetti = cfConfetti;
})();
