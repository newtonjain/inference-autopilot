import {
  database,
  user,
  body,
  json,
  handled,
  sameOrigin,
} from '@/lib/server/store';
import { parseWorkload, parseProfile, record } from '@/lib/analysis-contract';
export async function GET(request: Request) {
  return handled(async () => {
    const owner = user(request);
    const rows = await database()
      .prepare(
        'SELECT id,name,payload,created_at FROM workloads WHERE owner=? ORDER BY created_at DESC LIMIT 20',
      )
      .bind(owner)
      .all();
    return json({
      workloads: rows.results.map((r) => ({
        ...r,
        payload: JSON.parse(r.payload as string),
      })),
    });
  });
}
export async function POST(request: Request) {
  return handled(async () => {
    sameOrigin(request);
    const owner = user(request),
      input = record(await body(request));
    const payload = {
      workload: parseWorkload(input.workload),
      profile: parseProfile(input.profile),
    };
    const name =
      typeof input.name === 'string'
        ? input.name.slice(0, 80)
        : 'Saved workload';
    const id = crypto.randomUUID();
    await database()
      .prepare(
        'INSERT INTO workloads (id,owner,name,payload,created_at) VALUES (?,?,?,?,?)',
      )
      .bind(id, owner, name, JSON.stringify(payload), Date.now())
      .run();
    return json({ id, name });
  });
}
