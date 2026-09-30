/* eslint-disable no-console */
declare const process: { exit(code?: number): void };
// 端到端状态机冒烟测试：在 node 中运行（localStorage shim）
import { freshLocalDB, saveDB, loadDB, addLog, CURRENT_USER } from '../lib/db';
import { remote, CommitRejectedError } from '../lib/remote';
import { computeMerge, issueCount, buildPreview, resolveIssue, allResolved } from '../lib/merge';
import { commitSession, annotatePlansWithLocal, restoreRecycleEntry } from '../lib/commit';
import type { LocalDB, PendingSession } from '../lib/types';

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('断言失败: ' + msg);
  passed++;
}

function snapshot(db: LocalDB) {
  return computeMerge({
    locals: db.pairs,
    bases: db.bases,
    tombstones: db.tombstones,
    outboxPairIds: new Set(db.outbox.map((o) => o.pairId)),
    snapshot: db.session!.base,
    localCategories: db.categories,
  });
}

async function startSync(db: LocalDB) {
  const snap = await remote.fetchSnapshot();
  const session = computeMerge({
    locals: db.pairs,
    bases: db.bases,
    tombstones: db.tombstones,
    outboxPairIds: new Set(db.outbox.map((o) => o.pairId)),
    snapshot: snap,
    localCategories: db.categories,
  });
  annotatePlansWithLocal(session, db);
  db.session = session;
  return session;
}

// 模拟本地编辑（绕过 React store）
function localEdit(db: LocalDB, id: string, patch: Record<string, unknown>) {
  const doc = db.pairs[id];
  const t = Date.now();
  for (const [k, v] of Object.entries(patch)) {
    (doc as unknown as Record<string, unknown>)[k] = v;
    doc.fields[k as keyof typeof doc.fields] = t;
    if (!db.outbox.some((o) => o.pairId === id && o.kind === 'update')) {
      db.outbox.push({ id: 'op_' + t + '_' + k, pairId: id, kind: 'update' as const, at: t, by: CURRENT_USER, fields: [] });
    }
  }
  doc.updatedAt = t;
}

async function resetEnv() {
  localStorage.clear();
  const db = freshLocalDB();
  saveDB(db);
  await remote.resetAll();
  return db;
}

