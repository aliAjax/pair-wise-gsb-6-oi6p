import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  FileWarning,
  GitMerge,
  Grid3X3,
  Heart,
  History,
  Loader2,
  Plus,
  Settings2,
  SlidersHorizontal,
  Star,
  Trash2,
  Type,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStore } from './lib/store';
import type { FieldKey, PairDoc } from './lib/types';
import { FIELD_KEYS } from './lib/types';
import MergeModal from './components/MergeModal';
import RemotePanel from './components/RemotePanel';
import RecycleModal from './components/RecycleModal';

const FIELD_LABELS: Record<FieldKey, string> = {
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

function timeShort(t: number) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timeHM(t: number) {
  return new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
}

export default function App() {
  const store = useStore();
  const { db } = store;
  const [selected, setSelected] = useState<string>(() => Object.keys(store.db.pairs)[0] ?? '');
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('Untitled');
  const [showRemote, setShowRemote] = useState(false);
  const [showRecycle, setShowRecycle] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [navFilter, setNavFilter] = useState<'all' | 'fav'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const pairs = useMemo(() => Object.values(db.pairs), [db.pairs]);
  const current: PairDoc | undefined = db.pairs[selected] ?? pairs[0];

  // 当前配对被删除后自动切换
  useEffect(() => {
    if ((!selected || !db.pairs[selected]) && pairs.length) setSelected(pairs[0].id);
  }, [db.pairs, pairs, selected]);

  // 有未完成的合并会话（包括重开页面后）自动打开核对窗口
  const showMerge = !!db.session;

  const sessionOpen = !!db.session;

  const pendingOps = db.outbox.length;
  const pendingPairs = new Set(db.outbox.map((o) => o.pairId)).size;
  const issueOpen = db.session?.plans.reduce((n, p) => n + p.issues.filter((i) => !i.resolution).length, 0) ?? 0;

  const filtered = pairs.filter((p) => {
    if (navFilter === 'fav' && !p.favorite) return false;
    if (categoryFilter && p.category !== categoryFilter) return false;
    return true;
  });

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    pairs.forEach((p) => m.set(p.category, (m.get(p.category) ?? 0) + 1));
    return m;
  }, [pairs]);

  const create = () => {
    if (!newTitle.trim()) return;
    const title = newTitle.trim();
    const id = store.createPair(title, newCategory);
    setSelected(id);
    setNewTitle('');
    setShowAdd(false);
  };

  const patch = (patch: Partial<Record<FieldKey, string | number | boolean>>) => {
    if (current) store.patchPair(current.id, patch);
  };

  const exportCss = () => {
    if (!current) return;
    const css = `/* ${current.title} */\n.heading { font-family: '${current.headingFont}'; font-size: ${current.size}px; font-weight: ${current.weight}; }\n.body { font-family: '${current.bodyFont}'; line-height: ${current.leading}; letter-spacing: ${current.tracking}px; }`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
    a.download = 'type-pair.css';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="brand-mark"><Type size={18} /></div>
          <div><b>Type Pairer</b><small>离线配对库</small></div>
        </div>

        <div className="nav-section">
          <span>配对库</span>
          <button className={`nav ${navFilter === 'all' && !categoryFilter ? 'active' : ''}`} onClick={() => { setNavFilter('all'); setCategoryFilter(null); }}>
            <Grid3X3 size={16} />全部配对 <b>{pairs.length}</b>
          </button>
          <button className={`nav ${navFilter === 'fav' ? 'active' : ''}`} onClick={() => { setNavFilter('fav'); setCategoryFilter(null); }}>
            <Heart size={16} />收藏 <b>{pairs.filter((p) => p.favorite).length}</b>
          </button>
        </div>

        <div className="saved">
          <div className="saved-head">
            <span>分类</span>
            <button onClick={() => setShowAdd(true)}><Plus size={14} /></button>
          </div>
          {db.categories.map((c) => (
            <button key={c} className={`collection ${categoryFilter === c ? 'active' : ''}`} onClick={() => { setCategoryFilter(categoryFilter === c ? null : c); setNavFilter('all'); }}>
              <i className={c === 'Editorial' ? '' : c === 'Portfolio' ? 'teal' : 'violet'} />
              {c} <b>{categoryCounts.get(c) ?? 0}</b>
            </button>
          ))}
        </div>

        <div className="aside-foot">
          <button className="nav" onClick={() => setShowRecycle(true)}>
            <FileWarning size={16} />回收站副本
            {db.recycle.length > 0 && <b className="badge-warn">{db.recycle.length}</b>}
          </button>
          <button className="nav" onClick={() => setShowLog((v) => !v)}>
            <History size={16} />同步记录
          </button>
          <button className="nav" onClick={() => setShowRemote((v) => !v)}>
            <Settings2 size={16} />远端模拟工作台
          </button>
          <div className="profile">
            <div className="avatar">我</div>
            <div><b>本机设计师</b><small>配对保存在此设备</small></div>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>

      <main>
        {/* 同步状态条 */}
        <div className={`syncbar ${db.meta.online ? 'online' : 'offline'}`}>
          <button className="net-toggle" onClick={store.toggleOnline} title="切换联网/离线">
            {db.meta.online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {db.meta.online ? '已联网' : '离线中'}
          </button>
          <div className="syncbar-info">
            {db.meta.online
              ? pendingOps > 0
                ? <>本机有 <b>{pendingPairs}</b> 个配对（{pendingOps} 个操作）等待回网合并</>
                : <>本机与远端基准一致 · 上次本机保存 {db.meta.lastSavedAt ? timeHM(db.meta.lastSavedAt) : '—'}</>
              : <>离线续作：改动逐字段记修订时间，回网后按基准版本三方合并</>}
          </div>
          {db.recycle.length > 0 && (
            <button className="syncbar-link warn" onClick={() => setShowRecycle(true)}>
              <FileWarning size={13} /> {db.recycle.length} 份回收站副本
            </button>
          )}
          {sessionOpen ? (
            <span className="syncbar-link session"><GitMerge size={13} /> {issueOpen > 0 ? `${issueOpen} 项待确认` : '合并预览已打开'}</span>
          ) : null}
          <button
            className="primary sm"
            disabled={!db.meta.online || store.busy || sessionOpen}
            onClick={() => store.startSync()}
          >
            {store.busy ? <Loader2 size={13} className="spin" /> : <Cloud size={13} />}
            回网合并
          </button>
        </div>

        <header>
          <div>
            <div className="crumb">TYPE LIBRARY / <b>PAIRING STUDIO</b></div>
            <h1>Find the right conversation.</h1>
            <p>字体搭配保存在本机；多人同时改同一配对时，逐字段合并，分类归属由你确认。</p>
          </div>
          <div className="actions">
            <button className="outline" onClick={exportCss}><Download size={15} />导出 CSS</button>
            <button className="primary" onClick={() => setShowAdd(true)}><Plus size={16} />新建配对</button>
          </div>
        </header>

        {showRemote && <RemotePanel store={store} />}
        {showLog && (
          <div className="log-panel">
            <div className="rp-head"><span><History size={13} /> 同步与处理记录</span><button className="icon-btn" onClick={() => setShowLog(false)}>×</button></div>
            <ul>
              {db.log.map((l) => (
                <li key={l.id} className={`log-${l.kind}`}>
                  <small>{timeShort(l.at)}</small><span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="layout">
          <section className="gallery">
            <div className="gallery-head">
              <div>
                <h2>本机配对</h2>
                <span>{filtered.length} 个组合{pendingPairs > 0 && ` · ${pendingPairs} 个待同步`}</span>
              </div>
              <div className="view-toggle">
                <button className="on"><Grid3X3 size={14} /></button>
                <button><BookOpen size={14} /></button>
              </div>
            </div>
            <div className="pair-list">
              {filtered.map((p) => {
                const dirty = db.outbox.some((o) => o.pairId === p.id);
                return (
                  <button key={p.id} className={current?.id === p.id ? 'pair selected' : 'pair'} onClick={() => setSelected(p.id)}>
                    <div className="pair-top">
                      <span>{p.category}{dirty && <em className="dirty-dot" title="有未同步的本机改动">● 待同步</em>}</span>
                      <Heart size={15} fill={p.favorite ? '#e88769' : 'none'} color={p.favorite ? '#e88769' : '#aeb5b7'} />
                    </div>
                    <strong style={{ fontFamily: p.headingFont }}>{p.heading}</strong>
                    <p style={{ fontFamily: p.bodyFont }}>{p.body}</p>
                    <div className="pair-foot">
                      <span>{p.title}</span>
                      <small>基准 v{db.bases[p.id]?.version ?? '未同步'} · 修订 {timeHM(p.updatedAt)}</small>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="empty-note">此视图下没有配对。</p>}
            </div>
          </section>

          {current && (
            <section className="studio">
              <div className="studio-head">
                <div>
                  <span>PAIRING CANVAS</span>
                  <h2>{current.title}</h2>
                  <small className="base-line">
                    基准版本 v{db.bases[current.id]?.version ?? '—'} · 最近修订 {timeShort(current.updatedAt)} · {current.updatedBy}
                  </small>
                </div>
                <button className="favorite" onClick={() => patch({ favorite: !current.favorite })}>
                  <Star size={16} fill={current.favorite ? '#e5a35e' : 'none'} color={current.favorite ? '#e5a35e' : '#98a4a7'} />
                </button>
              </div>

              <div className="canvas">
                <div className="canvas-bar">
                  <span>PREVIEW</span>
                  <div><button className="on">Desktop</button><button>Tablet</button><button>Mobile</button></div>
                </div>
                <div className="preview">
                  <span className="preview-kicker">A NOTE ON TYPE</span>
                  <h3 style={{ fontFamily: current.headingFont, fontSize: `${current.size}px`, fontWeight: current.weight, letterSpacing: `${current.tracking}px`, lineHeight: 1.05 }}>
                    {current.heading}
                  </h3>
                  <p style={{ fontFamily: current.bodyFont, lineHeight: current.leading, letterSpacing: `${Number(current.tracking) / 2}px` }}>{current.body}</p>
                  <div className="preview-rule" />
                  <span className="preview-meta">{current.title.toUpperCase()} · {current.category.toUpperCase()}</span>
                </div>
              </div>

              <div className="controls">
                <div className="control-head">
                  <div><span>内容（改动保存在本机并逐字段记修订时间）</span><h3>Fine tune your pairing</h3></div>
                  <SlidersHorizontal size={17} />
                </div>

                <div className="edit-grid">
                  <label>配对名称<input value={current.title} onChange={(e) => patch({ title: e.target.value })} /></label>
                  <label>分类归属
                    <select
                      value={db.categories.includes(current.category) ? current.category : '__other'}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__new') {
                          const name = prompt('新分类名称')?.trim();
                          if (name) {
                            store.addCategory(name);
                            patch({ category: name });
                          }
                        } else if (v !== '__other') {
                          patch({ category: v });
                        }
                      }}
                    >
                      {!db.categories.includes(current.category) && <option value="__other">{current.category}（对端分类，待合并）</option>}
                      {db.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__new">＋ 新建分类…</option>
                    </select>
                  </label>
                </div>
                <label className="full-label">标题文案<input value={current.heading} onChange={(e) => patch({ heading: e.target.value })} /></label>
                <label className="full-label">正文<textarea rows={2} value={current.body} onChange={(e) => patch({ body: e.target.value })} /></label>

                <div className="font-row">
                  <label>标题字体
                    <select value={current.headingFont} onChange={(e) => patch({ headingFont: e.target.value })}>
                      {store.fonts.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </label>
                  <label>正文字体
                    <select value={current.bodyFont} onChange={(e) => patch({ bodyFont: e.target.value })}>
                      {store.fonts.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </label>
                </div>
                <div className="range-row">
                  <label>字号 <b>{current.size}px</b><input type="range" min="28" max="76" value={current.size} onChange={(e) => patch({ size: Number(e.target.value) })} /></label>
                  <label>字重 <b>{current.weight}</b><input type="range" min="300" max="800" step="100" value={current.weight} onChange={(e) => patch({ weight: Number(e.target.value) })} /></label>
                </div>
                <div className="range-row">
                  <label>行高 <b>{Number(current.leading).toFixed(2)}</b><input type="range" min="1" max="1.8" step=".05" value={current.leading} onChange={(e) => patch({ leading: Number(e.target.value) })} /></label>
                  <label>字距 <b>{current.tracking}px</b><input type="range" min="-1" max="3" step=".5" value={current.tracking} onChange={(e) => patch({ tracking: Number(e.target.value) })} /></label>
                </div>

                <details className="revisions">
                  <summary>字段修订时间与基准值核对</summary>
                  <table>
                    <tbody>
                      {FIELD_KEYS.map((k) => {
                        const bv = db.bases[current.id]?.values[k];
                        const dirty = bv !== undefined && String(bv) !== String(current[k]);
                        return (
                          <tr key={k} className={dirty ? 'field-dirty' : ''}>
                            <td>{FIELD_LABELS[k]}</td>
                            <td className="dim">{typeof current[k] === 'boolean' ? (current[k] ? '是' : '否') : String(current[k])}</td>
                            <td className="dim">{timeHM(current.fields[k])}</td>
                            <td>{dirty ? '相对基准已改' : '与基准一致'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </details>
              </div>

              <div className="studio-foot">
                <button className="delete" disabled={sessionOpen} onClick={() => { store.deletePair(current.id); }}>
                  <Trash2 size={15} />{sessionOpen ? '合并会话进行中…' : '删除配对（本机立即生效）'}
                </button>
                <button className="save"><span className="check">✓</span>已保存在本机{db.meta.online ? ' · 在线' : ' · 离线'}</button>
              </div>
            </section>
          )}
        </div>
      </main>

      {showAdd && (
        <div className="backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>新建配对</h2>
            <label>配对名称
              <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Quiet confidence"
                onKeyDown={(e) => e.key === 'Enter' && create()} />
            </label>
            <label>分类
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                {db.categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="modal-actions">
              <button className="outline" onClick={() => setShowAdd(false)}>取消</button>
              <button className="primary" onClick={create}>创建并保存在本机</button>
            </div>
          </div>
        </div>
      )}

      {showMerge && <MergeModal store={store} onClose={() => store.cancelSession()} />}
      {showRecycle && <RecycleModal store={store} onClose={() => setShowRecycle(false)} />}
    </div>
  );
}

// 保持对未使用图标的显式引用（视觉扩展位）
void CloudOff;
