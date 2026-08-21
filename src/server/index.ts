import { Hono, type Context } from "hono";
import { z } from "zod";
import { initDB, query, get, run } from "./db";
import { paymentRegistry } from "./payments/registry";

type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  initDB(c.env);
  await next();
});

// ── Helpers ────────────────────────────────────────────────────────

const intParam = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

const getOrgId = (c: Context): number => {
  const header = c.req.header("X-Organization-Id");
  const parsed = intParam(header);
  return parsed && parsed > 0 ? parsed : 1;
};

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, data: parsed.data };
}

function buildUpdate(fields: Record<string, unknown>): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  return { sets, params };
}

// ── Organizations ──────────────────────────────────────────────────

const OrganizationInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  seed_demo_data: z.boolean().optional(),
});

app.get("/api/organizations", async (c) => {
  const rows = await query("SELECT * FROM organizations ORDER BY name");
  return c.json({ organizations: rows });
});

app.get("/api/organizations/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get("SELECT * FROM organizations WHERE id = ?", [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ organization: row });
});

app.post("/api/organizations", async (c) => {
  const parsed = await parseJson(c, OrganizationInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const slug = d.slug || d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  
  const result = await run(
    "INSERT INTO organizations (name, slug) VALUES (?, ?)",
    [d.name, slug],
  );
  const orgId = result.lastInsertRowid;

  // Insert default settings for the new organization
  await run("INSERT OR IGNORE INTO settings (org_id, key, value) VALUES (?, 'default_rent_due_day', '1')", [orgId]);
  await run("INSERT OR IGNORE INTO settings (org_id, key, value) VALUES (?, 'late_fee_amount', '50')", [orgId]);
  await run("INSERT OR IGNORE INTO settings (org_id, key, value) VALUES (?, 'late_fee_grace_days', '5')", [orgId]);
  await run("INSERT OR IGNORE INTO settings (org_id, key, value) VALUES (?, 'currency', 'USD')", [orgId]);

  // Optionally seed sample properties & vendors for a quick-start demo
  if (d.seed_demo_data) {
    const p1 = await run(
      "INSERT INTO properties (org_id, name, type, address, city, state, zip, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [orgId, `${d.name} Plaza`, "multi_family", "100 Main St", "Austin", "TX", "78701", "emerald"],
    );
    await run(
      "INSERT INTO units (property_id, name, bedrooms, bathrooms, sqft, market_rent, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [p1.lastInsertRowid, "Suite 101", 2, 2, 1100, 2100, "vacant"],
    );
    await run(
      "INSERT INTO vendors (org_id, name, category, phone, color) VALUES (?, ?, ?, ?, ?)",
      [orgId, "Citywide Maintenance", "general", "512-555-0199", "sky"],
    );
  }

  const row = await get("SELECT * FROM organizations WHERE id = ?", [orgId]);
  return c.json({ organization: row }, 201);
});

// ── Properties ─────────────────────────────────────────────────────

const PropertyInput = z.object({
  name: z.string().min(1),
  type: z.enum(["single_family", "multi_family", "condo", "townhouse", "commercial"]).optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  year_built: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().optional(),
});

app.get("/api/properties", async (c) => {
  const orgId = getOrgId(c);
  const rows = await query(
    `SELECT p.*,
       (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id) as unit_count,
       (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'occupied') as occupied_count
     FROM properties p 
     WHERE p.org_id = ?
     ORDER BY p.name`,
    [orgId],
  );
  return c.json({ properties: rows });
});

app.get("/api/properties/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get("SELECT * FROM properties WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ property: row });
});

app.post("/api/properties", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, PropertyInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO properties (org_id, name, type, address, city, state, zip, year_built, notes, color)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId, d.name, d.type ?? "single_family", d.address ?? null, d.city ?? null, d.state ?? null, d.zip ?? null, d.year_built ?? null, d.notes ?? null, d.color ?? "sky"],
  );
  const row = await get("SELECT * FROM properties WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ property: row }, 201);
});

app.put("/api/properties/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PropertyInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id, orgId);
  const r = await run(`UPDATE properties SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM properties WHERE id = ?", [id]);
  return c.json({ property: row });
});

app.delete("/api/properties/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM properties WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Units ──────────────────────────────────────────────────────────

const UnitInput = z.object({
  property_id: z.number().int(),
  name: z.string().min(1),
  bedrooms: z.number().min(0).optional(),
  bathrooms: z.number().min(0).optional(),
  sqft: z.number().int().optional().nullable(),
  market_rent: z.number().min(0).optional(),
  status: z.enum(["vacant", "occupied", "turnover", "unavailable"]).optional(),
  notes: z.string().optional().nullable(),
});

const UNIT_SELECT = `
  SELECT u.*,
    p.name as property_name,
    p.color as property_color,
    p.address as property_address,
    p.city as property_city,
    (SELECT l.id FROM leases l WHERE l.unit_id = u.id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) as active_lease_id,
    (SELECT t.first_name || ' ' || t.last_name FROM leases l LEFT JOIN tenants t ON t.id = l.primary_tenant_id WHERE l.unit_id = u.id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) as active_tenant_name
  FROM units u
  JOIN properties p ON p.id = u.property_id
`;

app.get("/api/units", async (c) => {
  const orgId = getOrgId(c);
  const propertyId = intParam(c.req.query("property_id"));
  const status = c.req.query("status");
  const where: string[] = ["p.org_id = ?"];
  const params: unknown[] = [orgId];
  if (propertyId) { where.push("u.property_id = ?"); params.push(propertyId); }
  if (status) { where.push("u.status = ?"); params.push(status); }
  const sql = `${UNIT_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.name, u.name`;
  const rows = await query(sql, params);
  return c.json({ units: rows });
});

app.get("/api/units/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${UNIT_SELECT} WHERE u.id = ? AND p.org_id = ?`, [id, orgId]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ unit: row });
});

