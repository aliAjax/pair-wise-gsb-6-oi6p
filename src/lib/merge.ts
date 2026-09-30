import type {
  FieldKey,
  FieldValue,
  MergeIssue,
  PairDoc,
  PairPlan,
  PendingSession,
  RemoteDoc,
  RemoteSnapshot,
} from './types';
import { FIELD_KEYS } from './types';
import { CURRENT_USER, uid } from './db';

type ValMap = Record<FieldKey, FieldValue>;

function val(doc: Partial<Record<FieldKey, FieldValue>> | null | undefined, k: FieldKey): FieldValue | null {
  if (!doc) return null;
  const v = doc[k];
  return v === undefined ? null : v;
}

function fieldLabel(k: FieldKey): string {
  const map: Record<FieldKey, string> = {
    title: '名称',
    heading: '标题文案',
    body: '正文',
    category: '分类',
    favorite: '收藏',
    headingFont: '标题字体',
    bodyFont: '正文字体',
    size: '字号',
    weight: '字重',
    leading: '行高',
    tracking: '字距',
  };
  return map[k];
}

function fmtVal(v: FieldValue | null): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  return String(v);
}

interface ComputeInput {
  locals: Record<string, PairDoc>;
  bases: Record<string, { version: number; values: ValMap }>;
  tombstones: { id: string; at: number; by: string }[];
  outboxPairIds: Set<string>;
  snapshot: RemoteSnapshot;
  localCategories: string[];
}

/**
 * 逐字段三方合并：
 * - B=L=R 相同
 * - 仅一边改 → 取改动方
 * - B=L≠R 远端独占改动 → 取远端（pull）
 * - B=R≠L 本地独占改动 → 取本地
 * - B≠L、B≠R、L≠R → 字段冲突，逐字段列待确认项
 * 分类归属对不上（远端改名 / 本地移动 / 互删分类）→ 专属待确认项。
 */
