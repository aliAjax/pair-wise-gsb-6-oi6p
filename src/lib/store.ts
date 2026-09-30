import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FieldKey,
  FieldValue,
  LocalDB,
  PairDoc,
  PendingSession,
} from './types';
import { FIELD_KEYS } from './types';
import { addLog, CURRENT_USER, FONTS, loadDB, makeDoc, saveDB, uid } from './db';
import { remote } from './remote';
import { annotatePlansWithLocal, commitSession, purgeRecycleEntry, restoreRecycleEntry } from './commit';
import { computeMerge } from './merge';

export function useStore() {
  const [db, setDb] = useState<LocalDB>(() => loadDB());
  const [busy, setBusy] = useState(false);
  const dbRef = useRef(db);
  dbRef.current = db;

  const commit = useCallback((mutator: (draft: LocalDB) => void, logText?: string, logKind: LocalDB['log'][number]['kind'] = 'info') => {
    setDb((prev) => {
      const draft: LocalDB = structuredClone(prev);
      mutator(draft);
      if (logText) addLog(draft, logKind, logText);
      saveDB(draft);
      return draft;
    });
  }, []);

  /* ---------------- 本地编辑（离线续作） ---------------- */

  const recordOutbox = (draft: LocalDB, pairId: string, kind: 'create' | 'update' | 'delete', fields: FieldKey[]) => {
    if (kind === 'create') {
      if (!draft.outbox.some((o) => o.pairId === pairId && o.kind === 'create')) {
        draft.outbox.push({ id: uid('op'), pairId, kind, at: Date.now(), by: CURRENT_USER, fields });
      }
      return;
    }
    // 若已有 create 批次行，则不追加 update
    if (draft.outbox.some((o) => o.pairId === pairId && o.kind === 'create')) return;
    const existing = draft.outbox.find((o) => o.pairId === pairId && o.kind === 'update');
    if (existing) {
      existing.fields = [...new Set([...existing.fields, ...fields])];
      existing.at = Date.now();
    } else {
      draft.outbox.push({ id: uid('op'), pairId, kind, at: Date.now(), by: CURRENT_USER, fields });
    }
  };

  const patchPair = useCallback((pairId: string, patch: Partial<Record<FieldKey, FieldValue>>) => {
    commit((draft) => {
      const doc = draft.pairs[pairId];
      if (!doc) return;
      const t = Date.now();
      const changed: FieldKey[] = [];
      (Object.keys(patch) as FieldKey[]).forEach((k) => {
        if (doc[k] !== patch[k]) {
          (doc as unknown as Record<FieldKey, FieldValue>)[k] = patch[k]!;
          doc.fields[k] = t;
          changed.push(k);
        }
      });
      if (changed.length) {
        doc.updatedAt = t;
        doc.updatedBy = CURRENT_USER;
        recordOutbox(draft, pairId, 'update', changed);
      }
    });
  }, [commit]);

  const createPair = useCallback((title: string, category = 'Untitled'): string => {
    const id = uid('p');
    commit((draft) => {
      const doc = makeDoc(
        {
          id,
          title,
          heading: 'Your new headline',
          body: 'Start with a sentence that lets your type pairing show its character.',
          category,
          favorite: false,
        },
        Date.now(),
        CURRENT_USER,
      );
      draft.pairs[id] = doc;
      if (category && !draft.categories.includes(category)) draft.categories.push(category);
      recordOutbox(draft, id, 'create', [...FIELD_KEYS]);
    }, `新配对「${title}」已保存到本机。`);
    return id;
  }, [commit]);

  const deletePair = useCallback((pairId: string) => {
    commit((draft) => {
      const doc = draft.pairs[pairId];
      if (!doc) return;
      delete draft.pairs[pairId];
      draft.tombstones.push({ id: pairId, at: Date.now(), by: CURRENT_USER });
      recordOutbox(draft, pairId, 'delete', []);
      addLog(draft, 'info', `配对「${doc.title}」已在本机删除，回网后同步。`);
    });
  }, [commit]);

  /* ---------------- 同步 ---------------- */

  const startSync = useCallback(async () => {
    const current = dbRef.current;
    if (!current.meta.online) return;
    if (current.session) return;
    setBusy(true);
    try {
      const snapshot = await remote.fetchSnapshot();
      const draft: LocalDB = structuredClone(current);
      const outboxIds = new Set(draft.outbox.map((o) => o.pairId));
      const session = computeMerge({
        locals: draft.pairs,
        bases: draft.bases,
        tombstones: draft.tombstones,
        outboxPairIds: outboxIds,
        snapshot,
        localCategories: draft.categories,
      });
      annotatePlansWithLocal(session, draft);
      const issueTotal = session.plans.reduce((n, p) => n + p.issues.length, 0);
      draft.session = session;
      addLog(
        draft,
        'merge',
        issueTotal > 0
          ? `回网核对完成：${session.plans.length} 个配对需要处理，其中 ${issueTotal} 项待你确认。`
          : `回网核对完成：${session.plans.length} 个配对可直接合并，请预览后重算提交。`,
      );
      saveDB(draft);
      setDb(draft);
    } finally {
      setBusy(false);
    }
  }, []);

  const resolveIssue = useCallback((issueId: string, resolution: { choice: 'local' | 'remote' | 'custom' | 'delete' | 'restore'; value?: FieldValue }) => {
    commit((draft) => {
      if (!draft.session) return;
      for (const p of draft.session.plans) {
        const iss = p.issues.find((i) => i.id === issueId);
        if (iss) {
          iss.resolution = resolution;
          return;
        }
      }
    });
  }, [commit]);

  const commitMerge = useCallback(async (): Promise<boolean> => {
    const current = dbRef.current;
    if (!current.session) return false;
    setBusy(true);
    try {
      const draft: LocalDB = structuredClone(current);
      const result = await commitSession(draft, draft.session!);
      saveDB(draft);
      setDb(draft);
      return result.ok;
    } finally {
      setBusy(false);
    }
  }, []);

  const retryMerge = useCallback(async (): Promise<boolean> => {
    const current = dbRef.current;
    if (!current.session) return false;
    setBusy(true);
    try {
      const draft: LocalDB = structuredClone(current);
      draft.session!.status = 'awaiting';
      draft.session!.attempts += 1;
      addLog(draft, 'merge', `按同一冻结基准（服务器 v${draft.session!.base.serverVersion}）重试批次 ${draft.session!.batchId.slice(-6)}。`);
      const result = await commitSession(draft, draft.session!);
      saveDB(draft);
      setDb(draft);
      return result.ok;
    } finally {
      setBusy(false);
    }
  }, []);

  const cancelSession = useCallback(() => {
    commit((draft) => {
      if (!draft.session) return;
      addLog(draft, 'info', '已取消本次合并预览；本地与远端均未改动，下次同步仍从原基准核对。');
      draft.session = null;
    });
  }, [commit]);

  const toggleOnline = useCallback(() => {
    commit((draft) => {
      draft.meta.online = !draft.meta.online;
      addLog(draft, 'info', draft.meta.online ? '已回到联网状态，可以同步。' : '已切换为离线：改动保存在本机，回网后逐字段合并。');
    });
  }, [commit]);

  const restoreFromRecycle = useCallback((entryId: string) => {
    commit((draft) => restoreRecycleEntry(draft, entryId));
  }, [commit]);

  const purgeFromRecycle = useCallback((entryId: string) => {
    commit((draft) => purgeRecycleEntry(draft, entryId));
  }, [commit]);

  const addCategory = useCallback((name: string) => {
    commit((draft) => {
      if (name.trim() && !draft.categories.includes(name.trim())) {
        draft.categories.push(name.trim());
      }
    });
  }, [commit]);

  /* 关闭页面提示（同步会话进行中） */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dbRef.current.session) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return {
    db,
    busy,
    fonts: FONTS,
    patchPair,
    createPair,
    deletePair,
    startSync,
    resolveIssue,
    commitMerge,
    retryMerge,
    cancelSession,
    toggleOnline,
    restoreFromRecycle,
    purgeFromRecycle,
    addCategory,
    setDb,
  };
}

export type Store = ReturnType<typeof useStore>;
export type { PairDoc, PendingSession };