async function main() {
  /* ---------- 场景 1：两人同改分类 + 另一字段 → 逐字段冲突与确认 ---------- */
  let db = await resetEnv();
  const id = 'p_editorial';

  // 本机离线：改分类 + 标题文案
  localEdit(db, id, { category: 'Brand', heading: '本机改的标题' });
  saveDB(db);

  // 对端：改分类（盖分类场景）、改标题（同字段分叉）、改正文字体（单边改动自动合并）
  await remote.remoteEdit(id, { category: 'Portfolio', heading: 'remote headline', bodyFont: 'IBM Plex Sans' }, 'Yuki Lin');

  let session: PendingSession = await startSync(db);
  assert(issueCount(session) === 2, `分类冲突 + 标题冲突, 实际 issue=${issueCount(session)}`);
  // heading 双方都改 → 字段冲突；bodyFont 只远端改 → 自动接收
  const plan = session.plans.find((p) => p.pairId === id)!;
  assert(plan.autoValues.bodyFont === 'IBM Plex Sans', '单边远端改动自动接收');

  // 未确认时预览不含该配对
  let preview = buildPreview(session);
  const item = preview.find((i) => i.plan.pairId === id)!;
  assert(item.ready === false && item.values === null, '未确认的配对不进预览');

  // 分类用对端、标题无冲突；解决分类冲突 + 任意剩余 issue
  for (const iss of plan.issues) {
    resolveIssue(session, iss.id, iss.kind === 'category-rename' ? { choice: 'remote' } : { choice: 'local' });
  }
  assert(allResolved(session), '全部已确认');
  preview = buildPreview(session);
  const item2 = preview.find((i) => i.plan.pairId === id)!;
  assert(item2.values?.category === 'Portfolio', '预览分类取对端');
  assert(item2.values?.heading === '本机改的标题', '预览标题取本机');
  assert(item2.values?.bodyFont === 'IBM Plex Sans', '预览字体自动合并');

  let res = await commitSession(db, session);
  assert(res.ok, '提交成功');
  assert(db.session === null, '提交后会话清空');
  assert(db.bases[id].values.category === 'Portfolio' && db.bases[id].values.heading === '本机改的标题', '本地基准已更新');
  assert(db.outbox.length === 0, 'outbox 清空');
  const r = remote.peek();
  assert(r.pairs[id].category === 'Portfolio' && r.pairs[id].heading === '本机改的标题', '远端文档逐字段合并');
  assert(r.pairs[id].bodyFont === 'IBM Plex Sans', '远端保留其单边改动');
  console.log('✓ 场景1 逐字段三方合并 + 分类归属确认 + 预览只含已确认内容');

  /* ---------- 场景 2：提交失败 → 原批次按同一基准重试 ---------- */
  db = await resetEnv();
  localEdit(db, 'p_studio', { title: '本机改工作室' });
  saveDB(db);
  await remote.remoteEdit('p_studio', { heading: 'remote heading' }, 'Yuki Lin');
  session = await startSync(db);
  // title 仅本地改、heading 仅远端改，无 issue
  assert(issueCount(session) === 0, '单边改动无冲突');
  remote.setFailNext(true);
  const beforeVersion = remote.peek().pairs['p_studio'].version;
  res = await commitSession(db, session);
  assert(!res.ok && session.status === 'failed', '提交标记失败');
  assert(remote.peek().pairs['p_studio'].title !== '本机改工作室', '失败后远端未变');
  assert(db.pairs['p_studio'].title === '本机改工作室', '失败后本地未变');
  assert(db.session === session, '失败批次保留');
  // 重开：从 localStorage 读回，仍是同一冻结基准
  saveDB(db);
  db = loadDB();
  assert(db.session !== null && db.session.base.serverVersion === session.base.serverVersion, '重开后仍以同一基准核对');
  res = await commitSession(db, db.session!);
  assert(res.ok, '重试成功');
  assert(remote.peek().pairs['p_studio'].version === beforeVersion + 1, '版本号只增加一次');
  console.log('✓ 场景2 合并失败原子性 + 原批次重试 + 重开同基准');

  /* ---------- 场景 3：远端删除 + 本地新改动 → 回收站副本 ---------- */
  db = await resetEnv();
  localEdit(db, 'p_field', { title: '本机还在改的田野指南', category: 'Editorial' });
  saveDB(db);
  await remote.remoteDelete('p_field', 'Yuki Lin');
  session = await startSync(db);
  const rPlan = session.plans.find((p) => p.pairId === 'p_field')!;
  assert(rPlan.kind === 'remote-delete', `应为 remote-delete，实际 ${rPlan.kind}`);
  preview = buildPreview(session);
  const rItem = preview.find((i) => i.plan.pairId === 'p_field')!;
  assert(rItem.action === 'recycle', '回收站动作');
  res = await commitSession(db, session);
  assert(res.ok, '回收站提交 ok');
  assert(db.recycle.length === 1, '产生一份回收站副本');
  const entry = db.recycle[0];
  assert(entry.local.title === '本机还在改的田野指南', '副本保留本机原值');
  assert((entry.original.title as string) === 'Field guide', '副本记录基准原值');
  assert(entry.record.localChanges.length === 2, '处理记录含 2 个本地改动字段');
  assert(entry.record.remoteDeletedBy === 'Yuki Lin', '记录远端删除人');
  assert(!db.pairs['p_field'], '配对从工作区移除');
  // 恢复副本 → 下一次同步重新上传
  restoreRecycleEntry(db, entry.id);
  assert(db.pairs['p_field'].title === '本机还在改的田野指南', '恢复到工作区');
  session = await startSync(db);
  const restored = session.plans.find((p) => p.pairId === 'p_field')!;
  assert(restored.kind === 'create', '恢复后作为新建提交到墓碑之上');
  await commitSession(db, session);
  assert(remote.peek().pairs['p_field'] !== undefined, '远端重建成功');
  console.log('✓ 场景3 远端删除+本地改动 → 带原值/处理记录的回收站副本 → 恢复重提');

  /* ---------- 场景 4：远端分类改名 + 本地把配对移到别的分类 ---------- */
  db = await resetEnv();
  localEdit(db, 'p_editorial', { category: 'Brand' });
  saveDB(db);
  await remote.remoteRenameCategory('Editorial', 'Editorial New', 'Yuki Lin');
  session = await startSync(db);
  const cPlan = session.plans.find((p) => p.pairId === 'p_editorial')!;
  const catIssue = cPlan.issues.find((i) => i.kind === 'category-rename')!;
  assert(!!catIssue && catIssue.local === 'Brand' && catIssue.remote === 'Editorial New', '归属对不上的待确认项');
  resolveIssue(session, catIssue.id, { choice: 'custom', value: 'Editorial New' });
  await commitSession(db, session);
  assert(remote.peek().pairs['p_editorial'].category === 'Editorial New', '自定义分类生效');
  console.log('✓ 场景4 分类改名 vs 本地移动 → 归属待确认');

  /* ---------- 场景 5：本地删除、远端同时编辑 ---------- */
  db = await resetEnv();
  delete db.pairs['p_studio'];
  db.tombstones.push({ id: 'p_studio', at: Date.now(), by: CURRENT_USER });
  db.outbox.push({ id: 'op1', pairId: 'p_studio', kind: 'delete', at: Date.now(), by: CURRENT_USER, fields: [] });
  saveDB(db);
  await remote.remoteEdit('p_studio', { heading: '对端改过' }, 'Yuki Lin');
  session = await startSync(db);
  const dPlan = session.plans.find((p) => p.pairId === 'p_studio')!;
  assert(dPlan.kind === 'local-delete' && dPlan.issues.length === 1, '本地删除/对端编辑待确认');
  resolveIssue(session, dPlan.issues[0].id, { choice: 'restore' });
  preview = buildPreview(session);
  const dItem = preview.find((i) => i.plan.pairId === 'p_studio')!;
  assert(dItem.action === 'pull', '选择恢复 → 接收对端版本');
  await commitSession(db, session);
  assert(!!db.pairs['p_studio'] && !!remote.peek().pairs['p_studio'], '配对已恢复并同步');
  console.log('✓ 场景5 本地删除/对端编辑 → 确认恢复');

  /* ---------- 场景 6：双方一致删除 ---------- */
  db = await resetEnv();
  delete db.pairs['p_field'];
  db.tombstones.push({ id: 'p_field', at: Date.now(), by: CURRENT_USER });
  db.outbox.push({ id: 'op2', pairId: 'p_field', kind: 'delete', at: Date.now(), by: CURRENT_USER, fields: [] });
  await remote.remoteDelete('p_field', CURRENT_USER); // 两边都删
  session = await startSync(db);
  const bPlan = session.plans.find((p) => p.pairId === 'p_field')!;
  assert(bPlan.kind === 'both-delete', '双方一致删除');
  await commitSession(db, session);
  assert(!db.pairs['p_field'] && db.recycle.length === 0, '删除且不进回收站');
  console.log('✓ 场景6 双方一致删除');

  /* ---------- 场景 7：字段修订时间随合并结果保留来源 ---------- */
  db = await resetEnv();
  const tLocal = Date.now();
  localEdit(db, 'p_editorial', { heading: '本机标题时间' });
  saveDB(db);
  await new Promise((r) => setTimeout(r, 20));
  await remote.remoteEdit('p_editorial', { body: 'remote body ts' }, 'Yuki Lin');
  session = await startSync(db);
  annotatePlansWithLocal(session, db);
  await commitSession(db, session);
  const merged = db.pairs['p_editorial'];
  assert(merged.fields.heading >= tLocal, '本机字段保留本机修订时间');
  assert(merged.fields.body > tLocal + 10, '远端字段保留远端修订时间');
  console.log('✓ 场景7 逐字段修订时间按来源合并');

  addLog(db, 'info', 'smoke ok');
  console.log(`\n全部 ${passed} 条断言通过`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
