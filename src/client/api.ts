export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const activeOrgId = localStorage.getItem("active_org_id") || "1";
  const headers: Record<string, string> = {
    "X-Organization-Id": activeOrgId,
  };
  
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const opts: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const r = await fetch(path, opts);
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    /* empty body */
  }
  if (!r.ok) {
    const msg = (data as { error?: string } | null)?.error || `${r.status} ${r.statusText}`;
    throw new Error(msg);
  }
  return data as T;
}
