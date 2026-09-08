import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const workloads = sqliteTable(
  'workloads',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('workloads_owner_time').on(t.owner, t.createdAt)],
);
export const telemetry = sqliteTable(
  'telemetry',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    payload: text('payload').notNull(),
    observedAt: text('observed_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('telemetry_owner_time').on(t.owner, t.createdAt)],
);
export const analyses = sqliteTable(
  'analyses',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    context: text('context').notNull(),
    status: text('status').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('analyses_owner_time').on(t.owner, t.createdAt)],
);
export const locks = sqliteTable('analysis_locks', {
  owner: text('owner').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
});
export const collectorTokens = sqliteTable('collector_tokens', {
  owner: text('owner').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});
