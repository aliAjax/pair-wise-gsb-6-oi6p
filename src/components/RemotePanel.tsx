import { useState } from 'react';
import { Globe, RefreshCw, Trash2, PencilRuler } from 'lucide-react';
import type { Store } from '../lib/store';
import { remote } from '../lib/remote';
import { FIELD_KEYS } from '../lib/types';
import { REMOTE_USER } from '../lib/db';

/** "远端设计师"模拟面板：制造对端改动/删除/分类改名 */
export default function RemotePanel({ store }: { store: Store }) {
  const [tick, setTick] = useState(0);
  const [renameFrom, setRenameFrom] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const peek = remote.peek();
  const remotePairs = Object.values(peek.pairs);
  void tick;

  const refresh = () => setTick((t) => t + 1);
  const busy = store.busy;

  const editOne = async (pairId: string) => {
    // 对端轮转修改一个字段，方便制造冲突
    const doc = peek.pairs[pairId];
    if (!doc) return;
    if (doc.category === 'Editorial') {
      await remote.remoteEdit(pairId, { category: 'Brand voice' }, REMOTE_USER);
    } else {
      const cats = peek.categories.filter((c) => c !== doc.category);
      await remote.remoteEdit(pairId, { category: cats[0] ?? 'Editorial' }, REMOTE_USER);
    }
    refresh();
  };

  const editTitle = async (pairId: string) => {
    const doc = peek.pairs[pairId];
    if (!doc) return;
    await remote.remoteEdit(pairId, { title: `${doc.title} · ${REMOTE_USER.split(' ')[0]} 改` }, REMOTE_USER);
    refresh();
  };

  const editHeading = async (pairId: string) => {
    const doc = peek.pairs[pairId];
    if (!doc) return;
    await remote.remoteEdit(pairId, { heading: `${doc.heading} — edited remotely` }, REMOTE_USER);
    refresh();
  };

  const deleteOne = async (pairId: string) => {
    await remote.remoteDelete(pairId, REMOTE_USER);
    refresh();
  };

  const rename = async () => {
    if (!renameFrom.trim() || !renameTo.trim()) return;
    await remote.remoteRenameCategory(renameFrom.trim(), renameTo.trim(), REMOTE_USER);
    setRenameFrom('');
    setRenameTo('');
    refresh();
  };

  const reset = async () => {
    await remote.resetAll();
    localStorage.removeItem('type-pairer-db-v2');
    location.reload();
  };

  return (
    <div className="remote-panel">
      <div className="rp-head">
        <span><Globe size={13} /> 远端工作台（模拟另一位设计师：{REMOTE_USER}）</span>
        <small>服务器 v{peek.serverVersion} · 共 {remotePairs.length} 个配对</small>
      </div>

      <div className="rp-rows">
        {remotePairs.map((doc) => (
          <div key={doc.id} className="rp-row">
            <div className="rp-row-main">
              <b>{doc.title}</b>
              <small>分类：{doc.category} · v{doc.version} · {new Date(doc.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })} · {doc.updatedBy}</small>
            </div>
            <div className="rp-row-actions">
              <button disabled={busy} title="对端改分类" onClick={() => editOne(doc.id)}><PencilRuler size={12} />分类</button>
              <button disabled={busy} title="对端改名称" onClick={() => editTitle(doc.id)}>名称</button>
              <button disabled={busy} title="对端改标题文案" onClick={() => editHeading(doc.id)}>文案</button>
              <button className="danger" disabled={busy} title="对端删除" onClick={() => deleteOne(doc.id)}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
        {remotePairs.length === 0 && <small className="rp-empty">远端暂时没有配对。</small>}
      </div>

      <div className="rp-rename">
        <span>模拟分类改名（归属变更）：</span>
        <select value={renameFrom} onChange={(e) => setRenameFrom(e.target.value)}>
          <option value="">原分类…</option>
          {peek.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="新分类名" />
        <button className="outline" disabled={!renameFrom || !renameTo || busy} onClick={rename}>改名</button>
      </div>

      <div className="rp-foot">
        <label className="fail-toggle">
          <input
            type="checkbox"
            checked={peek.failNextCommit}
            onChange={(e) => remote.setFailNext(e.target.checked)}
          />
          下次提交模拟失败（用于批次重试）
        </label>
        <button className="link-danger" onClick={reset}><RefreshCw size={11} /> 重置整个演示</button>
      </div>
      <small className="rp-hint">提示：先离线在本机改动，再在这里制造对端改动，然后回网点「回网合并」即可看到冲突与回收站流程。</small>
      <span className="hidden">{FIELD_KEYS.length}</span>
    </div>
  );
}
