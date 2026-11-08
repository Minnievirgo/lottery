(function () {
  const $ = id => document.getElementById(id);
  const token = localStorage.getItem('lottery_token') || '';
  let editingId = null;
  let currentListDrawId = null;
  let currentListDrawTitle = '';
  let currentListEmpty = true;
  let currentQrDrawId = null;
  let currentQrDrawTitle = '';
  // 真机扫不出装饰版时的一键兜底：切到标准黑白码，并在本机记住选择（下次打开仍生效）。
  let currentQrPlain = false;
  try { currentQrPlain = localStorage.getItem('lottery_qr_plain') === '1'; } catch (e) { /* 隐私模式忽略 */ }

  const PALETTE = ['#22d3ee', '#a855f7', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#f472b6', '#2dd4bf'];

  // P1-2：仅当前浏览器记忆 10 个非 title 字段；title 每次打开由当前场次重新注入，
  // 不写入 localStorage，避免切换场次显示旧标题（与 lottery_token 同风格）。
  const SCH_KEY = 'lottery_schedule_params_v1';
  const SCH_DEFAULTS = Object.freeze({
    amStart: '08:40', amEnd: '12:00', pmStart: '14:00', pmEnd: '17:30',
    duration: 10, gap: 5, breakEnabled: true, breakEvery: 7, breakMinutes: 15,
    remark: '1、个人答辩时长每人13分钟，其中报告呈现10分钟，评委提问3分钟。'
  });
  const SCH_TIME_KEYS = ['amStart', 'amEnd', 'pmStart', 'pmEnd'];
  const SCH_INT_KEYS = ['duration', 'gap', 'breakEvery', 'breakMinutes'];
  const SCH_ALL_KEYS = SCH_TIME_KEYS.concat(SCH_INT_KEYS, ['breakEnabled', 'remark']);
  const SCH_FIELD_IDS = {
    title: 'sch_title', amStart: 'sch_amStart', amEnd: 'sch_amEnd',
    pmStart: 'sch_pmStart', pmEnd: 'sch_pmEnd',
    duration: 'sch_duration', gap: 'sch_gap',
    breakEvery: 'sch_breakEvery', breakMinutes: 'sch_breakMinutes', remark: 'sch_remark'
  };

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
        <button data-act="qr">二维码</button>
        <button data-act="del" style="color:var(--danger)">删除</button>
      </div>`;
    el.querySelector('[data-act=edit]').onclick = () => openEdit(d);
    el.querySelector('[data-act=list]').onclick = () => openList(d.id, d.title);
    el.querySelector('[data-act=stat]').onclick = () => openStat(d.id);
    el.querySelector('[data-act=toggle]').onclick = () => toggleDraw(d.id, open);
    el.querySelector('[data-act=link]').onclick = () => copyLink(d.id);
    el.querySelector('[data-act=qr]').onclick = () => openQr(d.id, d.title);
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
    // 卡片「复制链接」、二维码弹窗「复制链接」、二维码内容、弹窗链接文本共用同一来源
    const url = ShareUrl.makeShareUrl(location.origin, id);
    navigator.clipboard.writeText(url).then(() => toast('分享链接已复制：' + url),
      () => { prompt('复制以下链接发给用户：', url); });
  }

  // ---- 名单 ----
  function setExportButtonsEnabled(ok) {
    // 不用原生 disabled（那样点击无任何反馈）：用 .disabled 置灰 + 点击时 toast 提示，
    // 同时满足 AC-2.13「名单为空时禁用」与「点击给出提示」两条。
    ['exportBtn', 'scheduleBtn'].forEach(k => {
      const b = $(k);
      if (ok) b.classList.remove('disabled'); else b.classList.add('disabled');
    });
  }
  function openList(id, title) {
    currentListDrawId = id;
    currentListDrawTitle = String(title || '');
    api('/api/admin/draws/' + id + '/participants').then(res => {
      const tb = $('listTbl').querySelector('tbody'); tb.innerHTML = '';
      const list = res.participants || [];
      // P1-1：与导出 CSV / .xls 同序（同一份 ResultSort.sortRows，camelCase accessor）
      const sorted = ResultSort.sortRows(list, p => p.resultName, p => p.drawnAt, p => p.id);
      currentListEmpty = sorted.length === 0;
      $('listEmpty').classList.toggle('hidden', !currentListEmpty);
      setExportButtonsEnabled(!currentListEmpty);
      sorted.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.resultName)}</td><td>${new Date(p.drawnAt).toLocaleString('zh-CN', { hour12: false })}</td>`;
        tb.appendChild(tr);
      });
      openModal('listModal');
    });
  }
  $('exportBtn').onclick = () => {
    if (currentListEmpty) { toast('暂无参与记录'); return; }
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

  // ================= F2：导出发言顺序 =================
  const ScheduleFormState = {
    load() {
      const out = Object.assign({}, SCH_DEFAULTS);
      try {
        const raw = JSON.parse(localStorage.getItem(SCH_KEY) || 'null');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
        // 逐字段类型校验后与 DEFAULTS 合并，任何非法值静默回退（R7）
        for (const k of SCH_TIME_KEYS) {
          const v = raw[k];
          if (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) out[k] = v;
        }
        for (const k of SCH_INT_KEYS) {
          const v = raw[k];
          if (Number.isInteger(v) && v >= 0) out[k] = v;
          else if (typeof v === 'string' && /^[+-]?\d+$/.test(v.trim()) && Number(v) >= 0) out[k] = Number(v);
        }
        if (typeof raw.breakEnabled === 'boolean') out.breakEnabled = raw.breakEnabled;
        if (typeof raw.remark === 'string' && raw.remark.length <= 200) out.remark = raw.remark;
      } catch (_) { /* 脏值 / 隐私模式：静默回退默认 */ }
      return out;
    },
    save(params) {
      const out = {};
      SCH_ALL_KEYS.forEach(k => { out[k] = params[k]; });
      // 数字字段统一存成整数，避免读回时类型漂移；仅 10 个字段，不含 title / drawId
      SCH_INT_KEYS.forEach(k => {
        const n = parseInt(out[k], 10);
        if (Number.isFinite(n)) out[k] = n;
      });
      try { localStorage.setItem(SCH_KEY, JSON.stringify(out)); } catch (_) {}
    }
  };

  // 原样读回字符串，让服务端 validateParams 也能严格拦截空值 / 0 / 负数
  function readScheduleForm() {
    return {
      title: $('sch_title').value,
      amStart: $('sch_amStart').value,
      amEnd: $('sch_amEnd').value,
      pmStart: $('sch_pmStart').value,
      pmEnd: $('sch_pmEnd').value,
      duration: $('sch_duration').value,
      gap: $('sch_gap').value,
      breakEnabled: $('sch_breakEnabled').checked,
      breakEvery: $('sch_breakEvery').value,
      breakMinutes: $('sch_breakMinutes').value,
      remark: $('sch_remark').value
    };
  }

  function localParseHHmm(s) {
    // 分钟必须是第二个捕获组 m[2]；漏写括号会让所有时间恒判非法（NaN）。
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s == null ? '' : s));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
  }
  function localToInt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
    if (typeof v === 'string' && /^[+-]?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
    return NaN;
  }
  // 与服务端 schedule.validateParams 同规则的前端镜像；服务端仍是权威
  function validateLocal(p) {
    const f = {};
    const title = String(p.title || '').trim();
    if (!title) f.title = '请填写表格标题';
    else if (title.length > 60) f.title = '表格标题不能超过 60 字';
    const mins = {};
    const labels = { amStart: '上午开始', amEnd: '上午结束', pmStart: '下午开始', pmEnd: '下午结束' };
    for (const k of SCH_TIME_KEYS) {
      const n = localParseHHmm(p[k]);
      if (isNaN(n)) f[k] = labels[k] + '时间格式不合法（需 HH:mm）';
      mins[k] = n;
    }
    if (isFinite(mins.amStart) && isFinite(mins.amEnd) && !(mins.amEnd > mins.amStart)) f.amEnd = '上午结束时间必须晚于上午开始时间';
    if (isFinite(mins.amEnd) && isFinite(mins.pmStart) && !(mins.pmStart > mins.amEnd)) f.pmStart = '下午开始时间必须晚于上午结束时间';
    if (isFinite(mins.pmStart) && isFinite(mins.pmEnd) && !(mins.pmEnd > mins.pmStart)) f.pmEnd = '下午结束时间必须晚于下午开始时间';
    const d = localToInt(p.duration);
    if (isNaN(d) || d <= 0) f.duration = '每人发言时长必须大于 0 分钟';
    const g = localToInt(p.gap);
    if (isNaN(g) || g < 0) f.gap = '发言间隔不能为负数';
    if (p.breakEnabled) {
      const n = localToInt(p.breakEvery);
      const m = localToInt(p.breakMinutes);
      if (isNaN(n) || n < 1) f.breakEvery = '每 N 人休息必须是 ≥ 1 的整数';
      if (isNaN(m) || m < 0) f.breakMinutes = '休息分钟数必须是 ≥ 0 的整数';
    }
    if (String(p.remark || '').length > 200) f.remark = '备注不能超过 200 字';
    return f;
  }

  function markField(key, msg) {
    const input = $(SCH_FIELD_IDS[key]);
    if (!input) return;
    const fld = input.closest('.fld');
    const span = fld ? fld.querySelector('.fld-msg') : null;
    if (msg) {
      if (fld) fld.classList.add('err');
      if (span) span.textContent = msg;
    } else {
      if (fld) fld.classList.remove('err');
      if (span) span.textContent = '';
    }
  }
  function clearFieldErrors() { Object.keys(SCH_FIELD_IDS).forEach(k => markField(k, '')); }
  function applyFieldErrors(fields) {
    clearFieldErrors();
    let first = '';
    Object.keys(fields || {}).forEach(k => {
      markField(k, fields[k]);
      if (!first) first = fields[k];
    });
    return first;
  }
  function liveValidate(key) {
    const f = validateLocal(readScheduleForm());
    markField(key, f[key] || '');
  }
  Object.keys(SCH_FIELD_IDS).forEach(k => {
    const el = $(SCH_FIELD_IDS[k]);
    if (!el) return;
    el.addEventListener('input', () => liveValidate(k));
    el.addEventListener('change', () => liveValidate(k));
  });
  function syncBreakFields() {
    const on = $('sch_breakEnabled').checked;
    $('sch_breakFields').classList.toggle('disabled', !on);
    $('sch_breakEvery').disabled = !on;
    $('sch_breakMinutes').disabled = !on;
    if (!on) { markField('breakEvery', ''); markField('breakMinutes', ''); }
  }
  $('sch_breakEnabled').addEventListener('change', syncBreakFields);

  function openSchedule() {
    if (currentListEmpty) { toast('暂无参与记录'); return; }
    if (!currentListDrawId) return;
    const saved = ScheduleFormState.load();
    SCH_TIME_KEYS.forEach(k => { $(SCH_FIELD_IDS[k]).value = saved[k]; });
    SCH_INT_KEYS.forEach(k => { $(SCH_FIELD_IDS[k]).value = saved[k]; });
    $('sch_breakEnabled').checked = saved.breakEnabled;
    $('sch_remark').value = saved.remark;
    // title 不存 localStorage：每次打开取当前场次标题，切换场次自动刷新
    $('sch_title').value = currentListDrawTitle;
    clearFieldErrors();
    $('schError').textContent = '';
    $('schError').classList.add('hidden');
    syncBreakFields();
    openModal('scheduleModal');
  }
  $('scheduleBtn').onclick = openSchedule;

  function showSchError(e) {
    const box = $('schError');
    box.textContent = (e && e.message) ? e.message : '导出失败，请稍后重试';
    box.classList.remove('hidden');
    if (e && e.fields) {
      const first = applyFieldErrors(e.fields);
      if (first) toast(first);
    }
    // 容量超限 / 参数非法：不关闭弹窗，用户可就地调整参数重试
  }
  function submitSchedule() {
    if (currentListEmpty) { toast('暂无参与记录'); return; }
    const params = readScheduleForm();
    const first = applyFieldErrors(validateLocal(params));
    if (first) { toast(first); return; }
    $('schError').classList.add('hidden');
    fetch('/api/admin/draws/' + encodeURIComponent(currentListDrawId) + '/export-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify(params)
    }).then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        showSchError(e);
        return;
      }
      const b = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      const safeTitle = String(params.title).trim().replace(/["\\\/:*?<>|]/g, '');
      a.download = safeTitle + '-发言顺序.xls';
      a.click();
      URL.revokeObjectURL(a.href);
      ScheduleFormState.save(params);   // 仅成功导出后写，且只存 10 个字段
      toast('发言顺序表已下载');
      closeModal($('scheduleModal'));
    }).catch(() => showSchError({ message: '导出失败，请检查网络或重新登录' }));
  }
  $('schSubmit').onclick = submitSchedule;

  // ================= F3：分享二维码 =================
  // 两种模式共用同一条 URL：星空美化版（定稿视觉）/ 标准黑白码（真机兜底）。
  function renderQr() {
    const url = ShareUrl.makeShareUrl(location.origin, currentQrDrawId);
    LotteryQR.render($('qrCanvas'), url, { size: 800, plain: currentQrPlain });
    $('qrUrl').textContent = url;
    $('qrModeBtn').textContent = currentQrPlain ? '改用星空美化版' : '改用标准黑白码';
  }
  function openQr(id, title) {
    currentQrDrawId = id;
    currentQrDrawTitle = String(title || '');
    try {
      renderQr();
      openModal('qrModal');
    } catch (e) {
      toast('二维码生成失败：' + (e && e.message ? e.message : '未知错误'));
    }
  }
  $('qrModeBtn').onclick = () => {
    if (!currentQrDrawId) return;
    currentQrPlain = !currentQrPlain;
    try { localStorage.setItem('lottery_qr_plain', currentQrPlain ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
    try {
      renderQr();
      toast(currentQrPlain ? '已切换标准黑白码，真机最易扫' : '已切换回星空美化版');
    } catch (e) {
      toast('切换失败：' + (e && e.message ? e.message : '未知错误'));
    }
  };
  $('qrCopyBtn').onclick = () => { if (currentQrDrawId) copyLink(currentQrDrawId); };
  $('qrDownloadBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = LotteryQR.toDataURL($('qrCanvas'));
    a.download = (currentQrDrawTitle || '抽签') + (currentQrPlain ? '-二维码-黑白.png' : '-二维码.png');
    a.click();
  };
  $('qrUrl').onclick = () => {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($('qrUrl'));
    sel.removeAllRanges();
    sel.addRange(range);
  };
})();
