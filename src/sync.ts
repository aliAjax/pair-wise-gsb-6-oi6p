// 离线续作 + 回网字段级合并引擎（纯函数，不依赖 React）
//
// 核心模型：
// - 每个配对的每个字段单独记录修订时间 cell.at
// - Pair.shadow / baseVersion 记录上次与服务端对齐时的字段快照（基准）
// - 同步时冻结成 Batch（原批次），无论重试还是重开，都按 batch.baseVersion 核对
// - 三路合并：基准值 vs 本地值 vs 服务端当前值，逐字段判定

export type Val = string | number | boolean;

export type FieldName =
  | 'title'
  | 'heading'
  | 'body'
  | 'category'
  | 'favorite'
  | 'headingFont'
  | 'bodyFont'
  | 'size'
  | 'weight'
  | 'leading'
  | 'tracking';

export interface Cell {
  v: Val;
  at: number; // 字段修订时间
}
export type Cells = Record<FieldName, Cell>;

/** 本机配对：cells 为当前值，shadow 为基准快照，baseVersion 为基准版本 */
export interface Pair {
  id: string;
  synced: boolean; // 服务端是否已存在
  baseVersion: number;
  shadow: Partial<Cells>;
  cells: Cells;
  createdAt: number;
}

export interface RemotePair {
  id: string;
  version: number;
  cells: Cells;
}

export interface Tombstone {
  id: string;
  deletedAt: number;
  version: number;
  snapshot: RemotePair;
}

export interface RemoteDB {
  version: number;
  pairs: Record<string, RemotePair>;
  tombstones: Record<string, Tombstone>;
}

/** 本机已删除、待同步时告知服务端的配对 */
export interface PendingDelete {
  id: string;
  at: number;
  title: string;
  ref: { cells: Cells; shadow: Partial<Cells>; baseVersion: number };
}

export interface Change {
  id: string;
  kind: 'edit' | 'delete';
  field?: FieldName;
  baseV?: Val;
  localV?: Val;
  localAt: number;
}

export type BatchStatus = 'pending' | 'failed' | 'review';

/** 原批次：创建时冻结基准版本、改动和引用快照；失败重试 / 重开核对都用它 */
export interface Batch {
  id: string;
  baseVersion: number;
  createdAt: number;
  attempts: number;
  status: BatchStatus;
  error?: string;
  changes: Change[];
  refPairs: Record<
    string,
    { cells: Cells; shadow: Partial<Cells>; synced: boolean; title: string }
  >;
}

export interface ConflictOption {
  key: string;
  label: string;
  value?: Val;
}

export interface Conflict {
  key: string;
  pairId: string;
  field?: FieldName;
  kind: 'field' | 'deletion' | 'category';
  title: string;
  baseV: Val | undefined;
  localV: Val | undefined;
  remoteV: Val | undefined;
  options: ConflictOption[];
  resolution?: string;
}

export type AutoItem =
  | { kind: 'create'; id: string; title: string }
  | {
      kind: 'field';
      id: string;
      field: FieldName;
      from: Val | undefined;
      to: Val;
      via: 'local' | 'incoming';
      title: string;
    }
  | { kind: 'delete'; id: string; via: 'local' | 'incoming'; title: string };

/** 回收站副本草稿：提交合并时才正式入站（失败的合并不产生副作用） */
export interface TrashDraft {
  pairId: string;
  title: string;
  original: RemotePair;
  localChanges: Change[];
  deletedAt: number;
}

export interface TrashRecord extends TrashDraft {
  trashId: string;
  batchId: string;
  detectedAt: number;
  status: 'recycle' | 'restored' | 'purged';
  log: { at: number; text: string }[];
}

export interface Review {
  batchId: string;
  baseVersion: number;
  remoteVersion: number;
  attemptedAt: number;
  rechecked: boolean;
  auto: AutoItem[];
  conflicts: Conflict[];
  trash: TrashDraft[];
}

export const FIELDS: FieldName[] = [
  'title',
  'heading',
  'body',
  'category',
  'favorite',
  'headingFont',
  'bodyFont',
  'size',
  'weight',
  'leading',
  'tracking',
];

export const CATEGORIES = [
  { name: 'Editorial', color: '#e8b7a0' },
  { name: 'Portfolio', color: '#9fc9be' },
  { name: 'Brand voice', color: '#b4add8' },
  { name: 'Untitled', color: '#c9c6ba' },
];