app.post("/api/units", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, UnitInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  // Verify property belongs to this org
  const prop = await get("SELECT id FROM properties WHERE id = ? AND org_id = ?", [d.property_id, orgId]);
  if (!prop) return c.json({ error: "Property not found" }, 404);

  const result = await run(
    `INSERT INTO units (property_id, name, bedrooms, bathrooms, sqft, market_rent, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.property_id, d.name, d.bedrooms ?? 1, d.bathrooms ?? 1, d.sqft ?? null, d.market_rent ?? 0, d.status ?? "vacant", d.notes ?? null],
  );
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [result.lastInsertRowid]);
  return c.json({ unit: row }, 201);
});

app.put("/api/units/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const existing = await get("SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ? AND p.org_id = ?", [id, orgId]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const parsed = await parseJson(c, UnitInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  await run(`UPDATE units SET ${sets.join(", ")} WHERE id = ?`, params);
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [id]);
  return c.json({ unit: row });
});

app.delete("/api/units/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const existing = await get("SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ? AND p.org_id = ?", [id, orgId]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  await run("DELETE FROM units WHERE id = ?", [id]);
  return c.json({ ok: true });
});

// ── Tenants ────────────────────────────────────────────────────────

const TenantInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  emergency_contact: z.string().optional().nullable(),
  employer: z.string().optional().nullable(),
  monthly_income: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

app.get("/api/tenants", async (c) => {
  const orgId = getOrgId(c);
  const search = c.req.query("q")?.trim();
  if (search) {
    const like = `%${search}%`;
    const rows = await query(
      `SELECT t.*,
         (SELECT u.id FROM leases l LEFT JOIN units u ON u.id = l.unit_id
            WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_id,
         (SELECT u.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id
            WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_name,
         (SELECT p.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN properties p ON p.id = u.property_id
            WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_property_name
       FROM tenants t
       WHERE t.org_id = ? AND (t.last_name LIKE ? OR t.first_name LIKE ? OR t.email LIKE ? OR t.phone LIKE ?)
       ORDER BY t.last_name, t.first_name LIMIT 200`,
      [orgId, like, like, like, like],
    );
    return c.json({ tenants: rows });
  }
  const rows = await query(
    `SELECT t.*,
       (SELECT u.id FROM leases l LEFT JOIN units u ON u.id = l.unit_id
          WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_id,
       (SELECT u.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id
          WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_name,
       (SELECT p.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN properties p ON p.id = u.property_id
          WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_property_name
     FROM tenants t WHERE t.org_id = ? ORDER BY t.last_name, t.first_name LIMIT 500`,
    [orgId],
  );
  return c.json({ tenants: rows });
});

app.get("/api/tenants/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get("SELECT * FROM tenants WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ tenant: row });
});

app.post("/api/tenants", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, TenantInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO tenants (org_id, first_name, last_name, email, phone, date_of_birth, emergency_contact, employer, monthly_income, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId, d.first_name, d.last_name, d.email ?? null, d.phone ?? null, d.date_of_birth ?? null, d.emergency_contact ?? null, d.employer ?? null, d.monthly_income ?? null, d.notes ?? null],
  );
  const row = await get("SELECT * FROM tenants WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ tenant: row }, 201);
});

app.put("/api/tenants/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, TenantInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id, orgId);
  const r = await run(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM tenants WHERE id = ?", [id]);
  return c.json({ tenant: row });
});

app.delete("/api/tenants/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM tenants WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Leases ─────────────────────────────────────────────────────────

const LeaseInput = z.object({
  unit_id: z.number().int(),
  primary_tenant_id: z.number().int().nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
  monthly_rent: z.number().min(0).optional(),
  deposit: z.number().min(0).optional(),
  rent_due_day: z.number().int().min(1).max(31).optional(),
  late_fee: z.number().min(0).optional(),
  status: z.enum(["upcoming", "active", "ended", "cancelled"]).optional(),
  notes: z.string().optional().nullable(),
});

const LEASE_SELECT = `
  SELECT l.*,
    u.name as unit_name,
    p.id as property_id, p.name as property_name, p.color as property_color,
    t.first_name as tenant_first_name, t.last_name as tenant_last_name,
    t.email as tenant_email, t.phone as tenant_phone
  FROM leases l
  LEFT JOIN units u ON u.id = l.unit_id
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN tenants t ON t.id = l.primary_tenant_id
`;

app.get("/api/leases", async (c) => {
  const orgId = getOrgId(c);
  const status = c.req.query("status");
  const tenantId = intParam(c.req.query("tenant_id"));
  const unitId = intParam(c.req.query("unit_id"));
  const where: string[] = ["l.org_id = ?"];
  const params: unknown[] = [orgId];
  if (status) { where.push("l.status = ?"); params.push(status); }
  if (tenantId) { where.push("l.primary_tenant_id = ?"); params.push(tenantId); }
  if (unitId) { where.push("l.unit_id = ?"); params.push(unitId); }
  const sql = `${LEASE_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.start_date DESC`;
  const rows = await query(sql, params);
  return c.json({ leases: rows });
});

app.get("/api/leases/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${LEASE_SELECT} WHERE l.id = ? AND l.org_id = ?`, [id, orgId]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ lease: row });
});

app.post("/api/leases", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, LeaseInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO leases (org_id, unit_id, primary_tenant_id, start_date, end_date, monthly_rent, deposit, rent_due_day, late_fee, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId, d.unit_id, d.primary_tenant_id ?? null, d.start_date, d.end_date, d.monthly_rent ?? 0, d.deposit ?? 0, d.rent_due_day ?? 1, d.late_fee ?? 0, d.status ?? "active", d.notes ?? null],
  );
  // Mark the unit as occupied if the new lease is active.
  if ((d.status ?? "active") === "active") {
    await run("UPDATE units SET status = 'occupied' WHERE id = ?", [d.unit_id]);
  }
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [result.lastInsertRowid]);
  return c.json({ lease: row }, 201);
});

app.put("/api/leases/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, LeaseInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id, orgId);
  const r = await run(`UPDATE leases SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [id]);
  return c.json({ lease: row });
});

app.delete("/api/leases/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM leases WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Rent charges & payments ────────────────────────────────────────

const ChargeInput = z.object({
  lease_id: z.number().int(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  due_date: z.string(),
  amount: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

const CHARGE_SELECT = `
  SELECT c.*,
    l.unit_id, l.monthly_rent as lease_rent, l.rent_due_day,
    u.name as unit_name,
    p.id as property_id, p.name as property_name, p.color as property_color,
    t.id as tenant_id, t.first_name as tenant_first_name, t.last_name as tenant_last_name
  FROM rent_charges c
  LEFT JOIN leases l ON l.id = c.lease_id
  LEFT JOIN units u ON u.id = l.unit_id
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN tenants t ON t.id = l.primary_tenant_id
`;

app.get("/api/rent-charges", async (c) => {
  const orgId = getOrgId(c);
  const period = c.req.query("period");
  const status = c.req.query("status");
  const where: string[] = ["l.org_id = ?"];
  const params: unknown[] = [orgId];
  if (period) { where.push("c.period = ?"); params.push(period); }
  if (status) { where.push("c.status = ?"); params.push(status); }
  const sql = `${CHARGE_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.due_date, p.name, u.name`;
  const rows = await query(sql, params).catch(() => []);
  return c.json({ charges: rows });
});

app.post("/api/rent-charges", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, ChargeInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  // Verify lease belongs to org
  const lease = await get("SELECT id FROM leases WHERE id = ? AND org_id = ?", [d.lease_id, orgId]);
  if (!lease) return c.json({ error: "Lease not found" }, 404);

  const result = await run(
    `INSERT INTO rent_charges (lease_id, period, due_date, amount, notes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lease_id, period) DO NOTHING`,
    [d.lease_id, d.period, d.due_date, d.amount ?? 0, d.notes ?? null],
  );
  if (!result.changes) {
    const existing = await get(`${CHARGE_SELECT} WHERE c.lease_id = ? AND c.period = ?`, [d.lease_id, d.period]);
    return c.json({ charge: existing });
  }
  const row = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [result.lastInsertRowid]);
  return c.json({ charge: row }, 201);
});

// Generate (idempotent) charges for a given period across all active leases for the org.
app.post("/api/rent-charges/generate", async (c) => {
  const orgId = getOrgId(c);
  const body = await c.req.json().catch(() => ({})) as { period?: string };
  const period = body.period;
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return c.json({ error: "period (YYYY-MM) required" }, 400);
  const leases = await query<{ id: number; monthly_rent: number; rent_due_day: number; start_date: string; end_date: string }>(
    "SELECT id, monthly_rent, rent_due_day, start_date, end_date FROM leases WHERE org_id = ? AND status = 'active'",
    [orgId],
  );
  let created = 0;
  for (const l of leases) {
    const periodStart = `${period}-01`;
    if (l.end_date < periodStart) continue;
    const day = String(Math.min(28, Math.max(1, l.rent_due_day))).padStart(2, "0");
    const dueDate = `${period}-${day}`;
    const r = await run(
      `INSERT INTO rent_charges (lease_id, period, due_date, amount) VALUES (?, ?, ?, ?)
         ON CONFLICT(lease_id, period) DO NOTHING`,
      [l.id, period, dueDate, l.monthly_rent],
    );
    if (r.changes) created++;
  }
  // Re-mark anything past due as 'overdue'.
  await run(
    `UPDATE rent_charges SET status = 'overdue'
     WHERE lease_id IN (SELECT id FROM leases WHERE org_id = ?)
       AND status IN ('open', 'partial') AND amount_paid < amount AND due_date < date('now')`,
    [orgId],
  );
  return c.json({ created, period });
});

app.put("/api/rent-charges/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const existing = await get("SELECT c.id FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ? AND l.org_id = ?", [id, orgId]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const Patch = z.object({
    amount: z.number().min(0).optional(),
    due_date: z.string().optional(),
    status: z.enum(["open", "partial", "paid", "overdue", "waived"]).optional(),
    notes: z.string().optional().nullable(),
  });
  const parsed = await parseJson(c, Patch);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  await run(`UPDATE rent_charges SET ${sets.join(", ")} WHERE id = ?`, params);
  const row = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [id]);
  return c.json({ charge: row });
});

app.delete("/api/rent-charges/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const existing = await get("SELECT c.id FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ? AND l.org_id = ?", [id, orgId]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  await run("DELETE FROM rent_charges WHERE id = ?", [id]);
  return c.json({ ok: true });
});

const PaymentInput = z.object({
  charge_id: z.number().int(),
  paid_at: z.string().optional(),
  amount: z.number().min(0),
  method: z.enum(["cash", "check", "ach", "credit", "other"]).optional(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

app.get("/api/rent-charges/:id/payments", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const existing = await get("SELECT c.id FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ? AND l.org_id = ?", [id, orgId]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const rows = await query("SELECT * FROM payments WHERE charge_id = ? ORDER BY paid_at DESC", [id]);
  return c.json({ payments: rows });
});

app.post("/api/payments", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, PaymentInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;

  const existingCharge = await get<{ amount: number }>(
    "SELECT c.amount FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ? AND l.org_id = ?",
    [d.charge_id, orgId],
  );
  if (!existingCharge) return c.json({ error: "Charge not found" }, 404);

  await run(
    `INSERT INTO payments (charge_id, paid_at, amount, method, reference, notes)
     VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`,
    [d.charge_id, d.paid_at ?? null, d.amount, d.method ?? "cash", d.reference ?? null, d.notes ?? null],
  );

  const sumRow = await get<{ total: number }>("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE charge_id = ?", [d.charge_id]);
  const paid = Number(sumRow?.total ?? 0);
  const status = paid >= existingCharge.amount ? "paid" : paid > 0 ? "partial" : "open";
  await run("UPDATE rent_charges SET amount_paid = ?, status = ? WHERE id = ?", [paid, status, d.charge_id]);
  const updated = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [d.charge_id]);
  return c.json({ charge: updated }, 201);
});

app.delete("/api/payments/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get<{ charge_id: number }>(
    "SELECT p.charge_id FROM payments p JOIN rent_charges c ON c.id = p.charge_id JOIN leases l ON l.id = c.lease_id WHERE p.id = ? AND l.org_id = ?",
    [id, orgId],
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  await run("DELETE FROM payments WHERE id = ?", [id]);
  
  const sumRow = await get<{ total: number }>("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE charge_id = ?", [row.charge_id]);
  const charge = await get<{ amount: number }>("SELECT amount FROM rent_charges WHERE id = ?", [row.charge_id]);
  const paid = Number(sumRow?.total ?? 0);
  const status = !charge ? "open" : paid >= charge.amount ? "paid" : paid > 0 ? "partial" : "open";
  await run("UPDATE rent_charges SET amount_paid = ?, status = ? WHERE id = ?", [paid, status, row.charge_id]);
  return c.json({ ok: true });
});

// ── Vendors ────────────────────────────────────────────────────────

const VendorInput = z.object({
  name: z.string().min(1),
  category: z.enum(["plumber", "electrician", "hvac", "handyman", "cleaning", "landscaping", "general"]).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().optional(),
});

app.get("/api/vendors", async (c) => {
  const orgId = getOrgId(c);
  const rows = await query("SELECT * FROM vendors WHERE org_id = ? ORDER BY name", [orgId]);
  return c.json({ vendors: rows });
});

app.post("/api/vendors", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, VendorInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO vendors (org_id, name, category, phone, email, notes, color) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [orgId, d.name, d.category ?? "general", d.phone ?? null, d.email ?? null, d.notes ?? null, d.color ?? "slate"],
  );
  const row = await get("SELECT * FROM vendors WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ vendor: row }, 201);
});

app.put("/api/vendors/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, VendorInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id, orgId);
  const r = await run(`UPDATE vendors SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM vendors WHERE id = ?", [id]);
  return c.json({ vendor: row });
});

app.delete("/api/vendors/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM vendors WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Work orders ────────────────────────────────────────────────────

const WorkOrderInput = z.object({
  property_id: z.number().int().nullable().optional(),
  unit_id: z.number().int().nullable().optional(),
  tenant_id: z.number().int().nullable().optional(),
  vendor_id: z.number().int().nullable().optional(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  status: z.enum(["open", "assigned", "in_progress", "completed", "cancelled"]).optional(),
  scheduled_at: z.string().optional().nullable(),
  completed_at: z.string().optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const WO_SELECT = `
  SELECT w.*,
    p.name as property_name, p.color as property_color,
    u.name as unit_name,
    t.first_name as tenant_first_name, t.last_name as tenant_last_name,
    v.name as vendor_name, v.color as vendor_color
  FROM work_orders w
  LEFT JOIN properties p ON p.id = w.property_id
  LEFT JOIN units u ON u.id = w.unit_id
  LEFT JOIN tenants t ON t.id = w.tenant_id
  LEFT JOIN vendors v ON v.id = w.vendor_id
`;

app.get("/api/work-orders", async (c) => {
  const orgId = getOrgId(c);
  const status = c.req.query("status");
  const propertyId = intParam(c.req.query("property_id"));
  const where: string[] = ["w.org_id = ?"];
  const params: unknown[] = [orgId];
  if (status) { where.push("w.status = ?"); params.push(status); }
  if (propertyId) { where.push("w.property_id = ?"); params.push(propertyId); }
  const sql = `${WO_SELECT} WHERE ${where.join(" AND ")} ORDER BY
    CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    w.created_at DESC`;
  const rows = await query(sql, params).catch(() => []);
  return c.json({ work_orders: rows });
});

app.post("/api/work-orders", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, WorkOrderInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO work_orders (org_id, property_id, unit_id, tenant_id, vendor_id, title, description, priority, status, scheduled_at, completed_at, cost, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId, d.property_id ?? null, d.unit_id ?? null, d.tenant_id ?? null, d.vendor_id ?? null,
      d.title, d.description ?? null,
      d.priority ?? "normal", d.status ?? "open",
      d.scheduled_at ?? null, d.completed_at ?? null,
      d.cost ?? null, d.notes ?? null,
    ],
  );
  const row = await get(`${WO_SELECT} WHERE w.id = ?`, [result.lastInsertRowid]);
  return c.json({ work_order: row }, 201);
});

app.put("/api/work-orders/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, WorkOrderInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id, orgId);
  const r = await run(`UPDATE work_orders SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${WO_SELECT} WHERE w.id = ?`, [id]);
  return c.json({ work_order: row });
});

app.delete("/api/work-orders/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM work_orders WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Applications ───────────────────────────────────────────────────

const ApplicationInput = z.object({
  unit_id: z.number().int().nullable().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  monthly_income: z.number().optional().nullable(),
  employer: z.string().optional().nullable(),
  desired_move_in: z.string().optional().nullable(),
  status: z.enum(["new", "screening", "approved", "declined", "withdrawn"]).optional(),
  notes: z.string().optional().nullable(),
});

app.get("/api/applications", async (c) => {
  const orgId = getOrgId(c);
  const rows = await query(
    `SELECT a.*, u.name as unit_name, p.name as property_name
     FROM applications a
     LEFT JOIN units u ON u.id = a.unit_id
     LEFT JOIN properties p ON p.id = u.property_id
     WHERE a.org_id = ?
     ORDER BY a.created_at DESC`,
    [orgId],
  ).catch(() => []);
  return c.json({ applications: rows });
});

app.post("/api/applications", async (c) => {
  const orgId = getOrgId(c);
  const parsed = await parseJson(c, ApplicationInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO applications (org_id, unit_id, first_name, last_name, email, phone, monthly_income, employer, desired_move_in, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId, d.unit_id ?? null, d.first_name, d.last_name,
      d.email ?? null, d.phone ?? null, d.monthly_income ?? null, d.employer ?? null,
      d.desired_move_in ?? null, d.status ?? "new", d.notes ?? null,
    ],
  );
  const row = await get(
    `SELECT a.*, u.name as unit_name, p.name as property_name
     FROM applications a LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN properties p ON p.id = u.property_id
     WHERE a.id = ?`,
    [result.lastInsertRowid],
  );
  return c.json({ application: row }, 201);
});

app.put("/api/applications/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, ApplicationInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id, orgId);
  const r = await run(`UPDATE applications SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(
    `SELECT a.*, u.name as unit_name, p.name as property_name
     FROM applications a LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN properties p ON p.id = u.property_id
     WHERE a.id = ?`,
    [id],
  );
  return c.json({ application: row });
});

app.delete("/api/applications/:id", async (c) => {
  const orgId = getOrgId(c);
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM applications WHERE id = ? AND org_id = ?", [id, orgId]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Dashboard summary ──────────────────────────────────────────────

app.get("/api/dashboard/summary", async (c) => {
  const orgId = getOrgId(c);
  const today = new Date().toISOString().slice(0, 10);
  const periodNow = today.slice(0, 7);

  const safeGet = <T,>(sql: string, params: unknown[] = [], fallback: T) =>
    get<T>(sql, params).catch(() => fallback as T | undefined).then((v) => v ?? fallback);
  const safeQuery = <T,>(sql: string, params: unknown[] = []): Promise<T[]> =>
    query<T>(sql, params).catch(() => [] as T[]);

  const [
    propertyCount,
    unitCount,
    occupiedCount,
    vacantCount,
    activeLeases,
    upcomingMoveOuts,
    monthOutstanding,
    monthCollected,
    overdueRow,
    openWorkOrders,
    urgentWorkOrders,
    recentWorkOrders,
    upcomingExpirations,
  ] = await Promise.all([
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM properties WHERE org_id = ?", [orgId], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM units u JOIN properties p ON p.id = u.property_id WHERE p.org_id = ?", [orgId], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM units u JOIN properties p ON p.id = u.property_id WHERE p.org_id = ? AND u.status = 'occupied'", [orgId], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM units u JOIN properties p ON p.id = u.property_id WHERE p.org_id = ? AND u.status = 'vacant'", [orgId], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM leases WHERE org_id = ? AND status = 'active'", [orgId], { n: 0 }),
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM leases WHERE org_id = ? AND status = 'active' AND end_date <= date('now', '+30 days')",
      [orgId], { n: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(c.amount - c.amount_paid), 0) as total 
       FROM rent_charges c JOIN leases l ON l.id = c.lease_id 
       WHERE l.org_id = ? AND c.period = ? AND c.status != 'waived'`,
      [orgId, periodNow], { total: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(c.amount_paid), 0) as total 
       FROM rent_charges c JOIN leases l ON l.id = c.lease_id 
       WHERE l.org_id = ? AND c.period = ?`,
      [orgId, periodNow], { total: 0 },
    ),
    safeGet<{ total: number; n: number }>(
      `SELECT COALESCE(SUM(c.amount - c.amount_paid), 0) as total, COUNT(*) as n 
       FROM rent_charges c JOIN leases l ON l.id = c.lease_id 
       WHERE l.org_id = ? AND c.due_date < date('now') AND c.amount_paid < c.amount AND c.status != 'waived'`,
      [orgId], { total: 0, n: 0 },
    ),
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM work_orders WHERE org_id = ? AND status NOT IN ('completed', 'cancelled')",
      [orgId], { n: 0 },
    ),
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM work_orders WHERE org_id = ? AND priority = 'urgent' AND status NOT IN ('completed', 'cancelled')",
      [orgId], { n: 0 },
    ),
    safeQuery<{ id: number; title: string; priority: string; status: string; property_name: string | null; unit_name: string | null; created_at: string }>(
      `SELECT w.id, w.title, w.priority, w.status, p.name as property_name, u.name as unit_name, w.created_at
       FROM work_orders w
       LEFT JOIN properties p ON p.id = w.property_id
       LEFT JOIN units u ON u.id = w.unit_id
       WHERE w.org_id = ? AND w.status NOT IN ('completed', 'cancelled')
       ORDER BY CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, w.created_at DESC
       LIMIT 6`,
      [orgId],
    ),
    safeQuery<{ id: number; end_date: string; tenant_first_name: string | null; tenant_last_name: string | null; unit_name: string | null; property_name: string | null }>(
      `SELECT l.id, l.end_date,
         t.first_name as tenant_first_name, t.last_name as tenant_last_name,
         u.name as unit_name, p.name as property_name
       FROM leases l
       LEFT JOIN tenants t ON t.id = l.primary_tenant_id
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = u.property_id
       WHERE l.org_id = ? AND l.status = 'active' AND l.end_date <= date('now', '+60 days')
       ORDER BY l.end_date ASC LIMIT 6`,
      [orgId],
    ),
  ]);

  return c.json({
    period: periodNow,
    properties: propertyCount.n,
    units: unitCount.n,
    occupied: occupiedCount.n,
    vacant: vacantCount.n,
    occupancy_rate: unitCount.n ? Math.round((occupiedCount.n / unitCount.n) * 100) : 0,
    active_leases: activeLeases.n,
    upcoming_move_outs: upcomingMoveOuts.n,
    month_outstanding: monthOutstanding.total,
    month_collected: monthCollected.total,
    overdue_total: overdueRow.total,
    overdue_count: overdueRow.n,
    open_work_orders: openWorkOrders.n,
    urgent_work_orders: urgentWorkOrders.n,
    recent_work_orders: recentWorkOrders,
    upcoming_expirations: upcomingExpirations,
  });
});

// ── Admin Only Payment Gateway Management ──────────────────────────

app.get("/api/admin/gateways", async (c) => {
  const rows = await query<{ id: string; name: string; type: string; is_enabled: number; config_json: string; updated_at: string }>(
    "SELECT * FROM payment_gateways ORDER BY name",
  ).catch(() => []);
  
  const registered = paymentRegistry.list();
  const gateways = registered.map((mod) => {
    const dbRow = rows.find((r) => r.id === mod.id);
    let parsedConfig: Record<string, string> = {};
    if (dbRow?.config_json) {
      try { parsedConfig = JSON.parse(dbRow.config_json); } catch { /* empty */ }
    }
    return {
      id: mod.id,
      name: mod.name,
      type: mod.type,
      description: mod.description,
      supported_methods: mod.supportedMethods,
      default_config_keys: mod.defaultConfigKeys,
      is_enabled: dbRow ? Boolean(dbRow.is_enabled) : true,
      config: parsedConfig,
      updated_at: dbRow?.updated_at || new Date().toISOString(),
    };
  });

  return c.json({ gateways });
});

app.put("/api/admin/gateways/:id", async (c) => {
  const gatewayId = c.req.param("id");
  const mod = paymentRegistry.get(gatewayId);
  if (!mod) return c.json({ error: "Unknown gateway module" }, 404);

  const GatewayPatch = z.object({
    is_enabled: z.boolean().optional(),
    config: z.record(z.string()).optional(),
  });

  const parsed = await parseJson(c, GatewayPatch);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const existing = await get<{ config_json: string; is_enabled: number }>(
    "SELECT config_json, is_enabled FROM payment_gateways WHERE id = ?",
    [gatewayId],
  );

  let currentConfig: Record<string, string> = {};
  if (existing?.config_json) {
    try { currentConfig = JSON.parse(existing.config_json); } catch { /* empty */ }
  }

  const updatedConfig = { ...currentConfig, ...(parsed.data.config || {}) };
  const isEnabled = parsed.data.is_enabled !== undefined ? (parsed.data.is_enabled ? 1 : 0) : (existing?.is_enabled ?? 1);

  await run(
    `INSERT INTO payment_gateways (id, name, type, is_enabled, config_json, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET is_enabled = excluded.is_enabled, config_json = excluded.config_json, updated_at = datetime('now')`,
    [gatewayId, mod.name, mod.type, isEnabled, JSON.stringify(updatedConfig)],
  );

  return c.json({
    gateway: {
      id: mod.id,
      name: mod.name,
      type: mod.type,
      description: mod.description,
      supported_methods: mod.supportedMethods,
      is_enabled: Boolean(isEnabled),
      config: updatedConfig,
    },
  });
});

app.get("/api/admin/org-assignments", async (c) => {
  const rows = await query(
    `SELECT o.id as org_id, o.name as org_name,
            opa.gateway_id, pg.name as gateway_name, pg.type as gateway_type,
            opa.assigned_at
     FROM organizations o
     LEFT JOIN org_payment_assignments opa ON opa.org_id = o.id
     LEFT JOIN payment_gateways pg ON pg.id = opa.gateway_id
     ORDER BY o.name`,
  ).catch(() => []);
  return c.json({ assignments: rows });
});

app.put("/api/admin/org-assignments/:orgId", async (c) => {
  const orgId = intParam(c.req.param("orgId"));
  if (!orgId) return c.json({ error: "Invalid orgId" }, 400);

  const Body = z.object({ gateway_id: z.string().min(1) });
  const parsed = await parseJson(c, Body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const mod = paymentRegistry.get(parsed.data.gateway_id);
  if (!mod) return c.json({ error: "Invalid gateway_id" }, 400);

  await run(
    `INSERT INTO org_payment_assignments (org_id, gateway_id, assigned_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET gateway_id = excluded.gateway_id, assigned_at = datetime('now')`,
    [orgId, parsed.data.gateway_id],
  );

  return c.json({ ok: true, org_id: orgId, gateway_id: parsed.data.gateway_id });
});

app.get("/api/admin/transactions", async (c) => {
  const rows = await query(
    `SELECT ft.*, o.name as org_name, pg.name as gateway_name,
            t.first_name || ' ' || t.last_name as tenant_name,
            u.name as unit_name
     FROM financial_transactions ft
     LEFT JOIN organizations o ON o.id = ft.org_id
     LEFT JOIN payment_gateways pg ON pg.id = ft.gateway_id
     LEFT JOIN recurring_subscriptions sub ON sub.id = ft.subscription_id
     LEFT JOIN tenants t ON t.id = sub.tenant_id
     LEFT JOIN leases l ON l.id = sub.lease_id
     LEFT JOIN units u ON u.id = l.unit_id
     ORDER BY ft.created_at DESC LIMIT 500`,
  ).catch(() => []);
  return c.json({ transactions: rows });
});

// ── Organization Payment & Recurring Billing Endpoints ───────────

app.get("/api/payments/config", async (c) => {
  const orgId = getOrgId(c);
  const row = await get<{ gateway_id: string; gateway_name: string; gateway_type: string; is_enabled: number; config_json: string }>(
    `SELECT opa.gateway_id, pg.name as gateway_name, pg.type as gateway_type, pg.is_enabled, pg.config_json
     FROM org_payment_assignments opa
     JOIN payment_gateways pg ON pg.id = opa.gateway_id
     WHERE opa.org_id = ?`,
    [orgId],
  );

  if (!row || !row.is_enabled) {
    return c.json({
      configured: false,
      message: "No active payment gateway configured by Admin for this organization.",
    });
  }

  const mod = paymentRegistry.get(row.gateway_id);
  return c.json({
    configured: true,
    gateway: {
      id: row.gateway_id,
      name: row.gateway_name,
      type: row.gateway_type,
      supported_methods: mod?.supportedMethods || ["card"],
    },
  });
});

app.get("/api/payments/subscriptions", async (c) => {
  const orgId = getOrgId(c);
  const rows = await query(
    `SELECT s.*, u.name as unit_name, p.name as property_name,
            t.first_name as tenant_first_name, t.last_name as tenant_last_name,
            pg.name as gateway_name
     FROM recurring_subscriptions s
     LEFT JOIN leases l ON l.id = s.lease_id
     LEFT JOIN units u ON u.id = l.unit_id
     LEFT JOIN properties p ON p.id = u.property_id
     LEFT JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN payment_gateways pg ON pg.id = s.gateway_id
     WHERE s.org_id = ?
     ORDER BY s.created_at DESC`,
    [orgId],
  ).catch(() => []);
  return c.json({ subscriptions: rows });
});

app.post("/api/payments/subscriptions", async (c) => {
  const orgId = getOrgId(c);
  const Schema = z.object({
    lease_id: z.number().int(),
    payment_method: z.enum(["card", "direct_debit"]).optional(),
  });
  const parsed = await parseJson(c, Schema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const assignment = await get<{ gateway_id: string; config_json: string }>(
    `SELECT opa.gateway_id, pg.config_json
     FROM org_payment_assignments opa
     JOIN payment_gateways pg ON pg.id = opa.gateway_id
     WHERE opa.org_id = ? AND pg.is_enabled = 1`,
    [orgId],
  );
  if (!assignment) return c.json({ error: "No active payment gateway assigned by Admin to this organization." }, 400);

  const mod = paymentRegistry.get(assignment.gateway_id);
  if (!mod) return c.json({ error: "Payment gateway module unavailable" }, 500);

  const lease = await get<{ id: number; primary_tenant_id: number; monthly_rent: number; tenant_name: string; tenant_email: string }>(
    `SELECT l.id, l.primary_tenant_id, l.monthly_rent,
            t.first_name || ' ' || t.last_name as tenant_name, t.email as tenant_email
     FROM leases l
     LEFT JOIN tenants t ON t.id = l.primary_tenant_id
     WHERE l.id = ? AND l.org_id = ?`,
    [parsed.data.lease_id, orgId],
  );
  if (!lease) return c.json({ error: "Lease not found" }, 404);

  let gatewayConfig: Record<string, string> = {};
  try { gatewayConfig = JSON.parse(assignment.config_json || "{}"); } catch { /* empty */ }

  const subResult = await mod.createRecurringSubscription({
    subscriptionId: `SUB-${lease.id}`,
    amount: lease.monthly_rent,
    currency: "LKR",
    customer: { name: lease.tenant_name || "Tenant", email: lease.tenant_email || "tenant@example.com" },
    period: "MONTHLY",
    paymentMethod: parsed.data.payment_method || "card",
    config: gatewayConfig,
  });

  const res = await run(
    `INSERT INTO recurring_subscriptions (org_id, lease_id, tenant_id, gateway_id, gateway_subscription_id, gateway_token, payment_method, amount, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      orgId, lease.id, lease.primary_tenant_id ?? null,
      assignment.gateway_id, subResult.gatewaySubscriptionId, subResult.token,
      parsed.data.payment_method || "card", lease.monthly_rent,
    ],
  );

  const subRow = await get("SELECT * FROM recurring_subscriptions WHERE id = ?", [res.lastInsertRowid]);
  return c.json({ subscription: subRow, redirectUrl: subResult.redirectUrl }, 201);
});

app.post("/api/payments/process-recurring", async (c) => {
  const orgId = getOrgId(c);
  const Schema = z.object({ charge_id: z.number().int() });
  const parsed = await parseJson(c, Schema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const charge = await get<{ id: number; lease_id: number; amount: number; amount_paid: number; period: string }>(
    `SELECT c.id, c.lease_id, c.amount, c.amount_paid, c.period
     FROM rent_charges c
     JOIN leases l ON l.id = c.lease_id
     WHERE c.id = ? AND l.org_id = ?`,
    [parsed.data.charge_id, orgId],
  );
  if (!charge) return c.json({ error: "Rent charge not found" }, 404);

  const dueAmount = charge.amount - charge.amount_paid;
  if (dueAmount <= 0) return c.json({ error: "Charge is already fully paid" }, 400);

  const sub = await get<{ id: number; gateway_id: string; gateway_subscription_id: string; gateway_token: string }>(
    `SELECT id, gateway_id, gateway_subscription_id, gateway_token
     FROM recurring_subscriptions
     WHERE lease_id = ? AND org_id = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [charge.lease_id, orgId],
  );

  if (!sub) return c.json({ error: "No active recurring mandate/subscription found for this lease." }, 400);

  const gatewayRow = await get<{ config_json: string }>(
    "SELECT config_json FROM payment_gateways WHERE id = ?",
    [sub.gateway_id],
  );
  let gatewayConfig: Record<string, string> = {};
  if (gatewayRow?.config_json) {
    try { gatewayConfig = JSON.parse(gatewayRow.config_json); } catch { /* empty */ }
  }

  const mod = paymentRegistry.get(sub.gateway_id);
  if (!mod) return c.json({ error: "Gateway module unavailable" }, 500);

  const chargeRes = await mod.chargeRecurringPayment({
    subscriptionId: sub.gateway_subscription_id,
    amount: dueAmount,
    currency: "LKR",
    token: sub.gateway_token,
    config: gatewayConfig,
  });

  // Log transaction
  await run(
    `INSERT INTO financial_transactions (org_id, subscription_id, charge_id, gateway_id, transaction_id, amount, status, response_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId, sub.id, charge.id, sub.gateway_id,
      chargeRes.transactionId, dueAmount,
      chargeRes.status, JSON.stringify(chargeRes.rawResponse || {}),
    ],
  );

  if (chargeRes.success) {
    // Record payment against rent charge
    await run(
      `INSERT INTO payments (charge_id, paid_at, amount, method, reference, notes)
       VALUES (?, datetime('now'), ?, 'credit', ?, ?)`,
      [charge.id, dueAmount, chargeRes.transactionId, `Auto-debit via ${mod.name}`],
    );

    const sumRow = await get<{ total: number }>("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE charge_id = ?", [charge.id]);
    const paid = Number(sumRow?.total ?? 0);
    const status = paid >= charge.amount ? "paid" : "partial";
    await run("UPDATE rent_charges SET amount_paid = ?, status = ? WHERE id = ?", [paid, status, charge.id]);

    const updatedCharge = await get("SELECT * FROM rent_charges WHERE id = ?", [charge.id]);
    return c.json({ success: true, charge: updatedCharge, transaction_id: chargeRes.transactionId });
  }

  return c.json({ success: false, error: chargeRes.message || "Recurring charge failed" }, 400);
});

// ── Health ─────────────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
