import { History, RotateCcw, Trash2, X } from 'lucide-react';
import { fmtTime, FIELD_LABEL, TrashRecord } from '../sync';
import { RepoAction } from '../store';

export default function TrashBin({
  trash,
  dispatch,
  onClose,
}: {
  trash: TrashRecord[];
  dispatch: React.Dispatch<RepoAction>;
  onClose: () => void;
}) {
  return (
    <div className="backdrop merge-backdrop">
      <div className="merge-modal trash-modal">
        <div className="merge-head">
          <div>
            <h2>回收站</h2>
            <span>远端移除但本机有改动的配对：保留原值、本地改动与处理记录</span>
          </div>
          <button className="icon-x" onClick={onClose}>
            <X size={16}/>
          </button>
        </div>
        <div className="merge-body">
          {trash.length === 0 && <p className="empty-note">回收站为空</p>}
          {trash.map((t) => (
            <div key={t.trashId} className={`trash-record status-${t.status}`}>
              <div className="trash-record-head">
                <b>{t.title}</b>
                <span className={`status-pill ${t.status}`}>
                  {t.status === 'recycle'
                    ? '回收站中'
                    : t.status === 'restored'
                      ? '已恢复'
                      : '已清除'}
                </span>
              </div>
              <div className="trash-grid">
                <div>
                  <small>保留的远端原值</small>
                  {(['title', 'heading', 'body', 'category'] as const).map((f) => (
                    <p key={f}>
                      <span>{FIELD_LABEL[f]}</span>
                      {f === 'body'
                        ? String(t.original.cells[f].v).slice(0, 60) + '…'
                        : String(t.original.cells[f].v)}
                    </p>
                  ))}
                </div>
                <div>
                  <small>合并时检出的本机改动</small>
                  {t.localChanges.map((c, i) => (
                    <p key={i} className="local-change">
                      <span>{FIELD_LABEL[c.field!]}</span>
                      {fmt2(c.baseV)} → <em>{fmt2(c.localV)}</em>
                    </p>
                  ))}
                </div>
                <div>
                  <small>
                    <History size={11}/> 处理记录
                  </small>
                  {t.log.map((l, i) => (
                    <p key={i} className="log-line">
                      <time>{fmtTime(l.at)}</time>
                      {l.text}
                    </p>
                  ))}
                </div>
              </div>
              {t.status === 'recycle' && (
                <div className="trash-actions">
                  <button
                    className="primary sm"
                    onClick={() => dispatch({ type: 'restoreTrash', trashId: t.trashId })}
                  >
                    <RotateCcw size={13}/> 恢复为本地新配对（带本地改动）
                  </button>
                  <button
                    className="danger-btn sm"
                    onClick={() => dispatch({ type: 'purgeTrash', trashId: t.trashId })}
                  >
                    <Trash2 size={13}/> 永久清除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmt2(v: unknown): string {
  if (v === undefined) return '—';
  return String(v);
}