export function computeMerge(input: ComputeInput): PendingSession {
  const { locals, bases, tombstones, outboxPairIds, snapshot, localCategories } = input;
  const plans: PairPlan[] = [];

  const allIds = new Set<string>([
    ...Object.keys(locals),
    ...Object.keys(snapshot.pairs),
    ...Object.keys(snapshot.tombstones),
    ...tombstones.map((t) => t.id),
  ]);

  const localTombMap = new Map(tombstones.map((t) => [t.id, t]));
  const localCreated = (id: string) => !bases[id] && !!locals[id];

  for (const id of allIds) {
    const local = locals[id] ?? null;
    const remote = snapshot.pairs[id] ?? null;
    const remoteTomb = snapshot.tombstones[id] ?? null;
    const base = bases[id] ?? null;
    const lTomb = localTombMap.get(id) ?? null;
    const inOutbox = outboxPairIds.has(id);

    // 1) 本地新建（无基准）
    if (local && localCreated(id)) {
      if (remote) {
        // 双方各自新建了同 id 概率极低（uid 冲突），按冲突处理
        plans.push(conflictPlan(id, local, remote, null, snapshot, localCategories));
        continue;
      }
      plans.push({
        pairId: id,
        title: local.title,
        kind: 'create',
        autoValues: fromDoc(local),
        origins: sameOrigins(local, null, null, 'local'),
        issues: [],
        expectedVersion: null,
        remoteVersion: null,
        baseValues: null,
      });
      continue;
    }

    // 2) 本地已删
    if (lTomb) {
      // 远端也已删 → 双方一致删除
      if (!remote && remoteTomb) {
        plans.push({
          pairId: id,
          title: remoteTomb.snapshot?.title ?? local?.title ?? id,
          kind: 'both-delete',
          autoValues: (remoteTomb.snapshot ? fromDoc(stripVersion(remoteTomb.snapshot)) : local ? fromDoc(local) : {}) as ValMap,
          origins: FIELD_KEYS.reduce((acc, k) => {
            acc[k] = 'same';
            return acc;
          }, {} as PairPlan['origins']),
          issues: [],
          expectedVersion: remoteTomb.version,
          remoteVersion: remoteTomb.version,
          baseValues: base?.values ?? null,
          remoteTomb,
        });
        continue;
      }
      if (remote) {
        const changedRemote = FIELD_KEYS.some(
          (k) => fmtVal(val(base?.values, k)) !== fmtVal(val(remote, k)),
        );
        if (changedRemote) {
          plans.push(localDeletePlan(id, remote, base!, lTomb, snapshot, localCategories));
          continue;
        }
        // 远端没动 → 双方一致删除
        plans.push({
          pairId: id,
          title: remote.title,
          kind: 'both-delete',
          autoValues: fromDoc(remote),
          origins: sameOrigins(remote, base!.values, remote),
          issues: [],
          expectedVersion: remote.version,
          remoteVersion: remote.version,
          baseValues: base!.values,
        });
        continue;
      }
      // 远端也不存在：确认墓碑即可，无需提交
      continue;
    }

    // 3) 远端已删、本地仍在
    if (!remote && remoteTomb && local && base) {
      const localChanges = FIELD_KEYS.filter(
        (k) => fmtVal(val(base.values, k)) !== fmtVal(val(local, k)),
      ).map((k) => ({
        field: k,
        from: val(base.values, k)!,
        to: val(local, k)!,
        at: local.fields[k],
      }));

      if (localChanges.length > 0) {
        // 远端移除 + 本地有新改动 → 回收站副本（不自动删本地）
        plans.push({
          pairId: id,
          title: local.title,
          kind: 'remote-delete',
          autoValues: fromDoc(local),
          origins: sameOrigins(local, base.values, null, 'local'),
          issues: [],
          expectedVersion: remoteTomb.version,
          remoteVersion: remoteTomb.version,
          baseValues: base.values,
          remoteTomb,
          localChanges,
        });
      } else {
        // 本地没动 → 静默跟随删除
        plans.push({
          pairId: id,
          title: remoteTomb.snapshot?.title ?? local.title,
          kind: 'both-delete',
          autoValues: fromDoc(local),
          origins: sameOrigins(local, base.values, null),
          issues: [],
          expectedVersion: remoteTomb.version,
          remoteVersion: remoteTomb.version,
          baseValues: base.values,
          remoteTomb,
        });
      }
      continue;
    }

    // 4) 仅远端存在（其他端新建，本地无基准、无墓碑）
    if (remote && !local && !base) {
      plans.push({
        pairId: id,
        title: remote.title,
        kind: 'pull',
        autoValues: fromDoc(remote),
        origins: sameOrigins(remote, null, remote, 'remote'),
        issues: [],
        expectedVersion: remote.version,
        remoteVersion: remote.version,
        baseValues: null,
        remoteDoc: stripVersion(remote),
      });
      continue;
    }

    // 5) 双方都在：逐字段三方合并
    if (local && remote && base) {
      plans.push(
        conflictPlan(id, local, remote, base, snapshot, localCategories, !!inOutbox),
      );
      continue;
    }

    // 6) 仅本地存在、远端无墓碑也无文档：保留本地（一般是未入批次的纯本地文档）
    if (local && !remote && !remoteTomb) {
      plans.push({
        pairId: id,
        title: local.title,
        kind: 'create',
        autoValues: fromDoc(local),
        origins: sameOrigins(local, null, null, 'local'),
        issues: [],
        expectedVersion: null,
        remoteVersion: null,
        baseValues: null,
      });
    }
  }

  return {
    batchId: uid('batch'),
    startedAt: Date.now(),
    base: snapshot,
    plans,
    status: 'awaiting',
    attempts: 1,
  };
}

function fromDoc(doc: PairDoc): ValMap {
  return FIELD_KEYS.reduce((acc, k) => {
    acc[k] = doc[k];
    return acc;
  }, {} as ValMap);
}

function stripVersion(doc: RemoteDoc): PairDoc {
  const { version: _v, ...rest } = doc;
  return rest;
}

function sameOrigins(
  _doc: PairDoc,
  _base: ValMap | null,
  _remote: PairDoc | RemoteDoc | null,
  force?: 'local' | 'remote' | 'same',
): PairPlan['origins'] {
  return FIELD_KEYS.reduce((acc, k) => {
    acc[k] = force ?? 'same';
    return acc;
  }, {} as PairPlan['origins']);
}

