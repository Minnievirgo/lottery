(function () {
  const $ = id => document.getElementById(id);
  const token = localStorage.getItem('lottery_token') || '';
  let editingId = null;
  let currentListDrawId = null;

  const PALETTE = ['#22d3ee', '#a855f7', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#f472b6', '#2dd4bf'];

  function api(path, opts = {}) {
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'x-admin-token': token }, opts.headers || {});
    return fetch(path, opts).then(r => r.json().catch(() => ({})));
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(el) { el.classList.add('hidden'); }
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', e => closeModal(e.target.closest('.modal'))));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModal(m); }));

  // ---- 登录 ----
  function tryLogin(pwd) {
    return fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    }).then(r => r.json());
  }
  $('loginBtn').addEventListener('click', () => {
    const pwd = $('pwd').value;
    tryLogin(pwd).then(res => {
      if (res.ok) {
        localStorage.setItem('lottery_token', res.token);
        location.reload();
      } else { $('loginErr').textContent = res.message || '登录失败'; }
    });
  });
  $('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
  $('logoutBtn').addEventListener('click', () => { localStorage.removeItem('lottery_token'); location.reload(); });

  // 已登录则直接进入面板
  if (token) { $('login').classList.add('hidden'); $('panel').classList.remove('hidden'); loadDraws(); }

  // ---- 列表 ----
  function loadDraws() {
    api('/api/admin/draws').then(res => {
      if (res.draws === undefined) { // 401
        localStorage.removeItem('lottery_token'); location.reload(); return;
      }
      const list = res.draws || [];
      const box = $('drawList'); box.innerHTML = '';
      $('empty').classList.toggle('hidden', list.length > 0);
      list.forEach(d => box.appendChild(renderCard(d)));
    });
  }

  function renderCard(d) {
    const el = document.createElement('div');
    el.className = 'draw-card';
    const open = d.status === 'open';
    el.innerHTML = `
      <div class="dc-top">
        <h4 class="dc-title">${escapeHtml(d.title)}</h4>
        <span class="badge-st ${open ? 'badge-open' : 'badge-closed'}">${open ? '进行中' : '已结束'}</span>
      </div>
      <p class="dc-desc">${escapeHtml(d.description || '')}</p>
      <div class="dc-stats"><div>参与 <b>${d.participantCount}</b></div><div>结果项 <b>${(d.items||[]).length}</b></div></div>
      <div class="dc-actions">
        <button data-act="edit">编辑</button>
        <button data-act="list">名单</button>
        <button data-act="stat">统计</button>
        <button data-act="toggle">${open ? '结束' : '开启'}</button>
        <button data-act="link">复制链接</button>
        <button data-act="del" style="color:var(--danger)">删除</button>
      </div>`;
    el.querySelector('[data-act=edit]').onclick = () => openEdit(d);
    el.querySelector('[data-act=list]').onclick = () => openList(d.id);
    el.querySelector('[data-act=stat]').onclick = () => openStat(d.id);
    el.querySelector('[data-act=toggle]').onclick = () => toggleDraw(d.id, open);
    el.querySelector('[data-act=link]').onclick = () => copyLink(d.id);
    el.querySelector('[data-act=del]').onclick = () => delDraw(d.id);
    return el;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- 创建/编辑 ----
  function itemRow(it) {
    it = it || {};
    const color = it.color || PALETTE[document.querySelectorAll('.item-row').length % PALETTE.length];
    const row = document.createElement('div');
    row.className = 'item-row';
    if (it.id) row.dataset.id = it.id;
    row.innerHTML = `
      <input class="i-name" type="text" placeholder="结果名称" value="${escapeHtml(it.name || '')}" maxlength="20" />
      <input class="i-limit" type="number" placeholder="数量" value="${it.limit == null ? '' : it.limit}" />
      <input class="i-weight" type="number" placeholder="权重" value="${it.weight == null ? 1 : it.weight}" step="0.1" min="0" />
      <input class="i-color" type="color" value="${color}" />
      <button class="del" title="删除">×</button>`;
    row.querySelector('.del').onclick = () => row.remove();
    return row;
  }
  function openEdit(d) {
    editingId = d ? d.id : null;
    $('editTitle').textContent = d ? '编辑抽签' : '新建抽签';
    $('f_title').value = d ? d.title : '';
    $('f_desc').value = d ? (d.description || '') : '';
    $('f_anti').checked = d ? !!d.anti_duplicate : true;
    const box = $('items'); box.innerHTML = '';
    const items = (d && d.items) || [{ name: '一等奖', limit: 1, weight: 1 }, { name: '二等奖', limit: 3, weight: 1 }, { name: '谢谢参与', limit: -1, weight: 1 }];
    items.forEach(it => box.appendChild(itemRow(it)));
    openModal('editModal');
  }
  $('newBtn').onclick = () => openEdit(null);
  $('backupBtn').onclick = () => {
    fetch('/api/admin/backup', { headers: { 'x-admin-token': token } })
      .then(r => r.blob())
      .then(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = '抽签系统完整备份-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('完整备份已下载（含全部抽签与参与名单）');
      })
      .catch(() => toast('备份失败，请重新登录后再试'));
  };
  $('addItem').onclick = () => $('items').appendChild(itemRow());

  // 快速生成「发言顺序签」：输入 N，自动生成 1~N，每签数量 1
  $('genBtn').onclick = () => {
    const n = parseInt($('genNum').value, 10);
    if (!n || n < 1 || n > 999) { toast('请输入 1~999 的数量'); return; }
    const box = $('items'); box.innerHTML = '';
    for (let i = 1; i <= n; i++) {
      box.appendChild(itemRow({ name: String(i), limit: 1, weight: 1, color: PALETTE[(i - 1) % PALETTE.length] }));
    }
    toast('已生成 ' + n + ' 个顺序签（1~' + n + '）');
  };

  $('saveBtn').onclick = () => {
    const title = $('f_title').value.trim();
    if (!title) { toast('请填写活动标题'); return; }
    const items = [];
    document.querySelectorAll('#items .item-row').forEach(r => {
      const name = r.querySelector('.i-name').value.trim();
      if (!name) return;
      let limit = r.querySelector('.i-limit').value.trim();
      limit = (limit === '' || isNaN(limit)) ? -1 : parseInt(limit, 10);
      let weight = parseFloat(r.querySelector('.i-weight').value);
      if (isNaN(weight) || weight <= 0) weight = 1;
      items.push({ id: r.dataset.id || undefined, name, limit, weight, color: r.querySelector('.i-color').value });
    });
    if (!items.length) { toast('请至少添加一个结果项'); return; }
    const payload = {
      title, description: $('f_desc').value.trim(),
      antiDuplicate: $('f_anti').checked, items
    };
    const p = editingId
      ? api('/api/admin/draws/' + editingId, { method: 'PUT', body: JSON.stringify(payload) })
      : api('/api/admin/draws', { method: 'POST', body: JSON.stringify(payload) });
    p.then(res => {
      if (res.ok) { closeModal($('editModal')); toast('已保存'); loadDraws(); }
      else toast('保存失败：' + (res.error || ''));
    });
  };

  // ---- 开关 / 删除 ----
  function toggleDraw(id, open) {
    api('/api/admin/draws/' + id, { method: 'PUT', body: JSON.stringify({ status: open ? 'closed' : 'open' }) })
      .then(() => loadDraws());
  }
  function delDraw(id) {
    if (!confirm('确定删除该抽签活动？参与记录也会一并删除。')) return;
    api('/api/admin/draws/' + id, { method: 'DELETE' }).then(() => { toast('已删除'); loadDraws(); });
  }
  function copyLink(id) {
    const url = location.origin + '/?d=' + encodeURIComponent(id);
    navigator.clipboard.writeText(url).then(() => toast('分享链接已复制：' + url),
      () => { prompt('复制以下链接发给用户：', url); });
  }

  // ---- 名单 ----
  function openList(id) {
    currentListDrawId = id;
    api('/api/admin/draws/' + id + '/participants').then(res => {
      const tb = $('listTbl').querySelector('tbody'); tb.innerHTML = '';
      const list = res.participants || [];
      $('listEmpty').classList.toggle('hidden', list.length > 0);
      list.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.resultName)}</td><td>${new Date(p.drawnAt).toLocaleString('zh-CN', { hour12: false })}</td>`;
        tb.appendChild(tr);
      });
      openModal('listModal');
    });
  }
  $('exportBtn').onclick = () => {
    if (!currentListDrawId) return;
    fetch('/api/admin/draws/' + currentListDrawId + '/export', { headers: { 'x-admin-token': token } })
      .then(r => r.blob())
      .then(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = '名单.csv'; a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  // ---- 统计 ----
  function openStat(id) {
    api('/api/admin/draws/' + id + '/stats').then(res => {
      const box = $('statBody'); box.innerHTML = '';
      const total = res.total || 0;
      const head = document.createElement('p');
      head.style.cssText = 'color:var(--muted);font-size:13px;margin:0 0 16px';
      head.textContent = '总参与人数：' + total;
      box.appendChild(head);
      (res.items || []).forEach(it => {
        const pct = total ? Math.round((it.count / total) * 100) : 0;
        const max = Math.max(1, ...(res.items.map(x => x.count)));
        const w = Math.round((it.count / max) * 100);
        const div = document.createElement('div');
        div.className = 'stat-item';
        const lim = it.limit === -1 ? '不限量' : ('上限 ' + it.limit);
        div.innerHTML = `
          <div class="stat-name"><span style="color:${it.color}">${escapeHtml(it.name)}</span><b>${it.count} 人 · ${lim}</b></div>
          <div class="stat-bar"><div class="stat-fill" style="width:${w}%;background:${it.color}"></div></div>`;
        box.appendChild(div);
      });
      openModal('statModal');
    });
  }
})();
