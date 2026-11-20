export type RealtimeEvent = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
};

type Listener = (event: RealtimeEvent) => void;
type RealtimeState = { listeners: Set<Listener> };

const globalRealtime = globalThis as typeof globalThis & { __forgehubRealtimeState?: RealtimeState };

function getRealtimeState() {
  if (!globalRealtime.__forgehubRealtimeState) globalRealtime.__forgehubRealtimeState = { listeners: new Set() };
  return globalRealtime.__forgehubRealtimeState;
}

export function publishRealtimeEvent(action: string, resourceType: string, resourceId: string) {
  const event: RealtimeEvent = { id: crypto.randomUUID(), action, resourceType, resourceId, createdAt: new Date().toISOString() };
  for (const listener of getRealtimeState().listeners) listener(event);
}

export function subscribeRealtimeEvents(listener: Listener) {
  const listeners = getRealtimeState().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}