function conflictPlan(
  id: string,
  local: PairDoc,
  remote: RemoteDoc,
  base: { version: number; values: ValMap } | null,
  snapshot: RemoteSnapshot,
  localCategories: string[],
  inOutbox = true,
): PairPlan {
  const bv = base?.values ?? null;
  const autoValues: ValMap = {} as ValMap;
  const origins: PairPlan['origins'] = {} as PairPlan['origins'];
  const issues: MergeIssue[] = [];

  for (const k of FIELD_KEYS) {
    if (k === 'category') continue; // 分类单独处理归属
    const b = val(bv, k);
    const l = val(local, k);
    const r = val(remote, k);
    const same = (a: FieldValue | null, c: FieldValue | null) => fmtVal(a) === fmtVal(c);

    if (same(l, r)) {
      autoValues[k] = l as FieldValue;
      origins[k] = 'same';
    } else if (same(b, l)) {
      autoValues[k] = r as FieldValue;
      origins[k] = same(b, r) ? 'same' : 'remote';
    } else if (same(b, r)) {
      autoValues[k] = l as FieldValue;
      origins[k] = 'local';
    } else {
      // 三方都不一样 → 字段冲突
      autoValues[k] = l as FieldValue; // 占位，预览不展示直到确认
      origins[k] = 'local';
      issues.push({
        id: uid('iss'),
        pairId: id,
        kind: 'field-conflict',
        field: k,
        summary: `「${fieldLabel(k)}」双方都修改了`,
        base: b,
        local: l,
        remote: r,
        localBy: local.updatedBy,
        localAt: local.fields[k],
        remoteBy: remote.updatedBy,
        remoteAt: remote.fields[k],
      });
    }
  }

  // ---- 分类归属核对 ----
  const cb = val(bv, 'category');
  const cl = val(local, 'category');
  const cr = val(remote, 'category');
  const rename = snapshot.renames.find(
    (rn) => rn.from === cb && rn.to === cr && !sameVal(cl, cr),
  );

  if (!sameVal(cl, cr)) {
    if (rename && sameVal(cb, cl)) {
      // 远端把分类改名了，本地没动 → 自动跟随
      autoValues.category = cr!;
      origins.category = 'remote';
    } else if (rename && !sameVal(cb, cl)) {
      // 远端改名 + 本地把配对移到别的分类 → 归属对不上
      issues.push({
        id: uid('iss'),
        pairId: id,
        kind: 'category-rename',
        field: 'category',
        summary: `远端把分类「${cb}」改名为「${cr}」，但你已将此配对移到「${cl}」`,
        base: cb,
        local: cl,
        remote: cr,
        localBy: local.updatedBy,
        localAt: local.fields.category,
        remoteBy: rename.by,
        remoteAt: rename.at,
        options: [...new Set([...snapshot.categories, ...localCategories])],
      });
      autoValues.category = cl!;
      origins.category = 'local';
    } else {
      // 普通分类冲突：两位设计师选择了不同分类（后保存盖分类的场景）
      const bEqL = sameVal(cb, cl);
      const bEqR = sameVal(cb, cr);
      issues.push({
        id: uid('iss'),
        pairId: id,
        kind: 'category-rename',
        field: 'category',
        summary:
          bEqL && !bEqR
            ? `对端把分类改成了「${cr}」`
            : bEqR && !bEqL
              ? `你把分类改成了「${cl}」，对端未动`
              : `分类归属不一致：你选择「${cl}」，对端选择「${cr}」`,
        base: cb,
        local: cl,
        remote: cr,
        localBy: local.updatedBy,
        localAt: local.fields.category,
        remoteBy: remote.updatedBy,
        remoteAt: remote.fields.category,
        options: [...new Set([...snapshot.categories, ...localCategories])],
      });
      autoValues.category = cl!;
      origins.category = 'local';
    }
  } else {
    autoValues.category = cl!;
    origins.category = 'same';
  }

  // 未在 outbox 且无任何本地改动 → 纯 pull
  const localChanged =
    !inOutbox &&
    bv &&
    FIELD_KEYS.every((k) => sameVal(val(bv, k), val(local, k)));
  const onlyRemoteChanged =
    bv && FIELD_KEYS.every((k) => origins[k] === 'remote' || origins[k] === 'same');

  const kind: PairPlan['kind'] = onlyRemoteChanged && issues.length === 0 ? 'pull' : 'update';
  if (localChanged) {
    // 本地零改动：全部以远端为准
    FIELD_KEYS.forEach((k) => {
      autoValues[k] = val(remote, k)!;
      origins[k] = sameVal(val(bv, k), val(remote, k)) ? 'same' : 'remote';
    });
    return {
      pairId: id,
      title: remote.title,
      kind: 'pull',
      autoValues,
      origins,
      issues: [],
      expectedVersion: remote.version,
      remoteVersion: remote.version,
      baseValues: bv,
      remoteDoc: stripVersion(remote),
    };
  }

  return {
    pairId: id,
    title: local.title,
    kind,
    autoValues,
    origins,
    issues,
    expectedVersion: remote.version,
    remoteVersion: remote.version,
    baseValues: bv,
  };
}

