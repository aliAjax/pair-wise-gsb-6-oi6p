import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CloudOff,
  FileWarning,
  GitMerge,
  History,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { FieldKey, MergeIssue, PairPlan } from '../lib/types';
import { allResolved, buildPreview, issueCount, planResolved } from '../lib/merge';
import type { Store } from '../lib/store';

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

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  return String(v);
}

function fmtTime(t?: number): string {
  if (!t) return '';
  return new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
}

function OriginBadge({ origin }: { origin: PairPlan['origins'][FieldKey] }) {
  const map = {
    local: { text: '取本机', cls: 'o-local' },
    remote: { text: '取对端', cls: 'o-remote' },
    same: { text: '一致', cls: 'o-same' },
    base: { text: '基准', cls: 'o-same' },
    resolved: { text: '已确认', cls: 'o-resolved' },
  } as const;
  const m = map[origin];
  return <span className={`origin-badge ${m.cls}`}>{m.text}</span>;
}

function ValueCell({ label, value, sub, active }: { label: string; value: string; sub?: string; active?: boolean }) {
  return (
    <div className={`vcell ${active ? 'active' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function IssueCard({ issue, store }: { issue: MergeIssue; store: Store }) {
  const res = issue.resolution;
  const isCat = issue.kind === 'category-rename';
  const isDel = issue.kind === 'local-delete-remote-edit';

  return (
    <div className={`issue-card ${res ? 'resolved' : ''}`}>
      <div className="issue-head">
        <AlertTriangle size={14} />
        <b>{issue.summary}</b>
        {res && <span className="resolved-tag"><Check size={11} /> 已确认</span>}
      </div>

      {!isDel && issue.field && (
        <div className="issue-grid">
          <ValueCell label={`基准 v${'—'}`} value={fmt(issue.base)} sub="共同版本" />
          <ValueCell label="本机" value={fmt(issue.local)} sub={`${issue.localBy ?? '我'} ${fmtTime(issue.localAt)}`} active={res?.choice === 'local'} />
          <ValueCell label="对端" value={fmt(issue.remote)} sub={`${issue.remoteBy ?? ''} ${fmtTime(issue.remoteAt)}`} active={res?.choice === 'remote'} />
        </div>
      )}

      <div className="issue-actions">
        {isDel ? (
          <>
            <button
              className={res?.choice === 'delete' ? 'pick picked-danger' : 'pick'}
              onClick={() => store.resolveIssue(issue.id, { choice: 'delete' })}
            >
              <Trash2 size={13} /> 维持删除
            </button>
            <button
              className={res?.choice === 'restore' ? 'pick picked' : 'pick'}
              onClick={() => store.resolveIssue(issue.id, { choice: 'restore' })}
            >
              <History size={13} /> 恢复配对（采用对端版本）
            </button>
          </>
        ) : (
          <>
            <button
              className={res?.choice === 'local' ? 'pick picked' : 'pick'}
              onClick={() => store.resolveIssue(issue.id, { choice: 'local' })}
            >
              用本机值
            </button>
            <button
              className={res?.choice === 'remote' ? 'pick picked' : 'pick'}
              onClick={() => store.resolveIssue(issue.id, { choice: 'remote' })}
            >
              用对端值
            </button>
            {isCat && (
              <select
                value={res?.choice === 'custom' ? String(res.value) : ''}
                onChange={(e) => e.target.value && store.resolveIssue(issue.id, { choice: 'custom', value: e.target.value })}
              >
                <option value="">自定义分类…</option>
                {(issue.options ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ACTION_TEXT: Record<string, { text: string; cls: string; icon: typeof GitMerge }> = {
  create: { text: '本机新建 → 上传', cls: 'act-create', icon: ArrowUpRight },
  update: { text: '逐字段合并后提交', cls: 'act-update', icon: GitMerge },
  pull: { text: '接收对端版本', cls: 'act-pull', icon: ArrowDownLeft },
  delete: { text: '双方一致删除', cls: 'act-delete', icon: Trash2 },
  recycle: { text: '远端已删除 → 进回收站副本', cls: 'act-recycle', icon: FileWarning },
  restore: { text: '确认恢复并上传', cls: 'act-update', icon: History },
  none: { text: '待确认', cls: 'act-none', icon: AlertTriangle },
};

export default function MergeModal({ store, onClose }: { store: Store; onClose: () => void }) {
  const session = store.db.session;
  const preview = useMemo(() => (session ? buildPreview(session) : []), [session]);
  if (!session) return null;

  const remaining = issueCount(session);
  const allDone = allResolved(session);
  const readyItems = preview.filter((i) => i.ready && i.action !== 'none');
  const pendingItems = preview.filter((i) => !i.ready);
  const failed = session.status === 'failed';

  return (
    <div className="backdrop merge-backdrop">
      <div className="modal merge-modal">
        <div className="merge-header">
          <div>
            <span className="merge-kicker">
              <GitMerge size={12} /> 回网合并 · 批次 {session.batchId.slice(-6)}
            </span>
            <h2>逐字段核对，再预览重算</h2>
            <small>
              冻结基准：服务器 v{session.base.serverVersion} · {new Date(session.base.fetchedAt).toLocaleString('zh-CN', { hour12: false })}
              {' · '}已尝试 {session.attempts} 次 · 重试与重开都以同一基准核对
            </small>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={store.busy}><X size={16} /></button>
        </div>

        {failed && (
          <div className="merge-error">
            <CloudOff size={15} />
            <div>
              <b>上一批提交失败，远端与本机均未改动。</b>
              <span>{session.error}</span>
            </div>
            <button className="primary" disabled={store.busy} onClick={() => store.retryMerge()}>
              <RefreshCw size={13} /> 重试原批次
            </button>
          </div>
        )}

        <div className="merge-body">
          <section className="merge-col">
            <div className="col-head">
              <h3>待确认项</h3>
              <span className={remaining > 0 ? 'count-pill warn' : 'count-pill ok'}>
                {remaining > 0 ? `剩 ${remaining} 项` : '全部已确认'}
              </span>
            </div>
            <div className="issue-list">
              {session.plans.flatMap((p) =>
                p.issues.map((iss) => (
                  <div key={iss.id} className="issue-group">
                    <span className="issue-pair-name">{p.title}</span>
                    <IssueCard issue={iss} store={store} />
                  </div>
                )),
              )}
              {remaining === 0 && (
                <div className="empty-note"><Check size={14} /> 没有待确认项，可以直接查看右侧预览。</div>
              )}
              {pendingItems.length > 0 && (
                <p className="preview-hint">
                  还有 {pendingItems.length} 个配对未确认完，不会出现在预览与本次提交中。
                </p>
              )}
            </div>
          </section>

          <section className="merge-col preview-col">
            <div className="col-head">
              <h3>合并预览（仅已确认内容）</h3>
              <span className="count-pill">{readyItems.length} 项</span>
            </div>
            <div className="preview-list">
              {readyItems.map((item) => {
                const plan = item.plan;
                const a = ACTION_TEXT[item.action] ?? ACTION_TEXT.none;
                const AIcon = a.icon;
                return (
                  <div key={plan.pairId} className={`preview-card ${a.cls}`}>
                    <div className="preview-card-head">
                      <span className="action-tag"><AIcon size={12} /> {a.text}</span>
                      <small>远端 v{plan.remoteVersion ?? '—'}</small>
                    </div>

                    {item.action === 'recycle' ? (
                      <div className="recycle-preview">
                        <b>{plan.title}</b>
                        <p>对端已于 {new Date(plan.remoteTomb?.at ?? 0).toLocaleString('zh-CN', { hour12: false })} 删除（{plan.remoteTomb?.by}）。
                          你本机有 {plan.localChanges?.length ?? 0} 处未同步改动，将作为带原值与处理记录的副本移入回收站。</p>
                        <div className="change-chips">
                          {plan.localChanges?.map((c) => (
                            <span key={c.field} className="chip">
                              {FIELD_LABELS[c.field]}：{fmt(c.from)} → {fmt(c.to)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : item.action === 'delete' ? (
                      <div className="recycle-preview"><b>{plan.title}</b><p>该配对将从本机与远端一并移除。</p></div>
                    ) : item.values ? (
                      <div className="merged-fields">
                        {(['title', 'category', 'heading', 'body', 'headingFont', 'bodyFont', 'size', 'weight', 'leading', 'tracking', 'favorite'] as FieldKey[]).map((k) => {
                          const origin = planResolved(plan) && plan.issues.some((i) => i.field === k)
                            ? 'resolved'
                            : plan.origins[k];
                          return (
                            <div key={k} className="mfield">
                              <span>{FIELD_LABELS[k]}</span>
                              <b>{fmt(item.values![k])}</b>
                              <OriginBadge origin={origin} />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {readyItems.length === 0 && (
                <div className="empty-note">确认待处理项后，这里才会显示最终合并结果。</div>
              )}
            </div>
          </section>
        </div>

        <div className="merge-footer">
          <button className="outline" onClick={onClose} disabled={store.busy}>取消（保留批次，本地/远端均不改）</button>
          <span className="footer-hint">
            {allDone ? '预览内容与提交内容一致。' : `还有 ${remaining} 项未确认；只提交已确认的配对。`}
          </span>
          <button className="primary" disabled={!allDone || store.busy || failed} onClick={() => store.commitMerge()}>
            <GitMerge size={14} /> 按预览重算并提交批次
          </button>
        </div>
      </div>
    </div>
  );
}
