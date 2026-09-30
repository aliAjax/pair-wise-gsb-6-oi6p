import { Clock3, Star, Trash2 } from 'lucide-react';
import { CATEGORIES, dirtyFields, FIELD_LABEL, fmtTime, Pair, FieldName, Val } from '../sync';
import type { RepoAction } from '../store';

const FONTS = [
  'Fraunces',
  'DM Sans',
  'Space Grotesk',
  'Newsreader',
  'IBM Plex Sans',
  'Playfair Display',
];

export default function Studio({
  pair,
  remoteVersion,
  dispatch,
}: {
  pair: Pair;
  remoteVersion: number;
  dispatch: React.Dispatch<RepoAction>;
}) {
  const dirty = new Set(dirtyFields(pair));
  const set = (field: FieldName, value: Val) =>
    dispatch({ type: 'edit', id: pair.id, field, value });

  return (
    <section className="studio">
      <div className="studio-head">
        <div>
          <span>PAIRING CANVAS</span>
          <input
            className="title-input"
            value={String(pair.cells.title.v)}
            onChange={(e) => set('title', e.target.value)}
          />
          <div className="base-line">
            基准版本 v{pair.baseVersion}
            {pair.synced ? '' : ' · 仅本机（未同步）'}
            {dirty.size > 0 && <em className="dirty-sum">{dirty.size} 个字段已改待合并</em>}
          </div>
        </div>
        <button
          className="favorite"
          title="收藏"
          onClick={() => set('favorite', !pair.cells.favorite.v)}
        >
          <Star
            size={16}
            fill={pair.cells.favorite.v ? '#e5a35e' : 'none'}
            color={pair.cells.favorite.v ? '#e5a35e' : '#98a4a7'}
          />
        </button>
      </div>

      <div className="canvas">
        <div className="canvas-bar">
          <span>PREVIEW</span>
          <div>
            <button>Desktop</button>
            <button>Tablet</button>
            <button>Mobile</button>
          </div>
        </div>
        <div className="preview">
          <span className="preview-kicker">A NOTE ON TYPE</span>
          <h3
            style={{
              fontFamily: String(pair.cells.headingFont.v),
              fontSize: `${pair.cells.size.v}px`,
              fontWeight: Number(pair.cells.weight.v),
              letterSpacing: `${pair.cells.tracking.v}px`,
              lineHeight: 1.05,
            }}
          >
            {String(pair.cells.heading.v)}
          </h3>
          <p
            style={{
              fontFamily: String(pair.cells.bodyFont.v),
              lineHeight: Number(pair.cells.leading.v),
              letterSpacing: `${Number(pair.cells.tracking.v) / 2}px`,
            }}
          >
            {String(pair.cells.body.v)}
          </p>
          <div className="preview-rule"/>
          <span className="preview-meta">
            {String(pair.cells.category.v).toUpperCase()}
          </span>
        </div>
      </div>

      <div className="controls">
        <div className="control-head">
          <div>
            <span>TYPE CONTROLS · 每个字段单独记录修订时间</span>
            <h3>Fine tune your pairing</h3>
          </div>
        </div>

        <FieldRow
          label="标题文案"
          field="heading"
          value={String(pair.cells.heading.v)}
          dirty={dirty.has('heading')}
          at={pair.cells.heading.at}
          render={(cls) => (
            <input
              className={cls}
              value={String(pair.cells.heading.v)}
              onChange={(e) => set('heading', e.target.value)}
            />
          )}
        />
        <FieldRow
          label="正文文案"
          field="body"
          value={String(pair.cells.body.v)}
          dirty={dirty.has('body')}
          at={pair.cells.body.at}
          render={(cls) => (
            <textarea
              className={cls}
              rows={2}
              value={String(pair.cells.body.v)}
              onChange={(e) => set('body', e.target.value)}
            />
          )}
        />

        <div className="font-row">
          <FieldMark label="分类归属" dirty={dirty.has('category')}>
            <select
              value={String(pair.cells.category.v)}
              onChange={(e) => set('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
              {!CATEGORIES.some((c) => c.name === pair.cells.category.v) && (
                <option>{String(pair.cells.category.v)}</option>
              )}
            </select>
          </FieldMark>
          <FieldMark label="标题字体" dirty={dirty.has('headingFont')}>
            <select
              value={String(pair.cells.headingFont.v)}
              onChange={(e) => set('headingFont', e.target.value)}
            >
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </FieldMark>
        </div>

        <div className="font-row">
          <FieldMark label="正文字体" dirty={dirty.has('bodyFont')}>
            <select
              value={String(pair.cells.bodyFont.v)}
              onChange={(e) => set('bodyFont', e.target.value)}
            >
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </FieldMark>
          <div className="size-line">
            <FieldMark label={`字号 · ${String(pair.cells.size.v)}px`} dirty={dirty.has('size')}>
              <input
                type="range"
                min="28"
                max="76"
                value={Number(pair.cells.size.v)}
                onChange={(e) => set('size', Number(e.target.value))}
              />
            </FieldMark>
          </div>
        </div>

        <div className="range-row">
          <FieldMark label={`字重 · ${String(pair.cells.weight.v)}`} dirty={dirty.has('weight')}>
            <input
              type="range"
              min="300"
              max="800"
              step="100"
              value={Number(pair.cells.weight.v)}
              onChange={(e) => set('weight', Number(e.target.value))}
            />
          </FieldMark>
          <FieldMark
            label={`行高 · ${Number(pair.cells.leading.v).toFixed(2)}`}
            dirty={dirty.has('leading')}
          >
            <input
              type="range"
              min="1"
              max="1.8"
              step=".05"
              value={Number(pair.cells.leading.v)}
              onChange={(e) => set('leading', Number(e.target.value))}
            />
          </FieldMark>
        </div>
        <div className="range-row">
          <FieldMark
            label={`字距 · ${String(pair.cells.tracking.v)}px`}
            dirty={dirty.has('tracking')}
          >
            <input
              type="range"
              min="-1"
              max="3"
              step=".5"
              value={Number(pair.cells.tracking.v)}
              onChange={(e) => set('tracking', Number(e.target.value))}
            />
          </FieldMark>
        </div>
      </div>

      <div className="studio-foot">
        <button
          className="delete"
          onClick={() => dispatch({ type: 'deleteLocal', id: pair.id })}
        >
          <Trash2 size={15}/> 删除配对
        </button>
        <span className="saved-note">
          <Clock3 size={12}/> 逐字段自动保存到本机 · 远端最新 v{remoteVersion}
        </span>
      </div>
    </section>
  );
}

function FieldRow({
  label,
  field,
  value,
  dirty,
  at,
  render,
}: {
  label: string;
  field: FieldName;
  value: string;
  dirty: boolean;
  at: number;
  render: (cls: string) => React.ReactNode;
}) {
  return (
    <div className={`field-row ${dirty ? 'is-dirty' : ''}`}>
      <label>
        {label}
        {dirty && <i className="dirty-dot" title="相对基准已修改"/>}
      </label>
      {render('text-edit')}
      <small className="rev-time" title={`字段「${FIELD_LABEL[field]}」修订时间`}>
        <Clock3 size={10}/> 修订于 {fmtTime(at)}
      </small>
      <small className="dirty-flag">{dirty ? '待合并' : '与基准一致'}</small>
    </div>
  );
}

function FieldMark({
  label,
  dirty,
  children,
}: {
  label: string;
  dirty: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`field-mark ${dirty ? 'is-dirty' : ''}`}>
      <span>
        {label}
        {dirty && <i className="dirty-dot"/>}
      </span>
      {children}
    </label>
  );
}
