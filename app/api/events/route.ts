import { AccessError, requireAccess } from "@/lib/storage";
import { subscribeRealtimeEvents } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAccess(request, "viewer");
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: string) => controller.enqueue(encoder.encode(value));
        send(": connected\n\n");
        const unsubscribe = subscribeRealtimeEvents((event) => {
          try { send(`event: catalog\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`); }
          catch { unsubscribe(); }
        });
        const heartbeat = setInterval(() => {
          try { send(`: heartbeat ${Date.now()}\n\n`); }
          catch { cleanup(); }
        }, 20_000);
        cleanup = () => { clearInterval(heartbeat); unsubscribe(); };
        request.signal.addEventListener("abort", cleanup, { once: true });
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "实时连接失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
