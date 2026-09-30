import type {
  FieldKey,
  FieldValue,
  LocalDB,
  PairDoc,
  PendingSession,
  RecycleEntry,
} from './types';
import { FIELD_KEYS } from './types';
import { addLog, baseFromDoc, CURRENT_USER, uid } from './db';
import { remote, type CommitOp } from './remote';
import { buildPreview, type PreviewItem } from './merge';

interface PlanMeta {
  _localFields?: Record<FieldKey, number>;
  _localBy?: string;
  _remoteFields?: Record<FieldKey, number>;
}

/** 由预览项 + 合并后的字段值组装最终文档，并为每个字段挑选修订时间/作者 */
function buildMergedDoc(item: PreviewItem): PairDoc {
  const plan = item.plan;
  const values = item.values!;
  const t = Date.now();
  const fields = {} as Record<FieldKey, number>;
  const remoteDoc = plan.remoteDoc ?? null;
  const meta = plan as unknown as PlanMeta;
  const localFields = meta._localFields;
  const remoteFields = meta._remoteFields;

  for (const k of FIELD_KEYS) {
    const iss = plan.issues.find((i) => i.field === k);
    const choice = iss?.resolution?.choice;
    if (choice === 'custom') fields[k] = t;
    else if (choice === 'remote') fields[k] = remoteFields?.[k] ?? remoteDoc?.fields[k] ?? t;
    else if (choice === 'local') fields[k] = localFields?.[k] ?? t;
    else if (plan.origins[k] === 'remote') fields[k] = remoteFields?.[k] ?? remoteDoc?.fields[k] ?? t;
    else if (plan.origins[k] === 'local') fields[k] = localFields?.[k] ?? t;
    else fields[k] = localFields?.[k] ?? remoteFields?.[k] ?? remoteDoc?.fields[k] ?? t;
  }

  const doc = {
    ...({} as Omit<PairDoc, 'fields'>),
    fields,
    updatedAt: t,
    updatedBy: CURRENT_USER,
  } as PairDoc;
  FIELD_KEYS.forEach((k) => ((doc as unknown as Record<string, FieldValue>)[k] = values[k]));
  return doc;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
}

/**
 * 按会话的冻结基准提交整批：
 * - 构造远端操作（带版本断言）→ 远端原子提交
 * - 成功后回写本地 pairs/bases/tombstones/recycle/outbox
 * 任一远端操作失败 → 抛错，本地零改动，批次保留以便重试。
 */
