import {
  database,
  user,
  json,
  handled,
  sameOrigin,
  hash,
} from '@/lib/server/store';
export async function POST(request: Request) {
  return handled(async () => {
    sameOrigin(request);
    const owner = user(request);
    const token =
      'iat_' +
      crypto.randomUUID().replaceAll('-', '') +
      crypto.randomUUID().replaceAll('-', '');
    const digest = await hash(token);
    await database()
      .prepare(
        'INSERT INTO collector_tokens(owner,token_hash,created_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at',
      )
      .bind(owner, digest, Date.now())
      .run();
    return json({
      token,
      scope: 'telemetry-ingest-only',
      endpoint: new URL('/api/telemetry/ingest', request.url).toString(),
    });
  });
}
