import type { DoAction, Env } from '../types';

const ROOM_ID = 'club-main';

export async function callDo<T = unknown>(env: Env, action: DoAction): Promise<T> {
  const id = env.POKER_ROOM.idFromName(ROOM_ID);
  const stub = env.POKER_ROOM.get(id);
  let res: Response;
  try {
    res = await stub.fetch('https://do/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
  } catch (e) {
    throw new Error(`DO unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const raw = await res.text();
  let data: T & { ok?: boolean; error?: string };
  try {
    data = JSON.parse(raw) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(`DO bad response (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `DO error ${res.status}`);
  }
  return data;
}
