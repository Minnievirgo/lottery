(function () {
  const params = new URLSearchParams(location.search);
  const drawId = params.get('d');
  const $ = id => document.getElementById(id);

  const elLoading = $('loading'), elMain = $('main'), elResult = $('result'), elMsg = $('msg');
  const elTitle = $('drawTitle'), elDesc = $('drawDesc');
  const elName = $('nameInput'), elBtn = $('drawBtn'), elHint = $('hint');
  const elResultCard = $('resultCard'), elResultName = $('resultName'), elResultDesc = $('resultDesc');
  const elAgain = $('againBtn'), elBack = $('backBtn'), elMsgText = $('msgText'), elMsgIcon = $('msgIcon');

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  if (!drawId) {
    hide(elLoading);
    show(elMsg);
    elMsgIcon.textContent = '!';
    elMsgText.textContent = '链接缺少抽签标识，请从管理员处获取正确的分享链接。';
    hide(elBack);
    return;
  }

  // 加载抽签信息
  fetch('/api/draws/' + encodeURIComponent(drawId))
    .then(r => r.json())
    .then(d => {
      hide(elLoading);
      if (d.error === 'not_found') {
        show(elMsg);
        elMsgText.textContent = '未找到该抽签活动，可能已被删除。';
        hide(elBack);
        return;
      }
      elTitle.textContent = d.title || '抽签';
      elDesc.textContent = d.description || '';
      if (d.status !== 'open') {
        show(elMsg);
        elMsgIcon.textContent = '×';
        elMsgText.textContent = '本场抽签已结束，暂不可参与。';
        hide(elBack);
        return;
      }
      show(elMain);
      elName.focus();
    })
    .catch(() => {
      hide(elLoading);
      show(elMsg);
      elMsgText.textContent = '加载失败，请检查网络后刷新。';
    });

  function doDraw() {
    const name = elName.value.trim();
    if (!name) {
      elHint.textContent = '请先输入您的姓名';
      elHint.style.color = '#ff9b9b';
      elName.focus();
      return;
    }
    elBtn.disabled = true;
    elBtn.querySelector('.btn-text').textContent = '抽签中…';
    elHint.style.color = '';
    elHint.textContent = '点击按钮，看看你的结果';

    fetch('/api/draws/' + encodeURIComponent(drawId) + '/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
      .then(r => r.json())
      .then(r => {
        elBtn.disabled = false;
        elBtn.querySelector('.btn-text').textContent = '开始抽签';
        hide(elMain);

        if (r.ok) {
          const res = r.result;
          const accent = res.color || '#8b7bff';
          elResultCard.style.setProperty('--accent', accent);
          elResultName.textContent = res.name;
          elResultDesc.textContent = res.description || '';
          show(elResult);
          fireConfetti();
          return;
        }
        if (r.alreadyDrawn) {
          const accent = r.result && r.result.color ? r.result.color : '#ffd166';
          elResultCard.style.setProperty('--accent', accent);
          elResultName.textContent = r.result ? r.result.name : '—';
          elResultDesc.textContent = '您已经抽过啦，这是您的结果～';
          show(elResult);
          hide(elAgain);
          return;
        }
        if (r.soldOut) {
          show(elMsg);
          elMsgIcon.textContent = '∅';
          elMsgText.textContent = '本场抽签名额已抽完，感谢参与！';
          hide(elBack);
          return;
        }
        if (r.closed) {
          show(elMsg);
          elMsgIcon.textContent = '×';
          elMsgText.textContent = '本场抽签已结束。';
          hide(elBack);
          return;
        }
        show(elMsg);
        elMsgText.textContent = (r.message || '抽签失败，请稍后重试。');
        hide(elBack);
      })
      .catch(() => {
        elBtn.disabled = false;
        elBtn.querySelector('.btn-text').textContent = '开始抽签';
        show(elMsg);
        elMsgText.textContent = '网络异常，请稍后重试。';
      });
  }

  elBtn.addEventListener('click', doDraw);
  elName.addEventListener('keydown', e => { if (e.key === 'Enter') doDraw(); });
  elAgain.addEventListener('click', () => {
    hide(elResult);
    elName.value = '';
    show(elMain);
    elName.focus();
  });
  elBack.addEventListener('click', () => location.reload());

  // ---- 撒花动效（纯 Canvas，无依赖）----
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  let particles = [], raf = null;
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize();
  addEventListener('resize', resize);

  function fireConfetti() {
    const colors = ['#8b7bff', '#5ad1ff', '#ffd27a', '#ffffff', '#c4b5fd'];
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: innerWidth / 2, y: innerHeight / 2,
        vx: (Math.random() - 0.5) * 14, vy: Math.random() * -14 - 4,
        g: 0.35 + Math.random() * 0.2,
        size: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length], life: 90 + Math.random() * 40
      });
    }
    if (!raf) loop();
  }
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 60));
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 40);
    if (particles.length) { raf = requestAnimationFrame(loop); }
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); raf = null; }
  }
})();

// 星系与星空背景已统一抽离到 /cosmic-bg.js（与用户页共用，index.html 中先于本脚本引入）