export const FIELD_LABEL: Record<FieldName, string> = {
  title: '配对名称',
  heading: '标题文案',
  body: '正文文案',
  category: '分类归属',
  favorite: '收藏标记',
  headingFont: '标题字体',
  bodyFont: '正文字体',
  size: '字号',
  weight: '字重',
  leading: '行高',
  tracking: '字距',
};

export function fmt(field: FieldName | undefined, v: Val | undefined): string {
  if (v === undefined) return '—';
  if (field === 'favorite') return v ? '已收藏' : '未收藏';
  if (field === 'size') return `${v}px`;
  if (field === 'tracking') return `${v}px`;
  return String(v);
}

export function eq(a: Val | undefined, b: Val | undefined): boolean {
  return Object.is(a, b);
}

export function dirtyFields(p: Pair): FieldName[] {
  return FIELDS.filter((f) => !eq(p.cells[f].v, p.shadow[f]?.v));
}

let clockSeq = 0;
export function tick(now: number = Date.now()): number {
  clockSeq = (clockSeq + 1) % 1000;
  return now * 1000 + clockSeq;
}

export function fmtTime(at: number): string {
  const d = new Date(Math.floor(at / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// 批次构建：把本机相对基准的改动冻结成批次
// ---------------------------------------------------------------------------

export function buildBatch(
  pairs: Pair[],
  pendingDeletes: Record<string, PendingDelete>,
  remoteVersion: number,
  now: number,
): Batch | null {
  const changes: Change[] = [];
  const refPairs: Batch['refPairs'] = {};

  for (const p of pairs) {
    refPairs[p.id] = {
      cells: JSON.parse(JSON.stringify(p.cells)),
      shadow: JSON.parse(JSON.stringify(p.shadow)),
      synced: p.synced,
      title: String(p.cells.title.v),
    };
    for (const f of FIELDS) {
      const cur = p.cells[f].v;
      const base = p.shadow[f]?.v;
      if (!eq(cur, base)) {
        changes.push({
          id: p.id,
          kind: 'edit',
          field: f,
          baseV: base,
          localV: cur,
          localAt: p.cells[f].at,
        });
      }
    }
  }

  for (const id of Object.keys(pendingDeletes)) {
    const d = pendingDeletes[id];
    refPairs[id] = {
      cells: JSON.parse(JSON.stringify(d.ref.cells)),
      shadow: JSON.parse(JSON.stringify(d.ref.shadow)),
      synced: true,
      title: d.title,
    };
    changes.push({ id, kind: 'delete', localAt: d.at });
  }

  // 纯拉取（本机无改动但远端有新版本）也允许建空批次
  if (changes.length === 0) {
    const allAligned = pairs.every((p) => {
      if (!p.synced) return false;
      return FIELDS.every((f) => eq(p.shadow[f]?.v, p.cells[f].v));
    });
    if (allAligned && Object.keys(pendingDeletes).length === 0) return null;
  }

  return {
    id: `b${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    baseVersion: remoteVersion,
    createdAt: now,
    attempts: 0,
    status: 'pending',
    changes,
    refPairs,
  };
}

// ---------------------------------------------------------------------------
// 逐字段三路合并（只读，不产生副作用）
// ---------------------------------------------------------------------------

export function conflictKey(pairId: string, kind: string, field?: string) {
  return `${pairId}:${kind}:${field ?? '-'}`;
}

export function computeMerge(
  remote: RemoteDB,
  batch: Batch,
): { auto: AutoItem[]; conflicts: Conflict[]; trash: TrashDraft[] } {
  const auto: AutoItem[] = [];
  const conflicts: Conflict[] = [];
  const trash: TrashDraft[] = [];
  const ref = batch.refPairs;

  const titleOf = (id: string) =>
    remote.pairs[id]?.cells.title.v as string | undefined
      ? String(remote.pairs[id]?.cells.title.v)
      : ref[id]?.title ?? id;

  const pushAuto = (item: AutoItem) => {
    const dup = auto.some((a) => {
      if (a.kind !== item.kind) return false;
      if (a.kind === 'field' && item.kind === 'field')
        return a.id === item.id && a.field === item.field;
      return a.id === (item as { id: string }).id;
    });
    if (!dup) auto.push(item);
  };
  const pushConflict = (c: Conflict) => {
    if (!conflicts.some((x) => x.key === c.key)) conflicts.push(c);
  };

  const editChanges = batch.changes.filter((c) => c.kind === 'edit');
  const deleteChanges = batch.changes.filter((c) => c.kind === 'delete');

  // 1) 本地字段改动
  for (const c of editChanges) {
    const f = c.field!;
    const rp = remote.pairs[c.id];
    const tb = remote.tombstones[c.id];

    // 远端已删除 + 本地有新改动 → 回收站副本
    if (tb) {
      if (!trash.some((t) => t.pairId === c.id)) {
        const localChanges = editChanges.filter((x) => x.id === c.id);
        trash.push({
          pairId: c.id,
          title: String(tb.snapshot.cells.title.v),
          original: JSON.parse(JSON.stringify(tb.snapshot)),
          localChanges,
          deletedAt: tb.deletedAt,
        });
      }
      continue;
    }

    // 远端不存在 → 本地新建
    if (!rp) {
      pushAuto({ kind: 'create', id: c.id, title: ref[c.id]?.title ?? c.id });
      continue;
    }

    const remoteV = rp.cells[f].v;
    if (eq(remoteV, c.baseV) || eq(remoteV, c.localV)) {
      // 远端该字段没动过（或两边改成相同值）→ 本地值直接写入
      pushAuto({
        kind: 'field',
        id: c.id,
        field: f,
        from: c.baseV,
        to: c.localV!,
        via: 'local',
        title: titleOf(c.id),
      });
    } else {
      // 同一字段两边都改了 → 待确认
      pushConflict({
        key: conflictKey(c.id, 'field', f),
        pairId: c.id,
        field: f,
        kind: 'field',
        title: titleOf(c.id),
        baseV: c.baseV,
        localV: c.localV,
        remoteV,
        options: [
          { key: 'local', label: `采用本地：${fmt(f, c.localV)}`, value: c.localV },
          { key: 'remote', label: `采用远端：${fmt(f, remoteV)}`, value: remoteV },
        ],
      });
    }
  }

  // 2) 本地删除
  for (const c of deleteChanges) {
    const rp = remote.pairs[c.id];
    const tb = remote.tombstones[c.id];
    if (tb) {
      pushAuto({ kind: 'delete', id: c.id, via: 'local', title: ref[c.id]?.title ?? c.id });
      continue;
    }
    if (!rp) continue;
    const shadow = ref[c.id]?.shadow ?? {};
    const remoteMoved = FIELDS.some((f) => {
      const sv = shadow[f]?.v;
      return sv !== undefined && !eq(sv, rp.cells[f].v);
    });
    if (remoteMoved) {
      pushConflict({
        key: conflictKey(c.id, 'deletion'),
        pairId: c.id,
        kind: 'deletion',
        title: titleOf(c.id),
        baseV: undefined,
        localV: undefined,
        remoteV: rp.cells.title.v,
        options: [
          { key: 'local', label: '确认删除（以本机为准）' },
          { key: 'remote', label: '保留远端版本' },
        ],
      });
    } else {
      pushAuto({ kind: 'delete', id: c.id, via: 'local', title: titleOf(c.id) });
    }
  }

  // 3) 远端变更下传（本机未改动的字段才自动并入）
  for (const [id, r] of Object.entries(ref)) {
    if (!r.synced) continue;
    if (pending(deleteChanges, id)) continue;
    const tb = remote.tombstones[id];
    if (tb) {
      const localEdited = editChanges.some((c) => c.id === id);
      if (!localEdited) {
        pushAuto({ kind: 'delete', id, via: 'incoming', title: r.title });
      }
      continue;
    }
    const rp = remote.pairs[id];
    if (!rp) continue;
    for (const f of FIELDS) {
      const base = r.shadow[f]?.v;
      const remoteV = rp.cells[f].v;
      if (eq(base, remoteV)) continue;
      const localTouched = editChanges.some((c) => c.id === id && c.field === f);
      const inConflict = conflicts.some(
        (c) => c.pairId === id && c.field === f,
      );
      if (!localTouched && !inConflict) {
        pushAuto({
          kind: 'field',
          id,
          field: f,
          from: base,
          to: remoteV,
          via: 'incoming',
          title: titleOf(id),
        });
      }
    }
  }

  // 4) 分类成员与归属核对：合并后分类不在已知集合内 → 待确认
  const touchedIds = new Set<string>([
    ...auto.filter((a) => a.kind !== 'create').map((a) => a.id),
    ...conflicts.map((c) => c.pairId),
  ]);
  for (const id of touchedIds) {
    const rp = remote.pairs[id];
    if (!rp) continue;
    if (conflicts.some((c) => c.pairId === id && c.field === 'category')) continue;
    const localCatChange = editChanges.find((c) => c.id === id && c.field === 'category');
    const effective = localCatChange ? localCatChange.localV : rp.cells.category.v;
    if (
      typeof effective === 'string' &&
      !CATEGORIES.some((c) => c.name === effective)
    ) {
      const oldCat = ref[id]?.shadow.category?.v;
      if (!eq(effective, oldCat)) {
        pushConflict({
          key: conflictKey(id, 'category', 'category'),
          pairId: id,
          field: 'category',
          kind: 'category',
          title: titleOf(id),
          baseV: oldCat,
          localV: oldCat,
          remoteV: effective,
          options: [
            { key: 'remote', label: `保留远端原值「${effective}」`, value: effective },
            ...CATEGORIES.map((c) => ({
              key: c.name,
              label: `归入「${c.name}」`,
              value: c.name as Val,
            })),
          ],
        });
      }
    }
  }

  return { auto, conflicts, trash };
}

function pending(deleteChanges: Change[], id: string) {
  return deleteChanges.some((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// 提交：确认后的预览落到远端与本机，重算基准版本
// ---------------------------------------------------------------------------

export interface CommitSummary {
  creates: number;
  localFields: number;
  incomingFields: number;
  deletes: number;
  trashed: number;
  resolved: number;
  unresolved: number;
}

export function applyCommit(
  remote0: RemoteDB,
  review: Review,
  batch: Batch,
  livePairs0: Pair[],
  pend0: Record<string, PendingDelete>,
  trash0: TrashRecord[],
  now: number,
): {
  remote: RemoteDB;
  pairs: Pair[];
  pendingDeletes: Record<string, PendingDelete>;
  trash: TrashRecord[];
  summary: CommitSummary;
} {
  const remote: RemoteDB = JSON.parse(JSON.stringify(remote0));
  const pairs: Pair[] = JSON.parse(JSON.stringify(livePairs0));
  const pendingDeletes: Record<string, PendingDelete> = JSON.parse(
    JSON.stringify(pend0),
  );
  const trash: TrashRecord[] = JSON.parse(JSON.stringify(trash0));
  const newVersion = remote.version + 1;
  const writtenRemote = new Set<string>();
  const touchedLive = new Set<string>();

  const pairById = new Map(pairs.map((p) => [p.id, p]));
  const markLive = (id: string) => touchedLive.add(id);

  const writeRemoteField = (id: string, f: FieldName, v: Val) => {
    const rp = remote.pairs[id];
    if (!rp || eq(rp.cells[f].v, v)) return;
    rp.cells[f] = { v, at: now };
    writtenRemote.add(id);
  };
  const adoptLocal = (id: string, f: FieldName, v: Val) => {
    const p = pairById.get(id);
    if (!p) return;
    if (eq(p.cells[f].v, v)) p.shadow[f] = { v, at: now };
    markLive(id);
  };
  const adoptRemote = (id: string, f: FieldName, v: Val) => {
    const p = pairById.get(id);
    if (!p) return;
    // 本机期间又改过同一字段则不覆盖，留给下一批次
    if (!eq(p.cells[f].v, v) && !eq(p.cells[f].v, p.shadow[f]?.v)) return;
    p.cells[f] = { v, at: now };
    p.shadow[f] = { v, at: now };
    markLive(id);
  };

  const summary: CommitSummary = {
    creates: 0,
    localFields: 0,
    incomingFields: 0,
    deletes: 0,
    trashed: 0,
    resolved: 0,
    unresolved: 0,
  };

  // 自动项
  for (const item of review.auto) {
    if (item.kind === 'create') {
      const frozen = batch.refPairs[item.id];
      const live = pairById.get(item.id);
      if (!frozen || !live) continue; // 建批次后又被本机删掉
      remote.pairs[item.id] = {
        id: item.id,
        version: newVersion,
        cells: JSON.parse(JSON.stringify(live.cells)),
      };
      writtenRemote.add(item.id);
      live.synced = true;
      live.shadow = JSON.parse(JSON.stringify(live.cells));
      live.baseVersion = newVersion;
      summary.creates++;
      continue;
    }

    if (item.kind === 'delete') {
      if (item.via === 'local') {
        const rp = remote.pairs[item.id];
        if (rp) {
          remote.tombstones[item.id] = {
            id: item.id,
            deletedAt: now,
            version: newVersion,
            snapshot: JSON.parse(JSON.stringify(rp)),
          };
          delete remote.pairs[item.id];
        }
      }
      const idx = pairs.findIndex((p) => p.id === item.id);
      if (idx >= 0) pairs.splice(idx, 1);
      delete pendingDeletes[item.id];
      summary.deletes++;
      continue;
    }

    // field
    if (item.via === 'local') {
      writeRemoteField(item.id, item.field, item.to);
      adoptLocal(item.id, item.field, item.to);
      summary.localFields++;
    } else {
      adoptRemote(item.id, item.field, item.to);
      summary.incomingFields++;
    }
  }

  // 冲突项
  for (const c of review.conflicts) {
    if (!c.resolution) {
      summary.unresolved++;
      continue;
    }
    const opt = c.options.find((o) => o.key === c.resolution);
    summary.resolved++;

    if (c.kind === 'deletion') {
      if (c.resolution === 'local') {
        const rp = remote.pairs[c.pairId];
        if (rp) {
          remote.tombstones[c.pairId] = {
            id: c.pairId,
            deletedAt: now,
            version: newVersion,
            snapshot: JSON.parse(JSON.stringify(rp)),
          };
          delete remote.pairs[c.pairId];
        }
        const idx = pairs.findIndex((p) => p.id === c.pairId);
        if (idx >= 0) pairs.splice(idx, 1);
        delete pendingDeletes[c.pairId];
        summary.deletes++;
      } else {
        // 保留远端：撤销本机删除，用远端值重建本机副本
        delete pendingDeletes[c.pairId];
        const rp = remote.pairs[c.pairId];
        if (rp) {
          const frozen = batch.refPairs[c.pairId];
          let p = pairById.get(c.pairId);
          if (!p) {
            p = {
              id: c.pairId,
              synced: true,
              baseVersion: newVersion,
              shadow: {},
              cells: JSON.parse(JSON.stringify(rp.cells)),
              createdAt: frozen ? Math.floor(now / 1000) : now,
            };
            pairs.push(p);
            pairById.set(c.pairId, p);
          }
          for (const f of FIELDS) adoptRemote(c.pairId, f, rp.cells[f].v);
          p.baseVersion = newVersion;
        }
      }
      continue;
    }

    const f = c.field!;
    if (c.kind === 'category' && c.resolution !== 'remote') {
      const v = opt?.value;
      if (v !== undefined) {
        writeRemoteField(c.pairId, f, v);
        adoptLocal(c.pairId, f, v);
      }
    } else if (c.resolution === 'local') {
      writeRemoteField(c.pairId, f, c.localV!);
      adoptLocal(c.pairId, f, c.localV!);
    } else {
      adoptRemote(c.pairId, f, c.remoteV!);
    }
  }

  // 回收站副本（保留原值 + 处理记录）
  for (const d of review.trash) {
    if (!remote.tombstones[d.pairId]) {
      remote.tombstones[d.pairId] = {
        id: d.pairId,
        deletedAt: d.deletedAt,
        version: d.original.version,
        snapshot: JSON.parse(JSON.stringify(d.original)),
      };
    }
    trash.unshift({
      ...JSON.parse(JSON.stringify(d)),
      trashId: `${batch.id}:${d.pairId}`,
      batchId: batch.id,
      detectedAt: now,
      status: 'recycle',
      log: [
        { at: d.deletedAt, text: '远端移除了该配对' },
        {
          at: now,
          text: `回网合并检出本地有 ${d.localChanges.length} 项字段改动，原值保留为回收站副本`,
        },
      ],
    });
    const idx = pairs.findIndex((p) => p.id === d.pairId);
    if (idx >= 0) pairs.splice(idx, 1);
    delete pendingDeletes[d.pairId];
    summary.trashed++;
  }

  // 版本与基准重算
  remote.version = newVersion;
  for (const id of writtenRemote) {
    if (remote.pairs[id]) remote.pairs[id].version = newVersion;
  }
  for (const id of touchedLive) {
    const p = pairById.get(id);
    if (p && pairs.includes(p)) p.baseVersion = newVersion;
  }

  return { remote, pairs, pendingDeletes, trash, summary };
}
