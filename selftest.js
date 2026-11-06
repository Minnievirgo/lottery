// selftest.js —— 数据层回归测试（三种驱动共用同一套业务断言）
//   node --experimental-sqlite selftest.js                                  # local (node:sqlite)
//   TURSO_URL=file:./data/selftest.db node selftest.js turso               # turso (libSQL 本地文件)
//   CLOUDBASE_MOCK=1 SELFTEST_DRIVER=cloudbase node selftest.js            # cloudbase (内存 Mock，无需云账号)
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// 回归测试第 9 步会 importAll 覆盖整个库；未显式指定 DATA_DIR 时强制用隔离目录，
// 避免误清空真实 data/app.db。
if (!process.env.DATA_DIR && !process.env.TURSO_URL && process.env.SELFTEST_DRIVER !== 'cloudbase') {
  process.env.DATA_DIR = './.tools/selftest-db';
}
const db = process.env.SELFTEST_DRIVER === 'cloudbase' ? require('./db-cloudbase') : require('./db');

(async () => {
  await db.ready;
  console.log('模式:', db.MODE);

  // 1. 创建抽签（限量 + 不限量混合）
  const draw = await db.createDraw({
    title: '自检抽签', description: '回归测试', antiDuplicate: true,
    items: [
      { name: '一等奖', limit: 1, weight: 1, color: '#22d3ee' },
      { name: '二等奖', limit: 2, weight: 2, color: '#a855f7' },
      { name: '谢谢参与', limit: -1, weight: 1, color: '#34d399' }
    ]
  });
  assert.equal(draw.items.length, 3, '结果项数');
  const id = draw.id;

  // 2. 公开信息
  const pub = await db.getDrawPublic(id);
  assert.equal(pub.title, '自检抽签');
  assert.equal(pub.status, 'open');
  assert.equal(pub.antiDuplicate, true);

  // 3. 抽签 + 防重复
  const r1 = await db.performDraw({ drawId: id, name: '张三' });
  assert.equal(r1.ok, true, '首次抽签应成功: ' + JSON.stringify(r1));
  const r2 = await db.performDraw({ drawId: id, name: '张三' });
  assert.equal(r2.alreadyDrawn, true, '同名应回显已抽结果');
  assert.deepEqual(r2.result, { id: r1.result.id, name: r1.result.name });
  assert.equal((await db.performDraw({ drawId: id, name: '' })).error, 'name_required');
  assert.equal((await db.performDraw({ drawId: 'nope', name: 'x' })).error, 'not_found');

  // 4. 限量抽完 -> 售罄（先关掉不限量项，只留限量）
  const sold = await db.createDraw({ title: '售罄自检', antiDuplicate: true, items: [{ name: '唯一奖', limit: 1 }] });
  assert.equal((await db.performDraw({ drawId: sold.id, name: '甲' })).ok, true);
  assert.equal((await db.performDraw({ drawId: sold.id, name: '乙' })).soldOut, true);

  // 5. 名单 / 统计 / CSV
  const parts = await db.participants(id);
  assert.equal(parts.length, 1, '参与记录数');
  assert.equal(parts[0].name, '张三');
  const st = await db.stats(id);
  assert.equal(st.total, 1);
  assert.equal(st.items.length, 3);
  assert.ok(st.items.some(i => i.count === 1), '统计应计入抽中数');
  const csv = await db.exportCSV(id);
  assert.ok(csv.startsWith('\ufeff姓名,抽签结果,抽签时间'), 'CSV BOM 与表头');
  assert.ok(csv.includes('张三'));

  // 5b. F1 排序造数断言（AC-1.1~1.6 / AC-1.7）：
  // 用 importAll 临时造一份 result_name 精确可控的数据，断言完立刻用快照恢复，
  // 保证下面第 6~10 段仍基于原有抽签数据。全程只在隔离目录 / 内存 Mock 中进行。
  const snapshot = await db.exportAll();
  const sortDrawId = 'SORT-SELFTEST';
  const base = 1700000000000;
  const seed = [
    { id: 'sp01', name: '白敬亭', result_name: '38', drawn_at: base + 10 },
    { id: 'sp02', name: '宋白', result_name: '13', drawn_at: base + 20 },
    { id: 'sp03', name: '宋亚轩', result_name: '5', drawn_at: base + 30 },
    { id: 'sp04', name: '刘耀文', result_name: '17', drawn_at: base + 40 },
    { id: 'sp05', name: '张真源', result_name: '43', drawn_at: base + 50 },
    { id: 'sp06', name: '林漪挺', result_name: '14', drawn_at: base + 60 },
    { id: 'sp07', name: '贾玉婵', result_name: '6', drawn_at: base + 70 },
    { id: 'sp08', name: '一等奖甲', result_name: '一等奖', drawn_at: base + 80 },
    { id: 'sp09', name: 'A03甲', result_name: 'A03', drawn_at: base + 90 },
    { id: 'sp10', name: '空值甲', result_name: null, drawn_at: base + 100 },
    { id: 'sp11', name: '空串乙', result_name: '', drawn_at: base + 110 },
    { id: 'sp12', name: '同值早', result_name: '5', drawn_at: base + 1 },
    { id: 'sp13', name: '同值晚', result_name: '5', drawn_at: base + 999 }
  ];
  await db.importAll({
    version: 1, exportedAt: new Date().toISOString(), mode: db.MODE,
    draws: [{
      id: sortDrawId, title: '排序自检', description: '', status: 'open',
      anti_duplicate: 1, created_at: base, items: [],
      participants: seed.map(p => ({ ...p, draw_id: sortDrawId, result_id: null }))
    }]
  });
  const csv2 = await db.exportCSV(sortDrawId);
  const data2 = csv2.replace(/^\ufeff/, '').split('\r\n').slice(1).map(l => l.split(','));
  assert.equal(data2.length, 13, '造数 13 行全部导出');
  assert.deepEqual(data2.map(r => r[1]).slice(0, 9),
    ['5', '5', '5', '6', '13', '14', '17', '38', '43'], 'AC-1.1/1.2 数值升序，非字符串序');
  assert.deepEqual(data2.map(r => r[0]).slice(0, 9),
    ['同值早', '宋亚轩', '同值晚', '贾玉婵', '宋白', '林漪挺', '刘耀文', '白敬亭', '张真源'],
    '数值序对应姓名（含同值按 drawn_at）');
  assert.ok(data2.map(r => r[1]).indexOf('13') > data2.map(r => r[1]).indexOf('5'),
    'AC-1.3 不出现 "13" 排在 "5" 之前的字符串排序回归');
  const expectedNonNumeric = ['A03', '一等奖'].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  assert.deepEqual(data2.map(r => r[1]).slice(9, 11), expectedNonNumeric,
    'AC-1.4 非数字排在所有数字之后，彼此 zh-CN 字典序稳定');
  assert.deepEqual(data2.map(r => r[1]).slice(11, 13), ['', ''],
    'AC-1.5 空值最后且导出为空单元格');
  assert.deepEqual(data2.map(r => r[0]).slice(11, 13), ['空值甲', '空串乙'],
    '空值之间按 drawn_at 稳定');
  assert.ok(data2.findIndex(r => r[0] === '同值早') < data2.findIndex(r => r[0] === '宋亚轩'),
    'AC-1.6 同值先抽者在前');
  // AC-1.7：同一造数下，排序纯函数（snake_case accessor）与驱动导出逐行一致
  const { sortRows } = require('./public/lib/result-sort');
  const direct = sortRows(seed, r => r.result_name, r => r.drawn_at, r => r.id);
  assert.deepEqual(data2.map(r => r[0]), direct.map(r => r.name),
    'AC-1.7 双驱动与排序纯函数逐行一致');
  await db.importAll(snapshot);   // 恢复现场

  // 6. 编辑（保留结果项 id、重算剩余）
  const before = await db.getDrawRaw(id);
  const edited = await db.updateDraw(id, {
    title: '自检抽签-改',
    items: before.items.map(it => ({ ...it, limit: it.limit_count }))
  });
  assert.equal(edited.title, '自检抽签-改');
  assert.equal(edited.items.length, 3, '编辑后结果项不应丢失');
  // 重算规则：限量项 remaining = max(0, 上限 - 已抽中数)；不限量项恒为 -1。
  // 抽签是加权随机，不能假定「张三一定抽中一等奖」，故逐项按实际抽中数校验，
  // 避免回归测试因随机结果偶发失败。
  const st2 = await db.stats(id);
  for (const it of edited.items) {
    if (it.limit_count === -1) {
      assert.equal(it.remaining, -1, `不限量项「${it.name}」剩余应恒为 -1`);
    } else {
      const hit = st2.items.find(s => s.id === it.id);
      const used = hit ? hit.count : 0;
      assert.equal(it.remaining, Math.max(0, it.limit_count - used),
        `限量项「${it.name}」编辑后剩余应重算为 max(0, 上限 - 已抽中数)`);
    }
  }

  // 7. 关闭后不可抽
  await db.updateDraw(sold.id, { status: 'closed' });
  assert.equal((await db.performDraw({ drawId: sold.id, name: '丙' })).closed, true);

  // 8. 列表
  const list = await db.listDraws();
  assert.ok(list.length >= 2);
  assert.ok(list.some(d => d.id === id && d.participantCount === 1));

  // 9. 完整备份 / 恢复
  const backup = await db.exportAll();
  assert.equal(backup.version, 1);
  assert.ok(backup.draws.some(d => d.id === id && d.participants.length === 1), '备份应含参与名单');
  const restore = await db.importAll(backup);
  assert.equal(restore.ok, true);
  assert.equal((await db.participants(id)).length, 1, '恢复后名单应还在');
  assert.equal((await db.getDrawPublic(id)).title, '自检抽签-改', '恢复后标题应还在');

  // 10. 删除
  await db.deleteDraw(id);
  await db.deleteDraw(sold.id);
  assert.equal(await db.getDrawRaw(id), null);

  // 11. CloudBase 镜像 SHA-256 逐字节一致性（P0-8 / AC-3.9 / T05）
  // 唯一真源是主文件；cloudbase/** 一律由 npm run build:cloudbase 生成，禁止手工编辑。
  const MIRROR_PAIRS = [
    ['server.js', 'cloudbase/function/server.js'],
    ['db-cloudbase.js', 'cloudbase/function/db-cloudbase.js'],
    ['public/admin.html', 'cloudbase/function/public/admin.html'],
    ['public/admin.html', 'cloudbase/hosting/admin.html'],
    ['public/admin.html', 'cloudbase/hosting/admin/index.html'],
    ['public/admin.js', 'cloudbase/function/public/admin.js'],
    ['public/admin.js', 'cloudbase/hosting/admin.js'],
    ['public/admin.css', 'cloudbase/function/public/admin.css'],
    ['public/admin.css', 'cloudbase/hosting/admin.css'],
    ['public/qr-render.js', 'cloudbase/function/public/qr-render.js'],
    ['public/qr-render.js', 'cloudbase/hosting/qr-render.js'],
    ['public/lib/result-sort.js', 'cloudbase/function/public/lib/result-sort.js'],
    ['public/lib/result-sort.js', 'cloudbase/hosting/lib/result-sort.js'],
    ['public/lib/share-url.js', 'cloudbase/function/public/lib/share-url.js'],
    ['public/lib/share-url.js', 'cloudbase/hosting/lib/share-url.js'],
    ['public/lib/schedule.js', 'cloudbase/function/public/lib/schedule.js'],
    ['public/lib/schedule.js', 'cloudbase/hosting/lib/schedule.js'],
    ['public/lib/spreadsheetml.js', 'cloudbase/function/public/lib/spreadsheetml.js'],
    ['public/lib/spreadsheetml.js', 'cloudbase/hosting/lib/spreadsheetml.js'],
    ['public/vendor/qrcode.js', 'cloudbase/function/public/vendor/qrcode.js'],
    ['public/vendor/qrcode.js', 'cloudbase/hosting/vendor/qrcode.js'],
    ['public/cosmic-bg.js', 'cloudbase/function/public/cosmic-bg.js'],
    ['public/cosmic-bg.js', 'cloudbase/hosting/cosmic-bg.js'],
    ['public/index.html', 'cloudbase/function/public/index.html'],
    ['public/index.html', 'cloudbase/hosting/index.html'],
    ['public/user.js', 'cloudbase/function/public/user.js'],
    ['public/user.js', 'cloudbase/hosting/user.js'],
    ['public/user.css', 'cloudbase/function/public/user.css'],
    ['public/user.css', 'cloudbase/hosting/user.css']
  ];
  function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
  function readProject(rel) { return fs.readFileSync(path.join(__dirname, rel)); }
  function checkMirrors(list, read) {
    for (const [src, dst] of list) {
      if (sha256(read(src)) !== sha256(read(dst))) {
        throw new Error('镜像不一致: ' + src + ' != ' + dst);
      }
    }
  }
  checkMirrors(MIRROR_PAIRS, readProject);
  // 自测有效性：伪造「把某个镜像改坏 1 字节」的 reader，断言检测器确实会报错
  // （纯内存伪造，不触碰磁盘、不污染仓库）
  const tampered = 'cloudbase/hosting/vendor/qrcode.js';
  const fakeRead = rel => {
    const buf = Buffer.from(readProject(rel));
    if (rel === tampered) buf[0] = buf[0] ^ 0xff;
    return buf;
  };
  assert.throws(() => checkMirrors(MIRROR_PAIRS, fakeRead), /镜像不一致/,
    '镜像断言必须能发现单字节漂移');
  console.log('  镜像 SHA-256：' + MIRROR_PAIRS.length + ' 对全部一致（含改坏自测）');

  console.log('✅ 全部通过（' + db.MODE + '）');
})().catch(e => { console.error('❌ 失败:', e); process.exit(1); });
