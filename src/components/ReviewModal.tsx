import { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileWarning,
  History,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { FIELD_LABEL, fmt, Review } from '../sync';
import { RepoAction } from '../store';

interface Props {
  review: Review;
  attempts: number;
  dispatch: React.Dispatch<RepoAction>;
}

export default function ReviewModal({ review, attempts, dispatch }: Props) {
  const [step, setStep] = useState<'resolve' | 'preview'>('resolve');
  const unresolved = review.conflicts.filter((c) => !c.resolution);
  const resolved = review.conflicts.filter((c) => c.resolution);

  return (
    <div className="backdrop merge-backdrop">
      <div className="merge-modal">
        <div className="merge-head">
          <div>
            <h2>回网合并 · 逐字段核对</h2>
            <span>
              原批次 {review.batchId.slice(0, 8)} · 基准版本 v{review.baseVersion} ·
              远端当前 v{review.remoteVersion} · 已尝试 {attempts} 次
            </span>
            {review.rechecked && (
              <em className="recheck-note">
                重开后仍从同一基准 v{review.baseVersion} 重新核对，已确认的选择予以保留
              </em>
            )}
          </div>
          <div className="merge-steps">
            <span className={step === 'resolve' ? 'on' : ''}>1 改动确认</span>
            <i/>
            <span className={step === 'preview' ? 'on' : ''}>2 预览</span>
            <i/>
            <span>3 重算提交</span>
          </div>
        </div>

        <div className="merge-body">
          {step === 'resolve' ? (
            <>
              <section>
                <h3>
                  <CheckCircle2 size={14}/> 可自动合并（{review.auto.length}）
                </h3>
                {review.auto.length === 0 && (
                  <p className="empty-note">没有可自动合并的改动</p>
                )}
                <div className="change-list">
                  {review.auto.map((item, i) => (
                    <AutoRow key={i} item={item}/>
                  ))}
                </div>
              </section>

              <section>
                <h3>
                  <AlertTriangle size={14} className="warn-ic"/>
                  待确认项（{review.conflicts.length}
                  {unresolved.length > 0 && `，未选 ${unresolved.length}`}）
                </h3>
                {review.conflicts.length === 0 && (
                  <p className="empty-note">无冲突，分类成员与归属均一致</p>
                )}
                <div className="conflict-list">
                  {review.conflicts.map((c) => (
                    <div
                      key={c.key}
                      className={`conflict ${c.resolution ? 'resolved' : ''}`}
                    >
                      <div className="conflict-top">
                        <b>「{c.title}」</b>
                        <span className="conflict-kind">
                          {c.kind === 'deletion'
                            ? '删除冲突'
                            : c.kind === 'category'
                              ? '分类归属对不上'
                              : `字段「${FIELD_LABEL[c.field!]}」两边都改了`}
                        </span>
                      </div>
                      <div className="conflict-values">
                        <span>基准：{c.kind === 'deletion' ? '本机存在' : fmt(c.field, c.baseV)}</span>
                        <span>
                          <ArrowUpRight size={11}/> 本地：
                          {c.kind === 'deletion' ? '已删除' : fmt(c.field, c.localV)}
                        </span>
                        <span>
                          <ArrowDownLeft size={11}/> 远端：
                          {c.kind === 'deletion' ? `保留并修订（${String(c.remoteV)}）` : fmt(c.field, c.remoteV)}
                        </span>
                      </div>
                      <div className="conflict-options">
                        {c.options.map((o) => (
                          <label
                            key={o.key}
                            className={c.resolution === o.key ? 'pick' : ''}
                          >
                            <input
                              type="radio"
                              name={c.key}
                              checked={c.resolution === o.key}
                              onChange={() => dispatch({ type: 'resolve', key: c.key, resolution: o.key })}
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3>
                  <Trash2 size={14}/> 远端已移除、本地有改动（{review.trash.length}）
                </h3>
                {review.trash.length === 0 ? (
                  <p className="empty-note">无此类配对</p>
                ) : (
                  <div className="trash-draft-list">
                    {review.trash.map((t) => (
                      <div key={t.pairId} className="trash-draft">
                        <FileWarning size={15}/>
                        <div>
                          <b>{t.title}</b>
                          <span>
                            远端于配对版本 v{t.original.version} 移除；本地有{' '}
                            {t.localChanges.length} 项字段改动，确认后原值与处理记录进入回收站副本
                          </span>
                          <small>
                            本地改动：
                            {t.localChanges
                              .map((c) => FIELD_LABEL[c.field!])
                              .join('、')}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <PreviewStep review={review}/>
          )}
        </div>

        <div className="merge-foot">
          <button className="ghost-btn" onClick={() => dispatch({ type: 'cancelBatch' })}>
            <RotateCcw size={13}/> 取消批次（本机改动保留）
          </button>
          <div className="merge-foot-right">
            {step === 'resolve' ? (
              <>
                {unresolved.length > 0 && (
                  <span className="foot-warn">
                    {unresolved.length} 项未选，预览不含这些内容
                  </span>
                )}
                <button
                  className="primary"
                  onClick={() => setStep('preview')}
                  disabled={review.auto.length === 0 && review.conflicts.length === 0 && review.trash.length === 0}
                >
                  改动确认，进入预览 →
                </button>
              </>
            ) : (
              <>
                <button className="outline" onClick={() => setStep('resolve')}>
                  <History size={13}/> 返回修改
                </button>
                <button
                  className="primary"
                  onClick={() => dispatch({ type: 'commitReview' })}
                >
                  确认预览，重算并提交
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoRow({ item }: { item: Review['auto'][number] }) {
  if (item.kind === 'create')
    return (
      <div className="change-row">
        <span className="badge create">新建</span>
        <b>{item.title}</b>
        <span className="muted">本地新配对，将上送到远端</span>
      </div>
    );
  if (item.kind === 'delete')
    return (
      <div className="change-row">
        <span className={`badge ${item.via === 'local' ? 'local' : 'incoming'}`}>
          {item.via === 'local' ? '本地删除' : '远端下传'}
        </span>
        <b>{item.title}</b>
        <span className="muted">{item.via === 'local' ? '远端将同步删除' : '从本地库移除'}</span>
      </div>
    );
  return (
    <div className="change-row">
      <span className={`badge ${item.via === 'local' ? 'local' : 'incoming'}`}>
        {item.via === 'local' ? '本机改动' : '远端下传'}
      </span>
      <b>{item.title}</b>
      <span className="field-change">
        {FIELD_LABEL[item.field]}：{fmt(item.field, item.from)} →{' '}
        <em>{fmt(item.field, item.to)}</em>
      </span>
    </div>
  );
}

function PreviewStep({ review }: { review: Review }) {
  const unresolved = review.conflicts.filter((c) => !c.resolution);
  return (
    <div className="preview-step">
      <p className="preview-note">
        预览只展示已确认内容；未确认项不会被重算，保留为待确认，下次合并继续从同一基准核对。
      </p>
      <section>
        <h3>将应用的改动</h3>
        <div className="change-list">
          {review.auto.map((item, i) => (
            <AutoRow key={i} item={item}/>
          ))}
          {review.conflicts
            .filter((c) => c.resolution)
            .map((c) => {
              const o = c.options.find((x) => x.key === c.resolution);
              return (
                <div key={c.key} className="change-row">
                  <span className="badge resolved-badge">已确认</span>
                  <b>{c.title}</b>
                  <span className="field-change">
                    {c.kind === 'deletion'
                      ? o?.label
                      : `${FIELD_LABEL[c.field!]} → <em>${o?.label.replace(/^.*：/, '')}</em>`}
                  </span>
                </div>
              );
            })}
          {review.trash.map((t) => (
            <div key={t.pairId} className="change-row">
              <span className="badge trash-badge">回收站</span>
              <b>{t.title}</b>
              <span className="muted">保留原值与处理记录，进入回收站副本</span>
            </div>
          ))}
        </div>
      </section>
      {unresolved.length > 0 && (
        <section>
          <h3 className="warn-text">
            <AlertTriangle size={14}/> 以下内容不包含在本次预览（{unresolved.length}）
          </h3>
          <div className="change-list">
            {unresolved.map((c) => (
              <div key={c.key} className="change-row excluded">
                <span className="badge pending-badge">待确认</span>
                <b>{c.title}</b>
                <span className="muted">
                  {c.kind === 'deletion'
                    ? '删除 / 保留未决定'
                    : `${FIELD_LABEL[c.field!]}：本地 ${fmt(c.field, c.localV)} ↔ 远端 ${fmt(c.field, c.remoteV)}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
