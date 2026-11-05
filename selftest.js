// selftest.js —— 数据层回归测试（三种驱动共用同一套业务断言）
//   node --experimental-sqlite selftest.js                                  # local (node:sqlite)
//   TURSO_URL=file:./data/selftest.db node selftest.js turso               # turso (libSQL 本地文件)
//   CLOUDBASE_MOCK=1 SELFTEST_DRIVER=cloudbase node selftest.js            # cloudbase (内存 Mock，无需云账号)
const assert = require('node:assert/strict');
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

  console.log('✅ 全部通过（' + db.MODE + '）');
})().catch(e => { console.error('❌ 失败:', e); process.exit(1); });
