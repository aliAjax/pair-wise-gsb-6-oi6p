import { FileWarning, History, Trash2, X } from 'lucide-react';
import type { FieldKey } from '../lib/types';
import type { Store } from '../lib/store';

const LABELS: Record<FieldKey, string> = {
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

function fmt(v: unknown) {
  if (typeof v === 'boolean') return v ? '是' : '否';
  return String(v);
}

export default function RecycleModal({ store, onClose }: { store: Store; onClose: () => void }) {
  const entries = store.db.recycle;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal recycle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="merge-header">
          <div>
            <span className="merge-kicker"><FileWarning size={12} /> 回收站副本</span>
            <h2>远端已移除、本机有新改动的配对</h2>
            <small>每份副本保留原值与完整处理记录，可恢复后重新提交，或永久丢弃。</small>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="recycle-list">
          {entries.length === 0 && <p className="empty-note">回收站是空的。当远端删除了一个你本地还在改的配对时，它会出现在这里。</p>}
          {entries.map((e) => (
            <div key={e.id} className="recycle-entry">
              <div className="recycle-entry-head">
                <b>{e.local.title}</b>
                <div>
                  <button className="primary sm" onClick={() => store.restoreFromRecycle(e.id)}><History size={12} /> 恢复并重新提交</button>
                  <button className="outline sm danger-text" onClick={() => store.purgeFromRecycle(e.id)}><Trash2 size={12} /> 永久丢弃</button>
                </div>
              </div>
              <div className="record-block">
                <span>处理记录</span>
                <ul>
                  <li>远端由 <b>{e.record.remoteDeletedBy}</b> 于 {new Date(e.record.remoteDeletedAt).toLocaleString('zh-CN', { hour12: false })} 删除（删除时 v{e.record.remoteVersion}）</li>
                  <li>本机于 {new Date(e.record.movedAt).toLocaleString('zh-CN', { hour12: false })} 移入回收站（{e.record.movedBy}）</li>
                </ul>
              </div>
              <table className="diff-table">
                <thead><tr><th>字段</th><th>原值（基准）</th><th>本机新值</th><th>修改时间</th></tr></thead>
                <tbody>
                  {e.record.localChanges.map((c) => (
                    <tr key={c.field}>
                      <td>{LABELS[c.field]}</td>
                      <td className="dim">{fmt(c.from)}</td>
                      <td>{fmt(c.to)}</td>
                      <td className="dim">{new Date(c.at).toLocaleString('zh-CN', { hour12: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
