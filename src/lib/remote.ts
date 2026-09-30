import type {
  FieldKey,
  FieldValue,
  PairDoc,
  RemoteDoc,
  RemoteSnapshot,
  RemoteTomb,
  RenameRecord,
} from './types';
import { freshLocalDB, REMOTE_KEY } from './db';

interface RemoteState {
  pairs: Record<string, RemoteDoc>;
  tombstones: Record<string, RemoteTomb>;
  categories: string[];
  renames: RenameRecord[];
  serverVersion: number;
  failNextCommit: boolean;
}

function seedRemote(): RemoteState {
  const local = freshLocalDB();
  const pairs: Record<string, RemoteDoc> = {};
  Object.values(local.pairs).forEach((doc, i) => {
    pairs[doc.id] = { ...doc, version: 1 + i };
  });
  // 统一基准版本：种子文档一律 v1
  Object.values(pairs).forEach((p) => (p.version = 1));
  return {
    pairs,
    tombstones: {},
    categories: [...local.categories],
    renames: [],
    serverVersion: 1,
    failNextCommit: false,
  };
}

function load(): RemoteState {
  try {
    const raw = localStorage.getItem(REMOTE_KEY);
    if (raw) return JSON.parse(raw) as RemoteState;
  } catch {
    /* ignore */
  }
  const state = seedRemote();
  persist(state);
  return state;
}

function persist(state: RemoteState): void {
  localStorage.setItem(REMOTE_KEY, JSON.stringify(state));
}

const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

export interface CommitOp {
  pairId: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  expectedVersion: number | null;
  doc?: PairDoc;
}

export class CommitRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitRejectedError';
  }
}

export const remote = {
  /** 拉取远端冻结快照 */
  async fetchSnapshot(): Promise<RemoteSnapshot> {
    await delay(300);
    const s = load();
    return {
      serverVersion: s.serverVersion,
      fetchedAt: Date.now(),
      pairs: structuredClone(s.pairs),
      tombstones: structuredClone(s.tombstones),
      categories: [...s.categories],
      renames: structuredClone(s.renames),
    };
  },

  getFailNext(): boolean {
    return load().failNextCommit;
  },
  setFailNext(v: boolean): void {
    const s = load();
    s.failNextCommit = v;
    persist(s);
  },

  /** 按冻结快照做乐观锁提交；任一版本不匹配整批失败、远端不变 */
  async commit(ops: CommitOp[], _batchId: string): Promise<{ versions: Record<string, number> }> {
    await delay(600);
    const s = load();
    if (s.failNextCommit) {
      s.failNextCommit = false;
      persist(s);
      throw new CommitRejectedError('模拟的网络/服务器故障：批次未写入，可原样重试。');
    }
    for (const op of ops) {
      const existing = s.pairs[op.pairId];
      if (op.action === 'create') {
        if (existing) {
          throw new CommitRejectedError(
            `配对 ${op.pairId} 在远端已存在（版本 v${existing.version}），请重新核对基准后合并。`,
          );
        }
      } else if (op.action === 'restore') {
        // 墓碑上重建
        if (existing) {
          throw new CommitRejectedError(
            `配对 ${op.pairId} 已被其他人恢复（v${existing.version}），请重新核对。`,
          );
        }
      } else {
        if (!existing) throw new CommitRejectedError(`配对 ${op.pairId} 在远端不存在。`);
        if (op.expectedVersion !== existing.version) {
          throw new CommitRejectedError(
            `配对「${(op.doc?.title ?? existing.title)}」远端版本已从 v${op.expectedVersion} 变为 v${existing.version}，请以同一基准重新核对。`,
          );
        }
      }
    }
    s.serverVersion += 1;
    const versions: Record<string, number> = {};
    for (const op of ops) {
      if (op.action === 'delete') {
        const existing = s.pairs[op.pairId];
        const version = existing.version + 1;
        s.tombstones[op.pairId] = {
          at: Date.now(),
          by: 'you',
          version,
          snapshot: { ...existing },
        };
        delete s.pairs[op.pairId];
        versions[op.pairId] = version;
      } else if (op.action === 'create' || op.action === 'restore') {
        const doc = op.doc!;
        const version = 1;
        s.pairs[op.pairId] = { ...doc, version };
        versions[op.pairId] = version;
        delete s.tombstones[op.pairId];
      } else {
        const existing = s.pairs[op.pairId];
        const version = existing.version + 1;
        s.pairs[op.pairId] = { ...op.doc!, version };
        versions[op.pairId] = version;
      }
    }
    persist(s);
    return { versions };
  },

  /* ---------- 供"远端设计师"模拟面板使用 ---------- */

  async remoteEdit(pairId: string, patch: Partial<Record<FieldKey, FieldValue>>, by: string) {
    await delay(150);
    const s = load();
    const doc = s.pairs[pairId];
    if (!doc) return;
    const t = Date.now();
    (Object.keys(patch) as FieldKey[]).forEach((k) => {
      (doc as unknown as Record<string, FieldValue>)[k] = patch[k]!;
      doc.fields[k] = t;
    });
    doc.updatedAt = t;
    doc.updatedBy = by;
    doc.version += 1;
    s.serverVersion += 1;
    persist(s);
  },

  async remoteDelete(pairId: string, by: string) {
    await delay(150);
    const s = load();
    const doc = s.pairs[pairId];
    if (!doc) return;
    const version = doc.version + 1;
    s.tombstones[pairId] = {
      at: Date.now(),
      by,
      version,
      snapshot: { ...doc },
    };
    delete s.pairs[pairId];
    s.serverVersion += 1;
    persist(s);
  },

  async remoteRenameCategory(from: string, to: string, by: string) {
    await delay(150);
    const s = load();
    if (!s.categories.includes(from) || s.categories.includes(to)) return;
    const t = Date.now();
    s.categories = s.categories.map((c) => (c === from ? to : c));
    Object.values(s.pairs).forEach((doc) => {
      if (doc.category === from) {
        doc.category = to;
        doc.fields.category = t;
        doc.updatedAt = t;
        doc.updatedBy = by;
        doc.version += 1;
      }
    });
    s.renames.push({ from, to, at: t, by });
    s.serverVersion += 1;
    persist(s);
  },

  async resetAll(): Promise<RemoteState> {
    localStorage.removeItem(REMOTE_KEY);
    const s = seedRemote();
    persist(s);
    return s;
  },

  /** 给合并引擎/面板读取当前远端（非冻结） */
  peek(): RemoteState {
    return load();
  },
};
