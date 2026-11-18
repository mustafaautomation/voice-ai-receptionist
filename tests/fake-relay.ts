export const RELAY_TOKEN = "relay-test-token";

type Doc = { collection: string; id: string; data: Record<string, unknown>; created_at: number; updated_at: number };

/** In-memory stand-in for the D1 document store, with the same reserve rule. */
export function fakeRelay(options: { down?: boolean; clock?: () => number } = {}) {
  const docs = new Map<string, Doc>();
  let tick = 1;
  const clock = options.clock ?? (() => (tick += 1));
  const requests: string[] = [];
  const clientIps: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    if (options.down) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${decodeURIComponent(url.pathname)}`);
    const headers = new Headers(init?.headers);
    if (headers.get("x-client-ip")) clientIps.push(headers.get("x-client-ip") ?? "");
    if (headers.get("authorization") !== `Bearer ${RELAY_TOKEN}`) return Response.json({ error: "unauthorized" }, { status: 401 });
    const [, , collection, id, action] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (method === "GET" && !id) {
      const key = url.searchParams.get("filter_key");
      const value = url.searchParams.get("filter_value");
      const items = [...docs.values()]
        .filter((doc) => doc.collection === collection)
        .filter((doc) => (key ? String(doc.data[key]) === value : true))
        .sort((a, b) => b.updated_at - a.updated_at);
      return Response.json({ items, next_cursor: null });
    }
    const docKey = `${collection}/${id}`;
    if (method === "DELETE") {
      const existed = docs.delete(docKey);
      return Response.json(existed ? { deleted: true } : { error: "not_found" }, { status: existed ? 200 : 404 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (method === "POST" && action === "reserve") {
      const holder = [...docs.values()].find(
        (doc) =>
          doc.collection === collection &&
          doc.id !== id &&
          doc.data.slot_key === body.slot_key &&
          doc.data.status !== "cancelled",
      );
      if (holder) return Response.json({ error: "slot_taken", held_by: holder.id }, { status: 409 });
    }
    const existing = docs.get(docKey);
    const at = clock();
    const doc: Doc = {
      collection: collection ?? "",
      id: id ?? "",
      data: body,
      created_at: existing?.created_at ?? at,
      updated_at: at,
    };
    docs.set(docKey, doc);
    return Response.json(doc, { status: action === "reserve" ? 201 : 200 });
  };
  return { docs, fetchImpl, requests, clientIps };
}
