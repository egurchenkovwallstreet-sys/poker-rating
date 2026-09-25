import type { DoAction, Env } from '../types';

const ROOM_ID = 'club-main';

export async function callDo<T = unknown>(env: Env, action: DoAction): Promise<T> {
  const id = env.POKER_ROOM.idFromName(ROOM_ID);
  const stub = env.POKER_ROOM.get(id);
  const res = await stub.fetch('https://do/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `DO error ${res.status}`);
  }
  return data;
}
