import {
  applyCommit,
  Batch,
  buildBatch,
  CATEGORIES,
  Cell,
  Cells,
  computeMerge,
  FieldName,
  FIELDS,
  Pair,
  PendingDelete,
  RemoteDB,
  Review,
  tick,
  TrashRecord,
  Val,
} from './sync';

export type { Batch, Conflict, Review, TrashRecord } from './sync';

const STORAGE_KEY = 'type-pairer-repo-v1';
const BASE_TS = Date.UTC(2026, 8, 28, 9, 0, 0);

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'err';
}

export interface RepoState {
  online: boolean;
  failNext: boolean;
  pairs: Pair[];
  selectedId: string;
  remote: RemoteDB;
  pendingDeletes: Record<string, PendingDelete>;
  batch: Batch | null;
  review: Review | null;
  trash: TrashRecord[];
  lastSyncAt: number | null;
  toasts: Toast[];
}

function cell(v: Val, at = BASE_TS): Cell {
  return { v, at };
}

function makeCells(partial: Partial<Record<FieldName, Val>>): Cells {
  const defaults: Cells = {
    title: cell('Untitled'),
    heading: cell('A slower way to see'),
    body: cell('Good typography creates space for ideas to breathe.'),
    category: cell('Untitled'),
    favorite: cell(false),
    headingFont: cell('Fraunces'),
    bodyFont: cell('DM Sans'),
    size: cell(46),
    weight: cell(600),
    leading: cell(1.25),
    tracking: cell(0),
  };
  return Object.fromEntries(
    FIELDS.map((f) => [f, cell(partial[f] ?? defaults[f].v)]),
  ) as Cells;
}

function asPair(
  id: string,
  values: Partial<Record<FieldName, Val>>,
  synced: boolean,
  now: number,
): Pair {
  const cells = makeCells(values);
  return {
    id,
    synced,
    baseVersion: 1,
    shadow: synced ? JSON.parse(JSON.stringify(cells)) : {},
    cells,
    createdAt: now,
  };
}

function seed(): RepoState {
  const now = BASE_TS;
  const p1 = asPair(
    'p1',
    {
      title: 'Editorial calm',
      heading: 'A slower way to see',
      body: 'Good typography creates space for ideas to breathe. Pair a confident display face with a quiet, generous text face.',
      category: 'Editorial',
      favorite: true,
      headingFont: 'Fraunces',
      bodyFont: 'DM Sans',
    },
    true,
    now,
  );
  const p2 = asPair(
    'p2',
    {
      title: 'Studio notes',
      heading: 'Make room for the unexpected',
      body: 'A thoughtful pairing can add rhythm to even the simplest interface. Try contrast in shape, not just size.',
      category: 'Portfolio',
      favorite: false,
      headingFont: 'Playfair Display',
      bodyFont: 'IBM Plex Sans',
      size: 40,
    },
    true,
    now,
  );
  const p3 = asPair(
    'p3',
    {
      title: 'Field guide',
      heading: 'Small details, lasting impressions',
      body: 'Typography is the voice of a page. Find a combination that feels clear, warm and distinctly yours.',
      category: 'Brand voice',
      favorite: false,
      headingFont: 'Newsreader',
      bodyFont: 'Space Grotesk',
      size: 42,
      weight: 500,
    },
    true,
    now,
  );

  const remotePairs: RemoteDB['pairs'] = {};
  for (const p of [p1, p2, p3]) {
    remotePairs[p.id] = {
      id: p.id,
      version: 1,
      cells: JSON.parse(JSON.stringify(p.cells)),
    };
  }

  return {
    online: true,
    failNext: false,
    pairs: [p1, p2, p3],
    selectedId: 'p1',
    remote: { version: 1, pairs: remotePairs, tombstones: {} },
    pendingDeletes: {},
    batch: null,
    review: null,
    trash: [],
    lastSyncAt: null,
    toasts: [],
  };
}

export function initialState(): RepoState {
  const fresh = seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RepoState;
      return { ...fresh, ...parsed, toasts: [] };
    }
  } catch {
    /* ignore */
  }
  return fresh;
}

