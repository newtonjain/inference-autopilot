/// <reference types="@cloudflare/workers-types" />
import { env } from 'cloudflare:workers';
export const runtime = () =>
  env as unknown as {
    DB?: D1Database;
    OPENAI_API_KEY?: string;
    TELEMETRY_INGEST_TOKEN?: string;
    TELEMETRY_INGEST_OWNER?: string;
  };
export function database() {
  const db = runtime().DB;
  if (!db) throw new ApiError(503, 'Persistent storage is not configured.');
  return db;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function user(request: Request) {
  const id = request.headers.get('oai-authenticated-user-id');
  if (!id)
    throw new ApiError(401, 'Sign in to save workloads or run analysis.');
  return id;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    throw new ApiError(403, 'Same-origin request required.');
}
export async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'JSON required.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Request body required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100000) {
      await reader.cancel();
      throw new ApiError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, 'Invalid JSON.');
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function handled(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (e) {
    return json(
      {
        error:
          e instanceof ApiError
            ? e.message
            : 'Request failed validation or could not be completed.',
      },
      e instanceof ApiError ? e.status : 400,
    );
  }
}
export async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