function localDeletePlan(
  id: string,
  remote: RemoteDoc,
  base: { version: number; values: ValMap },
  lTomb: { at: number; by: string },
  snapshot: RemoteSnapshot,
  localCategories: string[],
): PairPlan {
  const changedFields = FIELD_KEYS.filter(
    (k) => !sameVal(val(base.values, k), val(remote, k)),
  );
  const issues: MergeIssue[] = [
    {
      id: uid('iss'),
      pairId: id,
      kind: 'local-delete-remote-edit',
      summary: `你离线删除了该配对，但对端修改了 ${changedFields.length} 个字段（${changedFields
        .map(fieldLabel)
        .join('、')}）`,
      base: null,
      local: null,
      remote: null,
      localBy: lTomb.by,
      localAt: lTomb.at,
      remoteBy: remote.updatedBy,
      remoteAt: remote.updatedAt,
    },
  ];
  return {
    pairId: id,
    title: remote.title,
    kind: 'local-delete',
    autoValues: fromDoc(remote),
    origins: sameOrigins(stripVersion(remote), base.values, remote, 'remote'),
    issues,
    expectedVersion: remote.version,
    remoteVersion: remote.version,
    baseValues: base.values,
    remoteDoc: stripVersion(remote),
  };
}

function sameVal(a: FieldValue | null, b: FieldValue | null): boolean {
  return fmtVal(a) === fmtVal(b);
}

/* ---------------- 预览与确认 ---------------- */

export function planResolved(plan: PairPlan): boolean {
  return plan.issues.every((i) => !!i.resolution);
}

export function allResolved(session: PendingSession): boolean {
  return session.plans.every(planResolved);
}

/** 应用确认项后的最终字段值；未全部确认的计划返回 null（预览不展示） */
export function resolvedValues(plan: PairPlan): ValMap | null {
  if (!planResolved(plan)) return null;
  const values = { ...plan.autoValues };
  for (const iss of plan.issues) {
    if (!iss.field) continue;
    const res = iss.resolution!;
    if (res.choice === 'local') values[iss.field] = iss.local as FieldValue;
    else if (res.choice === 'remote') values[iss.field] = iss.remote as FieldValue;
    else if (res.choice === 'custom') values[iss.field] = res.value as FieldValue;
  }
  return values;
}

export interface PreviewItem {
  plan: PairPlan;
  values: ValMap | null;
  /** 最终提交动作 */
  action: 'none' | 'create' | 'update' | 'pull' | 'delete' | 'recycle' | 'restore';
  origins: PairPlan['origins'];
  ready: boolean;
}

export function buildPreview(session: PendingSession): PreviewItem[] {
  return session.plans.map((plan) => {
    const ready = planResolved(plan);
    const values = resolvedValues(plan);

    let action: PreviewItem['action'] = 'none';
    switch (plan.kind) {
      case 'create':
        action = 'create';
        break;
      case 'pull':
        action = 'pull';
        break;
      case 'both-delete':
        action = 'delete';
        break;
      case 'remote-delete':
        action = 'recycle';
        break;
      case 'local-delete': {
        const choice = plan.issues[0]?.resolution?.choice;
        // 远端文档仍在：恢复 = 接收对端版本（pull），无需写远端
        action = choice === 'restore' ? 'pull' : choice === 'delete' ? 'delete' : 'none';
        break;
      }
      case 'update':
        action = 'update';
        break;
    }
    return {
      plan,
      values,
      action,
      origins: plan.origins,
      ready,
    };
  });
}

export function issueCount(session: PendingSession): number {
  return session.plans.reduce((n, p) => n + p.issues.filter((i) => !i.resolution).length, 0);
}

export function resolveIssue(session: PendingSession, issueId: string, resolution: NonNullable<MergeIssue['resolution']>): void {
  for (const p of session.plans) {
    const iss = p.issues.find((i) => i.id === issueId);
    if (iss) {
      iss.resolution = resolution;
      return;
    }
  }
}

export function isMine(by?: string): boolean {
  return !by || by === CURRENT_USER;
}