export async function commitSession(db: LocalDB, session: PendingSession): Promise<CommitResult> {
  const preview = buildPreview(session);
  const ops: CommitOp[] = [];
  const actionable: PreviewItem[] = [];

  for (const item of preview) {
    if (!item.ready) continue;
    if (item.action === 'none') continue;
    actionable.push(item);
    const plan = item.plan;
    if (item.action === 'create') {
      ops.push({ pairId: plan.pairId, action: 'create', expectedVersion: null, doc: buildMergedDoc(item) });
    } else if (item.action === 'update') {
      ops.push({ pairId: plan.pairId, action: 'update', expectedVersion: plan.expectedVersion, doc: buildMergedDoc(item) });
    } else if (item.action === 'restore') {
      ops.push({ pairId: plan.pairId, action: 'restore', expectedVersion: null, doc: buildMergedDoc(item) });
    } else if (item.action === 'delete') {
      ops.push({ pairId: plan.pairId, action: 'delete', expectedVersion: plan.expectedVersion });
    }
    // pull / recycle 不需要写远端
  }

  let versions: Record<string, number>;
  try {
    ({ versions } = await remote.commit(ops, session.batchId));
  } catch (e) {
    session.status = 'failed';
    session.error = e instanceof Error ? e.message : String(e);
    session.attempts += 1;
    db.session = session;
    addLog(db, 'error', `批次 ${session.batchId.slice(-6)} 合并失败：${session.error} 批次保留，可重试。`);
    return { ok: false, error: session.error };
  }

  const t = Date.now();
  const touched = new Set<string>();

  // 纯本机新建又在本机删除、远端从未存在的配对：仅清理痕迹
  for (const localTomb of [...db.tombstones]) {
    const remoteDoc = session.base.pairs[localTomb.id];
    const remoteT = session.base.tombstones[localTomb.id];
    if (!remoteDoc && !remoteT && !db.bases[localTomb.id]) {
      touched.add(localTomb.id);
      db.tombstones = db.tombstones.filter((x) => x.id !== localTomb.id);
    }
  }

  for (const item of actionable) {
    const { plan } = item;
    const id = plan.pairId;
    touched.add(id);

    if (item.action === 'recycle') {
      const local = db.pairs[id];
      if (local && plan.remoteTomb && plan.localChanges) {
        const entry: RecycleEntry = {
          id: uid('rec'),
          pairId: id,
          local: { ...local },
          original: plan.baseValues!,
          record: {
            movedAt: t,
            movedBy: CURRENT_USER,
            remoteDeletedBy: plan.remoteTomb.by,
            remoteDeletedAt: plan.remoteTomb.at,
            remoteVersion: plan.remoteTomb.version,
            localChanges: plan.localChanges,
          },
        };
        db.recycle.unshift(entry);
        addLog(db, 'recycle', `远端已删除「${plan.title}」，但你有 ${plan.localChanges.length} 处新改动 → 已移入回收站副本。`);
      }
      delete db.pairs[id];
      delete db.bases[id];
      if (!db.tombstones.some((x) => x.id === id)) {
        db.tombstones.push({ id, at: t, by: CURRENT_USER });
      }
      continue;
    }

    if (item.action === 'delete') {
      const v = versions[id] ?? plan.remoteVersion ?? 0;
      delete db.pairs[id];
      delete db.bases[id];
      if (!db.tombstones.some((x) => x.id === id)) {
        db.tombstones.push({ id, at: t, by: CURRENT_USER });
      }
      addLog(db, 'sync', `配对「${plan.title}」删除已同步（远端 v${v}）。`);
      continue;
    }

    if (item.action === 'pull' && plan.remoteDoc) {
      // 接收对端版本：保留对端文档（含逐字段修订时间与作者）
      const doc: PairDoc = { ...plan.remoteDoc };
      db.pairs[id] = doc;
      db.bases[id] = baseFromDoc(doc, plan.remoteVersion ?? 1, t);
      addLog(db, 'sync', `已接收对端的配对「${plan.title}」。`);
      continue;
    }

    if ((item.action === 'create' || item.action === 'update' || item.action === 'restore') && item.values) {
      // buildMergedDoc 已按字段来源计算好逐字段修订时间，直接使用
      const doc = buildMergedDoc(item);
      db.pairs[id] = doc;
      const v = versions[id] ?? (plan.remoteVersion ?? 0) + 1;
      db.bases[id] = baseFromDoc(doc, v, t);
      db.tombstones = db.tombstones.filter((x) => x.id !== id);
      addLog(
        db,
        'sync',
        item.action === 'create'
          ? `新配对「${plan.title}」已同步（v${v}）。`
          : item.action === 'restore'
            ? `配对「${plan.title}」已按你的确认恢复并同步（v${v}）。`
            : `配对「${plan.title}」已逐字段合并并同步（v${v}）。`,
      );
    }
  }

  // 已处理配对的 outbox 清空
  db.outbox = db.outbox.filter((op) => !touched.has(op.pairId));
  db.session = null;
  return { ok: true };
}

/** 为合并计划注入本地/远端字段元数据（供逐字段修订时间合并使用） */
export function annotatePlansWithLocal(session: PendingSession, db: LocalDB): void {
  for (const plan of session.plans) {
    const local = db.pairs[plan.pairId];
    if (local) {
      (plan as unknown as PlanMeta)._localFields = { ...local.fields };
      (plan as unknown as PlanMeta)._localBy = local.updatedBy;
    }
    const remote = session.base.pairs[plan.pairId];
    if (remote) {
      (plan as unknown as PlanMeta)._remoteFields = { ...remote.fields };
    }
  }
}

/** 回收/恢复：把回收站副本重新写回本地并安排下一批同步 */
export function restoreRecycleEntry(db: LocalDB, entryId: string): void {
  const idx = db.recycle.findIndex((e) => e.id === entryId);
  if (idx < 0) return;
  const entry = db.recycle[idx];
  const doc: PairDoc = { ...entry.local };
  db.pairs[entry.pairId] = doc;
  db.tombstones = db.tombstones.filter((x) => x.id !== entry.pairId);
  db.outbox.push({
    id: uid('op'),
    pairId: entry.pairId,
    kind: 'create',
    at: Date.now(),
    by: CURRENT_USER,
    fields: [...FIELD_KEYS],
  });
  db.recycle.splice(idx, 1);
  addLog(db, 'info', `已从回收站恢复「${doc.title}」，将在下一次同步时重新提交。`);
}

export function purgeRecycleEntry(db: LocalDB, entryId: string): void {
  const idx = db.recycle.findIndex((e) => e.id === entryId);
  if (idx < 0) return;
  const [entry] = db.recycle.splice(idx, 1);
  delete db.pairs[entry.pairId];
  delete db.bases[entry.pairId];
  addLog(db, 'info', `回收站副本「${entry.local.title}」已永久丢弃。`);
}
