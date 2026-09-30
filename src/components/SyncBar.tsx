import { Cloud, CloudOff, RotateCw, TriangleAlert, Wifi } from 'lucide-react';
import { fmtTime } from '../sync';
import { RepoState } from '../store';

export function pendingCount(s: RepoState): number {
  let n = 0;
  for (const p of s.pairs) {
    if (!p.synced) n++; // 本地新建
    n += dirtyN(p); // 相对基准的脏字段
  }
  return n + Object.keys(s.pendingDeletes).length;
}

import { Pair, FIELDS } from '../sync';
function dirtyN(p: Pair): number {
  let n = 0;
  for (const f of FIELDS)
    if (!Object.is(p.cells[f].v, p.shadow[f]?.v)) n++;
  return n;
}

export default function SyncBar({
  state,
  onMerge,
  onOpenReview,
}: {
  state: RepoState;
  onMerge: () => void;
  onOpenReview: () => void;
}) {
  const pending = pendingCount(state);
  const batch = state.batch;
  const unresolved =
    state.review?.conflicts.filter((c) => !c.resolution).length ?? 0;

  return (
    <div className="sync-bar">
      <div className="sync-status">
        {state.online ? (
          <span className="online">
            <Wifi size={14}/> 已联网
          </span>
        ) : (
          <span className="offline">
            <CloudOff size={14}/> 离线模式 · 改动保存在本机
          </span>
        )}
        <span className="sync-sep">·</span>
        <span>远端库 v{state.remote.version}</span>
        {state.lastSyncAt && (
          <>
            <span className="sync-sep">·</span>
            <span>上次合并 {fmtTime(state.lastSyncAt)}</span>
          </>
        )}
      </div>

      <div className="sync-actions">
        {pending > 0 && state.online && (
          <span className="pending-chip">本机待合并改动 {pending}</span>
        )}
        {batch?.status === 'failed' && (
          <button className="retry-chip" onClick={onMerge}>
            <TriangleAlert size={13}/> 批次合并失败（已试 {batch.attempts} 次，基准 v
            {batch.baseVersion}）· 点此重试
          </button>
        )}
        {batch?.status === 'review' && (
          <button className="review-chip" onClick={onOpenReview}>
            待确认项
            {unresolved > 0 ? ` ${unresolved} 项未选` : '已全部确认'} · 打开核对面板
          </button>
        )}
        <button className="merge-btn" onClick={onMerge} disabled={!state.online}>
          <Cloud size={14}/>
          {batch?.status === 'failed' ? <><RotateCw size={13}/> 重试合并</> : '回网合并'}
        </button>
      </div>
    </div>
  );
}