export function persist(s: RepoState) {
  const { toasts: _toasts, ...rest } = s;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

let toastSeq = 0;
function toast(text: string, kind: Toast['kind'] = 'info'): Toast {
  return { id: ++toastSeq, text, kind };
}

export type RepoAction =
  | { type: 'select'; id: string }
  | { type: 'edit'; id: string; field: FieldName; value: Val }
  | { type: 'create'; title: string }
  | { type: 'deleteLocal'; id: string }
  | { type: 'setOnline'; online: boolean }
  | { type: 'setFailNext'; value: boolean }
  | { type: 'sync' }
  | { type: 'openReview' }
  | { type: 'resolve'; key: string; resolution: string }
  | { type: 'commitReview' }
  | { type: 'cancelBatch' }
  | { type: 'closeReview' }
  | { type: 'dismissToast'; id: number }
  | { type: 'restoreTrash'; trashId: string }
  | { type: 'purgeTrash'; trashId: string }
  // 模拟"另一位设计师"对远端的操作
  | { type: 'simRemote'; scenario: SimScenario }
  | { type: 'resetDemo' };

export type SimScenario =
  | 'different-field'
  | 'same-field'
  | 'rename-category'
  | 'delete-pair';

export function reducer(s0: RepoState, a: RepoAction): RepoState {
  const pushToast = (s: RepoState, t: Omit<Toast, 'id'>): RepoState => ({
    ...s,
    toasts: [...s.toasts, toast(t.text, t.kind)].slice(-4),
  });

  switch (a.type) {
    case 'select':
      return { ...s0, selectedId: a.id };

    case 'edit': {
      const now = tick();
      return {
        ...s0,
        pairs: s0.pairs.map((p) =>
          p.id === a.id
            ? { ...p, cells: { ...p.cells, [a.field]: { v: a.value, at: now } } }
            : p,
        ),
      };
    }

    case 'create': {
      const now = tick();
      const id = `l${now.toString(36)}`;
      const p = asPair(
        id,
        { title: a.title.trim() || 'Untitled pairing' },
        false,
        now,
      );
      return { ...s0, pairs: [...s0.pairs, p], selectedId: id };
    }

    case 'deleteLocal': {
      const p = s0.pairs.find((x) => x.id === a.id);
      if (!p) return s0;
      const now = tick();
      const next: RepoState = {
        ...s0,
        pairs: s0.pairs.filter((x) => x.id !== a.id),
        pendingDeletes: p.synced
          ? {
              ...s0.pendingDeletes,
              [p.id]: {
                id: p.id,
                at: now,
                title: String(p.cells.title.v),
                ref: {
                  cells: JSON.parse(JSON.stringify(p.cells)),
                  shadow: JSON.parse(JSON.stringify(p.shadow)),
                  baseVersion: p.baseVersion,
                },
              },
            }
          : s0.pendingDeletes,
        selectedId:
          s0.selectedId === a.id
            ? s0.pairs.find((x) => x.id !== a.id)?.id ?? ''
            : s0.selectedId,
      };
      return pushToast(next, {
        text: p.synced
          ? '已在本机删除，回网同步时处理（删除改动待同步）'
          : '未同步的新配对已移除',
        kind: 'info',
      });
    }

    case 'setOnline': {
      let s: RepoState = { ...s0, online: a.online };
      s = pushToast(
        s,
        {
          text: a.online ? '已联网，可回网合并' : '已离线，改动保存在本机',
          kind: a.online ? 'ok' : 'warn',
        },
      );
      return s;
    }

    case 'setFailNext':
      return { ...s0, failNext: a.value };

    case 'sync': {
      if (!s0.online)
        return pushToast(s0, { text: '当前离线，改动已保存在本机', kind: 'warn' });

      // 已有原批次 → 重试，仍按冻结时的同一基准核对
      const batch =
        s0.batch ?? buildBatch(s0.pairs, s0.pendingDeletes, s0.remote.version, tick());
      if (!batch)
        return pushToast(s0, { text: '本机与远端一致，无需合并', kind: 'info' });

      if (s0.failNext) {
        const retried: Batch = {
          ...batch,
          status: 'failed',
          attempts: batch.attempts + 1,
          error: '网络中断 / 合并服务暂不可用（模拟失败）',
        };
        return pushToast(
          { ...s0, batch: retried, review: null, failNext: false },
          {
            text: `第 ${retried.attempts} 次合并失败：原批次已保留，可重试（基准 v${batch.baseVersion}）`,
            kind: 'err',
          },
        );
      }

      const result = computeMerge(s0.remote, batch);
      const previous = s0.review?.conflicts ?? [];
      const prevRes = new Map(previous.map((c) => [c.key, c.resolution]));
      const conflicts = result.conflicts.map((c) => ({
        ...c,
        resolution: prevRes.get(c.key),
      }));
      const review: Review = {
        batchId: batch.id,
        baseVersion: batch.baseVersion,
        remoteVersion: s0.remote.version,
        attemptedAt: tick(),
        rechecked: batch.attempts > 0,
        auto: result.auto,
        conflicts,
        trash: result.trash,
      };
      const ok: Batch = { ...batch, status: 'review', attempts: batch.attempts + 1 };
      let s: RepoState = { ...s0, batch: ok, review };
      s = pushToast(s, {
        text:
          conflicts.length > 0
            ? `逐字段核对完成：${result.auto.length} 项可自动合并，${conflicts.length} 项待确认`
            : `逐字段核对完成：${result.auto.length} 项可自动合并`,
        kind: conflicts.length > 0 ? 'warn' : 'ok',
      });
      return s;
    }

    case 'openReview': {
      if (!s0.batch || !s0.review) return s0;
      // 重开：仍从同一基准核对；远端若又有变化，重新跑一遍并保留已确认选择
      const result = computeMerge(s0.remote, s0.batch);
      const prev = new Map(s0.review.conflicts.map((c) => [c.key, c.resolution]));
      const conflicts = result.conflicts.map((c) => ({
        ...c,
        resolution: prev.get(c.key),
      }));
      return {
        ...s0,
        batch: { ...s0.batch, status: 'review' },
        review: {
          ...s0.review,
          remoteVersion: s0.remote.version,
          rechecked: true,
          auto: result.auto,
          conflicts,
          trash: result.trash,
        },
      };
    }

    case 'resolve':
      if (!s0.review) return s0;
      return {
        ...s0,
        review: {
          ...s0.review,
          conflicts: s0.review.conflicts.map((c) =>
            c.key === a.key ? { ...c, resolution: a.resolution } : c,
          ),
        },
      };

    case 'commitReview': {
      if (!s0.batch || !s0.review) return s0;
      const unresolved = s0.review.conflicts.filter((c) => !c.resolution).length;
      const { remote, pairs, pendingDeletes, trash, summary } = applyCommit(
        s0.remote,
        s0.review,
        s0.batch,
        s0.pairs,
        s0.pendingDeletes,
        s0.trash,
        tick(),
      );
      let s: RepoState = {
        ...s0,
        remote,
        pairs,
        pendingDeletes,
        trash,
        batch: null,
        review: null,
        failNext: false,
        lastSyncAt: tick(),
        selectedId: pairs.some((p) => p.id === s0.selectedId)
          ? s0.selectedId
          : pairs[0]?.id ?? '',
      };
      s = pushToast(s, {
        text:
          `已重算并提交：新建 ${summary.creates} · 本机改动 ${summary.localFields} · 下传 ${summary.incomingFields} · 删除 ${summary.deletes} · 回收站 ${summary.trashed}` +
          (unresolved ? `；${unresolved} 项未确认，保留到下次合并` : ''),
        kind: unresolved ? 'warn' : 'ok',
      });
      return s;
    }

    case 'cancelBatch': {
      let s: RepoState = { ...s0, batch: null, review: null };
      return pushToast(s, { text: '已取消该批次，本机改动保留', kind: 'info' });
    }

    case 'closeReview':
      return { ...s0 };

    case 'dismissToast':
      return { ...s0, toasts: s0.toasts.filter((t) => t.id !== a.id) };

    case 'restoreTrash': {
      const t = s0.trash.find((x) => x.trashId === a.trashId);
      if (!t || t.status !== 'recycle') return s0;
      const now = tick();
      const id = `r${now.toString(36)}`;
      // 用回收站保留的原值重建，再叠加本地改动
      const cells: Cells = JSON.parse(JSON.stringify(t.original.cells));
      for (const ch of t.localChanges) {
        if (ch.kind === 'edit' && ch.field && ch.localV !== undefined) {
          cells[ch.field] = { v: ch.localV, at: ch.localAt };
        }
      }
      const p: Pair = {
        id,
        synced: false,
        baseVersion: 0,
        shadow: {},
        cells,
        createdAt: now,
      };
      let s: RepoState = {
        ...s0,
        pairs: [...s0.pairs, p],
        selectedId: id,
        trash: s0.trash.map((x) =>
          x.trashId === a.trashId
            ? {
                ...x,
                status: 'restored',
                log: [
                  ...x.log,
                  { at: now, text: `已恢复为新配对（${id}），待同步到远端` },
                ],
              }
            : x,
        ),
      };
      s = pushToast(s, {
        text: `回收站副本已恢复为本地新配对「${String(cells.title.v)}」，下次同步时作为新建上送`,
        kind: 'ok',
      });
      return s;
    }

    case 'purgeTrash': {
      const t = s0.trash.find((x) => x.trashId === a.trashId);
      if (!t) return s0;
      return {
        ...s0,
        trash: s0.trash.map((x) =>
          x.trashId === a.trashId
            ? {
                ...x,
                status: 'purged',
                log: [...x.log, { at: tick(), text: '已永久清除副本' }],
              }
            : x,
        ),
      };
    }

    case 'simRemote':
      return applySim(s0, a.scenario, pushToast);

    case 'resetDemo': {
      localStorage.removeItem(STORAGE_KEY);
      return seed();
    }

    default:
      return s0;
  }
}

function applySim(
  s0: RepoState,
  scenario: SimScenario,
  pushToast: (s: RepoState, t: Omit<Toast, 'id'>) => RepoState,
): RepoState {
  const now = tick();
  const remote: RemoteDB = JSON.parse(JSON.stringify(s0.remote));
  remote.version += 1;
  let text = '';

  const target = remote.pairs['p1'];
  switch (scenario) {
    case 'different-field': {
      // 同事改正文字体（本机若只改分类/标题，则逐字段自动合并，互不覆盖）
      if (target) {
        target.cells.bodyFont = { v: 'IBM Plex Sans', at: now };
        target.version = remote.version;
        text = '模拟同事远端：p1 的正文字体改为 IBM Plex Sans（不同字段）';
      }
      break;
    }
    case 'same-field': {
      // 同事改分类 → 与本机分类改动形成"同一字段两边都改"
      if (target) {
        target.cells.category = { v: 'Portfolio', at: now };
        target.cells.title = { v: 'Editorial calm（远端修订）', at: now };
        target.version = remote.version;
        text = '模拟同事远端：p1 分类改为 Portfolio、名称也有修订（同字段冲突）';
      }
      break;
    }
    case 'rename-category': {
      // 同事把"Brand voice"重命名为旧系统的新名称 → 成员归属对不上
      for (const rp of Object.values(remote.pairs)) {
        if (rp.cells.category.v === 'Brand voice') {
          rp.cells.category = { v: 'Brand voice 2.0', at: now };
          rp.version = remote.version;
        }
      }
      text = '模拟同事远端：分类「Brand voice」被重命名，成员归属待核对';
      break;
    }
    case 'delete-pair': {
      if (target) {
        remote.tombstones['p1'] = {
          id: 'p1',
          deletedAt: now,
          version: remote.version,
          snapshot: JSON.parse(JSON.stringify(target)),
        };
        delete remote.pairs['p1'];
        text = '模拟同事远端：删除了 p1（本机若有改动 → 回收站副本）';
      }
      break;
    }
  }

  return pushToast({ ...s0, remote }, { text, kind: 'warn' });
}

export { CATEGORIES };
