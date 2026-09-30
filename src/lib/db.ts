import type {
  BaseSnapshot,
  FieldKey,
  LocalDB,
  LogEntry,
  PairDoc,
} from './types';
import { FIELD_KEYS } from './types';

export const LOCAL_KEY = 'type-pairer-db-v2';
export const REMOTE_KEY = 'type-pairer-remote-v1';
export const CURRENT_USER = 'you';
export const REMOTE_USER = 'Yuki Lin';

export const FONTS = [
  'Fraunces',
  'DM Sans',
  'Space Grotesk',
  'Newsreader',
  'IBM Plex Sans',
  'Playfair Display',
];

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now(): number {
  return Date.now();
}

const SEED_TYPES: Record<FieldKey, FieldValue> = {
  title: '',
  heading: '',
  body: '',
  category: '',
  favorite: false,
  headingFont: 'Fraunces',
  bodyFont: 'DM Sans',
  size: 46,
  weight: 600,
  leading: 1.25,
  tracking: 0,
};

type FieldValue = string | number | boolean;

function stampAll(t: number): Record<FieldKey, number> {
  return FIELD_KEYS.reduce((acc, k) => {
    acc[k] = t;
    return acc;
  }, {} as Record<FieldKey, number>);
}

interface SeedInput {
  id: string;
  title: string;
  heading: string;
  body: string;
  category: string;
  favorite: boolean;
  headingFont?: string;
  bodyFont?: string;
}

export function makeDoc(input: SeedInput, at: number, by: string): PairDoc {
  const fields = stampAll(at);
  return {
    id: input.id,
    title: input.title,
    heading: input.heading,
    body: input.body,
    category: input.category,
    favorite: input.favorite,
    headingFont: input.headingFont ?? 'Fraunces',
    bodyFont: input.bodyFont ?? 'DM Sans',
    size: SEED_TYPES.size as number,
    weight: SEED_TYPES.weight as number,
    leading: SEED_TYPES.leading as number,
    tracking: SEED_TYPES.tracking as number,
    fields,
    updatedAt: at,
    updatedBy: by,
  };
}

export function baseFromDoc(doc: PairDoc, version: number, at: number): BaseSnapshot {
  const values = FIELD_KEYS.reduce((acc, k) => {
    acc[k] = doc[k];
    return acc;
  }, {} as Record<FieldKey, FieldValue>);
  return { version, at, values };
}

const SEED_PAIRS: SeedInput[] = [
  {
    id: 'p_editorial',
    title: 'Editorial calm',
    heading: 'A slower way to see',
    body: 'Good typography creates space for ideas to breathe. Pair a confident display face with a quiet, generous text face.',
    category: 'Editorial',
    favorite: true,
  },
  {
    id: 'p_studio',
    title: 'Studio notes',
    heading: 'Make room for the unexpected',
    body: 'A thoughtful pairing can add rhythm to even the simplest interface. Try contrast in shape, not just size.',
    category: 'Portfolio',
    favorite: false,
    headingFont: 'Playfair Display',
    bodyFont: 'IBM Plex Sans',
  },
  {
    id: 'p_field',
    title: 'Field guide',
    heading: 'Small details, lasting impressions',
    body: 'Typography is the voice of a page. Find a combination that feels clear, warm and distinctly yours.',
    category: 'Brand',
    favorite: false,
    headingFont: 'Newsreader',
    bodyFont: 'Space Grotesk',
  },
];

export const SEED_CATEGORIES = ['Editorial', 'Portfolio', 'Brand', 'Untitled'];

/** 首启：本地与远端共用同一份种子，基准版本 1 */
export function freshLocalDB(): LocalDB {
  const t = now() - 60_000;
  const pairs: Record<string, PairDoc> = {};
  const bases: Record<string, BaseSnapshot> = {};
  SEED_PAIRS.forEach((s) => {
    const doc = makeDoc(s, t, CURRENT_USER);
    pairs[s.id] = doc;
    bases[s.id] = baseFromDoc(doc, 1, t);
  });
  return {
    pairs,
    bases,
    tombstones: [],
    outbox: [],
    recycle: [],
    categories: [...SEED_CATEGORIES],
    session: null,
    log: [
      {
        id: uid('log'),
        at: now(),
        kind: 'info',
        text: '本地库初始化：字体配对已保存在本机，基准版本 v1。',
      },
    ],
    meta: { userId: CURRENT_USER, online: true, lastSavedAt: now() },
  };
}

export function loadDB(): LocalDB {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalDB;
      if (parsed && parsed.pairs && parsed.bases) return parsed;
    }
  } catch {
    /* 损坏则重建 */
  }
  const db = freshLocalDB();
  saveDB(db);
  return db;
}

export function saveDB(db: LocalDB): void {
  db.meta.lastSavedAt = now();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
}

export function addLog(db: LocalDB, kind: LogEntry['kind'], text: string): void {
  db.log.unshift({ id: uid('log'), at: now(), kind, text });
  if (db.log.length > 80) db.log.length = 80;
}
