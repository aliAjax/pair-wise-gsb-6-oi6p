import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Grid3X3,
  Heart,
  Plus,
  Settings2,
  Trash2,
  Type,
} from 'lucide-react';
import { CATEGORIES, dirtyFields, Pair } from './sync';
import { initialState, persist, reducer } from './store';
import SyncBar from './components/SyncBar';
import Studio from './components/Studio';
import SimPanel from './components/SimPanel';
import ReviewModal from './components/ReviewModal';
import TrashBin from './components/TrashBin';

type Filter = 'all' | 'favorites' | string;

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showTrash, setShowTrash] = useState(false);

  useEffect(() => persist(state), [state]);
  useEffect(() => {
    const timers = state.toasts.map((t) =>
      setTimeout(() => dispatch({ type: 'dismissToast', id: t.id }), 5200),
    );
    return () => timers.forEach(clearTimeout);
  }, [state.toasts]);

  const current = state.pairs.find((p) => p.id === state.selectedId) ?? state.pairs[0];

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of state.pairs) {
      const c = String(p.cells.category.v);
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [state.pairs]);

  const visible = state.pairs.filter((p) =>
    filter === 'all'
      ? true
      : filter === 'favorites'
        ? Boolean(p.cells.favorite.v)
        : String(p.cells.category.v) === filter,
  );

  const create = () => {
    if (!newTitle.trim()) return;
    dispatch({ type: 'create', title: newTitle.trim() });
    setNewTitle('');
    setShowAdd(false);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="brand-mark">
            <Type size={18}/>
          </div>
          <div>
            <b>Type Pairer</b>
            <small>OFFLINE-MERGE LIBRARY</small>
          </div>
        </div>

        <div className="nav-section">
          <span>LIBRARY</span>
          <button
            className={`nav ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <Grid3X3 size={16}/>All pairings <b>{state.pairs.length}</b>
          </button>
          <button
            className={`nav ${filter === 'favorites' ? 'active' : ''}`}
            onClick={() => setFilter('favorites')}
          >
            <Heart size={16}/>Favorites{' '}
            <b>{state.pairs.filter((p) => p.cells.favorite.v).length}</b>
          </button>
        </div>

        <div className="saved">
          <div className="saved-head">
            <span>COLLECTIONS</span>
            <button onClick={() => setShowAdd(true)}>
              <Plus size={14}/>
            </button>
          </div>
          {CATEGORIES.map((c) => (
            <button
              key={c.name}
              className={`collection ${filter === c.name ? 'active' : ''}`}
              onClick={() => setFilter(c.name)}
            >
              <i style={{ background: c.color }}/>
              {c.name} <b>{counts[c.name] ?? 0}</b>
            </button>
          ))}
          {Object.entries(counts)
            .filter(([name]) => !CATEGORIES.some((c) => c.name === name))
            .map(([name, n]) => (
              <button
                key={name}
                className="collection unknown"
                onClick={() => setFilter(name)}
              >
                <i className="unknown-dot"/>
                {name}（归属待核对） <b>{n}</b>
              </button>
            ))}
        </div>

        <SimPanel
          online={state.online}
          failNext={state.failNext}
          dispatch={dispatch}
          onOpenTrash={() => setShowTrash(true)}
          trashCount={state.trash.filter((t) => t.status === 'recycle').length}
        />

        <div className="aside-foot">
          <button className="nav">
            <Settings2 size={16}/>Preferences
          </button>
          <div className="profile">
            <div className="avatar">YL</div>
            <div>
              <b>Yuki Lin</b>
              <small>本机工作区</small>
            </div>
            <ChevronDown size={14}/>
          </div>
        </div>
      </aside>

      <main>
        <SyncBar
          state={state}
          onMerge={() => dispatch({ type: 'sync' })}
          onOpenReview={() => dispatch({ type: 'openReview' })}
        />

        <header>
          <div>
            <div className="crumb">
              TYPE LIBRARY / <b>PAIRING STUDIO</b>
            </div>
            <h1>Find the right conversation.</h1>
            <p>离线也能继续改：每个字段单独记修订时间，回网后逐字段合并。</p>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => setShowAdd(true)}>
              <Plus size={16}/>New pairing
            </button>
          </div>
        </header>

        <div className="layout">
          <section className="gallery">
            <div className="gallery-head">
              <div>
                <h2>{filter === 'all' ? 'Saved pairings' : filter === 'favorites' ? 'Favorites' : filter}</h2>
                <span>{visible.length} compositions</span>
              </div>
              <div className="view-toggle">
                <button className="on">
                  <Grid3X3 size={14}/>
                </button>
                <button>
                  <BookOpen size={14}/>
                </button>
              </div>
            </div>

            <div className="pair-list">
              {visible.map((p) => (
                <PairCard
                  key={p.id}
                  pair={p}
                  selected={current?.id === p.id}
                  onSelect={() => dispatch({ type: 'select', id: p.id })}
                />
              ))}
              {visible.length === 0 && (
                <p className="empty-note">该视图下还没有配对</p>
              )}
            </div>
          </section>

          {current ? (
            <Studio
              pair={current}
              remoteVersion={state.remote.version}
              dispatch={dispatch}
            />
          ) : (
            <section className="studio empty-studio">
              <Trash2 size={22}/>
              <p>库是空的，新建一个配对开始吧。</p>
            </section>
          )}
        </div>
      </main>

      {showAdd && (
        <div className="backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New pairing</h2>
            <label>
              Pairing name
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder="e.g. Quiet confidence"
              />
            </label>
            <div className="modal-actions">
              <button className="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="primary" onClick={create}>
                Create pairing
              </button>
            </div>
          </div>
        </div>
      )}

      {state.review && state.batch && (
        <ReviewModal
          review={state.review}
          attempts={state.batch.attempts}
          dispatch={dispatch}
        />
      )}

      {showTrash && (
        <TrashBin
          trash={state.trash}
          dispatch={dispatch}
          onClose={() => setShowTrash(false)}
        />
      )}

      <div className="toasts">
        {state.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
            <button onClick={() => dispatch({ type: 'dismissToast', id: t.id })}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PairCard({
  pair,
  selected,
  onSelect,
}: {
  pair: Pair;
  selected: boolean;
  onSelect: () => void;
}) {
  const dirty = dirtyFields(pair);
  return (
    <button className={`pair ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="pair-top">
        <span>{String(pair.cells.category.v)}</span>
        <Heart
          size={15}
          fill={pair.cells.favorite.v ? '#e88769' : 'none'}
          color={pair.cells.favorite.v ? '#e88769' : '#aeb5b7'}
        />
      </div>
      <strong style={{ fontFamily: String(pair.cells.headingFont.v) }}>
        {String(pair.cells.heading.v)}
      </strong>
      <p style={{ fontFamily: String(pair.cells.bodyFont.v) }}>
        {String(pair.cells.body.v)}
      </p>
      <div className="pair-foot">
        <span>{String(pair.cells.title.v)}</span>
        {dirty.length > 0 ? (
          <small className="pending">● {dirty.length} 字段待合并</small>
        ) : pair.synced ? (
          <small>Open canvas →</small>
        ) : (
          <small className="pending">仅本机</small>
        )}
      </div>
    </button>
  );
}
