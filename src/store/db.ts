import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface WebhookEvent {
  /** Rain's envelope id - the deduplication key. */
  id: string;
  resource: string;
  action: string;
  version?: string;
  receivedAt: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

/** A business provisioned for the portal demo, grouped under a Mesta-side partner. */
export interface SeededBusiness {
  companyId: string;
  name: string;
  partnerId: string;
  contractId: string | null;
  userIds: string[];
  cardIds: string[];
  fundedCents: number;
}

export interface DemoRunStep {
  step: string;
  status: 'ok' | 'failed' | 'skipped';
  detail?: string;
  at: string;
}

/** Local mirror of what the POC has created, so a demo can be resumed or replayed. */
export interface DbShape {
  companyId: string | null;
  companyName: string | null;
  contractId: string | null;
  userIds: string[];
  cardIds: string[];
  transactionIds: string[];
  disputeIds: string[];
  events: WebhookEvent[];
  demoLog: DemoRunStep[];
  /** Portal demo state: businesses grouped under partners. */
  businesses: SeededBusiness[];
}

const EMPTY: DbShape = {
  companyId: null,
  companyName: null,
  contractId: null,
  userIds: [],
  cardIds: [],
  transactionIds: [],
  disputeIds: [],
  events: [],
  demoLog: [],
  businesses: [],
};

const FILE = resolve(process.cwd(), 'data', 'state.json');
const MAX_EVENTS = 1000;

function load(): DbShape {
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<DbShape>;
    return { ...EMPTY, ...parsed };
  } catch {
    return structuredClone(EMPTY);
  }
}

let state: DbShape = load();

function persist(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  // Write-then-rename so a crash mid-write cannot truncate the file.
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE);
}

export const db = {
  get(): Readonly<DbShape> {
    return state;
  },

  update(patch: Partial<DbShape>): DbShape {
    state = { ...state, ...patch };
    persist();
    return state;
  },

  push<K extends 'userIds' | 'cardIds' | 'transactionIds' | 'disputeIds'>(
    key: K,
    id: string,
  ): void {
    if (state[key].includes(id)) return;
    state = { ...state, [key]: [...state[key], id] };
    persist();
  },

  /** Returns false when this envelope id has already been stored. */
  addEvent(event: WebhookEvent): boolean {
    if (state.events.some((e) => e.id === event.id)) return false;
    const events = [event, ...state.events].slice(0, MAX_EVENTS);
    state = { ...state, events };
    persist();
    return true;
  },

  appendDemoStep(step: DemoRunStep): void {
    state = { ...state, demoLog: [...state.demoLog, step] };
    persist();
  },

  upsertBusiness(business: SeededBusiness): void {
    // Replace in place. Removing and re-appending would reorder the list every time a
    // card was issued, which reshuffles the portal's business picker.
    const index = state.businesses.findIndex((b) => b.companyId === business.companyId);
    const businesses =
      index === -1
        ? [...state.businesses, business]
        : state.businesses.map((b, i) => (i === index ? business : b));
    state = { ...state, businesses };
    persist();
  },

  findBusiness(companyId: string): SeededBusiness | undefined {
    return state.businesses.find((b) => b.companyId === companyId);
  },

  resetDemoLog(): void {
    state = { ...state, demoLog: [] };
    persist();
  },

  reset(): void {
    state = structuredClone(EMPTY);
    persist();
  },
};
