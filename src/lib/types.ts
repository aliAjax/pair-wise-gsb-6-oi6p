// 同步体系核心数据模型

export const FIELD_KEYS = [
  'title',
  'heading',
  'body',
  'category',
  'favorite',
  'headingFont',
  'bodyFont',
  'size',
  'weight',
  'leading',
  'tracking',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export type FieldValue = string | number | boolean;

/** 配对文档：每个字段带独立修订时间 */
export interface PairDoc {
  id: string;
  title: string;
  heading: string;
  body: string;
  category: string;
  favorite: boolean;
  headingFont: string;
  bodyFont: string;
  size: number;
  weight: number;
  leading: number;
  tracking: number;
  /** 字段修订时间（毫秒时间戳，逐字段记录） */
  fields: Record<FieldKey, number>;
  updatedAt: number;
  updatedBy: string;
}

/** 该配对上一次同步时的基准快照 */
export interface BaseSnapshot {
  /** 基准版本（远端文档版本号） */
  version: number;
  at: number;
  values: Record<FieldKey, FieldValue>;
}

export interface LocalTombstone {
  id: string;
  at: number;
  by: string;
}

/** 离线续作期间的待同步操作，组成"批次" */
export interface OutboxOp {
  id: string;
  pairId: string;
  kind: 'create' | 'update' | 'delete';
  at: number;
  by: string;
  fields: FieldKey[];
}

/** 回收站副本：远端已删除、但本地有新改动的配对 */
export interface RecycleEntry {
  id: string;
  pairId: string;
  /** 本地最后一版副本 */
  local: PairDoc;
  /** 原值（删除前的基准值） */
  original: Record<FieldKey, FieldValue>;
  /** 处理记录 */
  record: {
    movedAt: number;
    movedBy: string;
    remoteDeletedBy: string;
    remoteDeletedAt: number;
    remoteVersion: number;
    localChanges: { field: FieldKey; from: FieldValue; to: FieldValue; at: number }[];
  };
}

export interface LogEntry {
  id: string;
  at: number;
  kind: 'sync' | 'merge' | 'recycle' | 'error' | 'info';
  text: string;
}

export interface LocalDB {
  pairs: Record<string, PairDoc>;
  bases: Record<string, BaseSnapshot>;
  tombstones: LocalTombstone[];
  outbox: OutboxOp[];
  recycle: RecycleEntry[];
  categories: string[];
  session: PendingSession | null;
  log: LogEntry[];
  meta: {
    userId: string;
    online: boolean;
    lastSavedAt: number | null;
  };
}

/* ---------- 远端（模拟服务器） ---------- */

export interface RemoteDoc extends PairDoc {
  version: number;
}

export interface RemoteTomb {
  at: number;
  by: string;
  version: number;
  snapshot: RemoteDoc | null;
}

export interface RenameRecord {
  from: string;
  to: string;
  at: number;
  by: string;
}

/** 合并开始时冻结的远端快照——重试/重开都以它为基准 */
export interface RemoteSnapshot {
  serverVersion: number;
  fetchedAt: number;
  pairs: Record<string, RemoteDoc>;
  tombstones: Record<string, RemoteTomb>;
  categories: string[];
  renames: RenameRecord[];
}

/* ---------- 合并引擎 ---------- */

export type IssueKind = 'field-conflict' | 'category-rename' | 'local-delete-remote-edit';

export interface IssueResolution {
  choice: 'local' | 'remote' | 'custom' | 'delete' | 'restore';
  value?: FieldValue;
}

export interface MergeIssue {
  id: string;
  pairId: string;
  kind: IssueKind;
  field?: FieldKey;
  summary: string;
  base: FieldValue | null;
  local: FieldValue | null;
  remote: FieldValue | null;
  localBy?: string;
  localAt?: number;
  remoteBy?: string;
  remoteAt?: number;
  /** custom 可选值（如分类列表） */
  options?: string[];
  resolution?: IssueResolution;
}

export type PlanKind = 'create' | 'update' | 'pull' | 'local-delete' | 'remote-delete' | 'both-delete';

export type FieldOrigin = 'local' | 'remote' | 'same' | 'base' | 'resolved';

export interface PairPlan {
  pairId: string;
  title: string;
  kind: PlanKind;
  /** 完整字段值（自动合并后的结果，未叠加待确认项的解决值） */
  autoValues: Record<FieldKey, FieldValue>;
  /** 每个字段的来源，用于预览标注 */
  origins: Record<FieldKey, FieldOrigin>;
  issues: MergeIssue[];
  /** 提交时对远端的版本断言（null=新建，-1=墓碑上重建） */
  expectedVersion: number | null;
  remoteVersion: number | null;
  baseValues: Record<FieldKey, FieldValue> | null;
  /** pull/恢复 时要落地的远端文档（去 version） */
  remoteDoc?: PairDoc;
  /** 远端删除信息（remote-delete 用） */
  remoteTomb?: RemoteTomb;
  /** recycle 场景的本地改动记录 */
  localChanges?: RecycleEntry['record']['localChanges'];
}

export interface PendingSession {
  batchId: string;
  startedAt: number;
  base: RemoteSnapshot;
  plans: PairPlan[];
  status: 'awaiting' | 'failed';
  error?: string;
  attempts: number;
}
