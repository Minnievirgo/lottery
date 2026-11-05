// 宇宙星系背景（金核螺旋星系 + 星空闪烁 + 偶发流星）
// 用户页与管理后台共用，依赖 #galaxy 和 #stars 两个 canvas。
(function galaxy() {
  const cv = document.getElementById('galaxy');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, cx = 0, cy = 0, R = 0, parts = [], neb = [], rot = 0;

  function resize() {
    w = window.innerWidth; h = window.innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h * 0.4; R = Math.max(w, h) * 0.62;
    const arms = 3, N = 1500;
    parts = [];
    for (let i = 0; i < N; i++) {
      const arm = i % arms;
      const t = Math.pow(Math.random(), 0.6);
      const radius = t * R * (0.96 + Math.random() * 0.08);
      const spread = (Math.random() - 0.5) * 0.55 * (1 - t * 0.5);
      const ang = arm * (Math.PI * 2 / arms) + t * Math.PI * 2 * 1.6 + spread + (Math.random() - 0.5) * 0.25;
      const col = t < 0.15 ? '255,228,150' : (t < 0.5 ? '205,175,255' : '120,170,255');
      parts.push({ radius, ang, col, r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.3, tw: Math.random() * 0.02 + 0.005, ph: Math.random() * 6.28 });
    }
    neb = [
      { x: cx, y: cy, r: R * 0.5, c: '150,130,255', a: 0.07 },
      { x: cx + R * 0.22, y: cy + R * 0.08, r: R * 0.45, c: '90,160,255', a: 0.06 },
      { x: cx - R * 0.25, y: cy - R * 0.15, r: R * 0.4, c: '120,90,220', a: 0.05 }
    ];
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const n of neb) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, 'rgba(' + n.c + ',' + n.a + ')');
      g.addColorStop(1, 'rgba(' + n.c + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.28); ctx.fill();
    }
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22);
    cg.addColorStop(0, 'rgba(255,238,185,0.55)');
    cg.addColorStop(0.45, 'rgba(255,212,140,0.18)');
    cg.addColorStop(1, 'rgba(255,212,140,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, 6.28); ctx.fill();
    rot += 0.0009;
    for (const p of parts) {
      p.ph += p.tw;
      const ang = p.ang + rot;
      const x = cx + Math.cos(ang) * p.radius;
      const y = cy + Math.sin(ang) * p.radius * 0.82;
      const al = p.a * (0.6 + 0.4 * Math.sin(p.ph));
      ctx.globalAlpha = al; ctx.fillStyle = 'rgb(' + p.col + ')';
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.28); ctx.fill();
      if (p.r > 1.1) { ctx.globalAlpha = al * 0.25; ctx.beginPath(); ctx.arc(x, y, p.r * 2.4, 0, 6.28); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  frame();
})();

(function starfield() {
  const cv = document.getElementById('stars');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, stars = [], shooters = [];

  function resize() {
    w = window.innerWidth; h = window.innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(120, Math.round((w * h) / 5500));
    stars = [];
    for (let i = 0; i < count; i++) {
      const tint = Math.random();
      stars.push({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random() * 0.6 + 0.3,
        tw: Math.random() * 0.02 + 0.004,
        ph: Math.random() * Math.PI * 2,
        vx: (Math.random() - 0.5) * 0.06,
        vy: Math.random() * 0.08 + 0.015,
        hue: tint < 0.16 ? '#5ad1ff' : (tint < 0.30 ? '#c4b5fd' : '#ffffff')
      });
    }
  }

  function spawnShooter() {
    if (Math.random() < 0.012 && shooters.length < 2) {
      const left = Math.random() < 0.5;
      shooters.push({
        x: left ? -60 : w + 60, y: Math.random() * h * 0.45,
        vx: (left ? 1 : -1) * (7 + Math.random() * 5), vy: 2.5 + Math.random() * 2.5,
        life: 1
      });
    }
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.ph += s.tw; s.x += s.vx; s.y += s.vy;
      if (s.y > h + 2) { s.y = -2; s.x = Math.random() * w; }
      if (s.x > w + 2) s.x = -2; else if (s.x < -2) s.x = w + 2;
      const al = s.a * (0.55 + 0.45 * Math.sin(s.ph));
      ctx.globalAlpha = al; ctx.fillStyle = s.hue;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      if (s.r > 1.1) {
        ctx.globalAlpha = al * 0.25;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    spawnShooter();
    for (let i = shooters.length - 1; i >= 0; i--) {
      const m = shooters[i];
      m.x += m.vx; m.y += m.vy; m.life -= 0.012;
      const tx = m.x - m.vx * 7, ty = m.y - m.vy * 7;
      const g = ctx.createLinearGradient(tx, ty, m.x, m.y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,' + Math.max(0, m.life) + ')');
      ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(m.x, m.y); ctx.stroke();
      if (m.life <= 0 || m.x < -100 || m.x > w + 100 || m.y > h + 100) shooters.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  frame();
})();
