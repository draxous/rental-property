PRAGMA foreign_keys = OFF;

-- ── Drop old tables if upgrading ─────────────────────────────────
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS lease_tenants;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS rent_charges;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS leases;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS organizations;

-- ── Organizations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default organizations
INSERT INTO organizations (id, name, slug) VALUES (1, 'Apex Property Group', 'apex-property-group');
INSERT INTO organizations (id, name, slug) VALUES (2, 'Beacon Real Estate', 'beacon-real-estate');

-- ── Settings (key/value per organization) ─────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, key)
);

INSERT INTO settings (org_id, key, value) VALUES (1, 'default_rent_due_day', '1');
INSERT INTO settings (org_id, key, value) VALUES (1, 'late_fee_amount', '50');
INSERT INTO settings (org_id, key, value) VALUES (1, 'late_fee_grace_days', '5');
INSERT INTO settings (org_id, key, value) VALUES (1, 'currency', 'USD');

INSERT INTO settings (org_id, key, value) VALUES (2, 'default_rent_due_day', '1');
INSERT INTO settings (org_id, key, value) VALUES (2, 'late_fee_amount', '75');
INSERT INTO settings (org_id, key, value) VALUES (2, 'late_fee_grace_days', '3');
INSERT INTO settings (org_id, key, value) VALUES (2, 'currency', 'USD');

-- ── Properties (buildings) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'single_family',
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  year_built INTEGER,
  notes TEXT,
  color TEXT NOT NULL DEFAULT 'sky',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_properties_org ON properties(org_id);

-- ── Units (rentable spaces inside a property) ────────────────────
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bedrooms REAL NOT NULL DEFAULT 1,
  bathrooms REAL NOT NULL DEFAULT 1,
  sqft INTEGER,
  market_rent REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'vacant',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_units_property ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);

-- ── Tenants ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  date_of_birth TEXT,
  emergency_contact TEXT,
  employer TEXT,
  monthly_income REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_org ON tenants(org_id);
CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(org_id, last_name, first_name);

-- ── Leases ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  primary_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  monthly_rent REAL NOT NULL DEFAULT 0,
  deposit REAL NOT NULL DEFAULT 0,
  rent_due_day INTEGER NOT NULL DEFAULT 1,
  late_fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leases_org ON leases(org_id);
CREATE INDEX IF NOT EXISTS idx_leases_unit ON leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases(primary_tenant_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);

CREATE TABLE IF NOT EXISTS lease_tenants (
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (lease_id, tenant_id)
);

-- ── Rent charges (one per period per lease) ──────────────────────
CREATE TABLE IF NOT EXISTS rent_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charges_lease_period ON rent_charges(lease_id, period);
CREATE INDEX IF NOT EXISTS idx_charges_due ON rent_charges(due_date);
CREATE INDEX IF NOT EXISTS idx_charges_status ON rent_charges(status);

-- ── Payments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id INTEGER NOT NULL REFERENCES rent_charges(id) ON DELETE CASCADE,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_charge ON payments(charge_id);

-- ── Vendors ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  phone TEXT,
  email TEXT,
  notes TEXT,
  color TEXT NOT NULL DEFAULT 'slate',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id);

-- ── Work orders ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  scheduled_at TEXT,
  completed_at TEXT,
  cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wo_org ON work_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_property ON work_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_wo_unit ON work_orders(unit_id);

-- ── Applications ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1 REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  monthly_income REAL,
  employer TEXT,
  desired_move_in TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_applications_org ON applications(org_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- ── Seed data for Organization 1 (Apex Property Group) ───────────
INSERT INTO properties (id, org_id, name, type, address, city, state, zip, color)
VALUES (1, 1, 'Oakwood Estate', 'single_family', '210 Oakwood Ln', 'Austin', 'TX', '78704', 'emerald');

INSERT INTO properties (id, org_id, name, type, address, city, state, zip, color)
VALUES (2, 1, 'Honeybee Hideaway', 'single_family', '88 Bramble Ct', 'Austin', 'TX', '78704', 'amber');

INSERT INTO properties (id, org_id, name, type, address, city, state, zip, color)
VALUES (3, 1, '308 Mission Apartments', 'multi_family', '308 Mission St', 'Austin', 'TX', '78702', 'sky');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (1, 1, 'Main house', 3, 2, 1450, 2300, 'occupied');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (2, 2, 'Main house', 2, 1, 980, 1700, 'occupied');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (3, 3, 'Unit 1', 1, 1, 620, 1450, 'occupied');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (4, 3, 'Unit 2', 1, 1, 620, 1450, 'vacant');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (5, 3, 'Unit 3', 2, 1, 850, 1850, 'occupied');

INSERT INTO vendors (id, org_id, name, category, phone, color)
VALUES (1, 1, 'Emerald Pool Service', 'general', '512-555-0144', 'emerald');

INSERT INTO vendors (id, org_id, name, category, phone, color)
VALUES (2, 1, 'Hill Country Plumbing', 'plumber', '512-555-0188', 'sky');

INSERT INTO vendors (id, org_id, name, category, phone, color)
VALUES (3, 1, 'Bright Spark Electric', 'electrician', '512-555-0102', 'amber');

-- ── Seed data for Organization 2 (Beacon Real Estate) ───────────
INSERT INTO properties (id, org_id, name, type, address, city, state, zip, color)
VALUES (10, 2, 'Sunset Tower Plaza', 'commercial', '1200 S Congress Ave', 'Austin', 'TX', '78704', 'violet');

INSERT INTO properties (id, org_id, name, type, address, city, state, zip, color)
VALUES (11, 2, 'Lakeside Lofts', 'condo', '500 W 2nd St', 'Austin', 'TX', '78701', 'indigo');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (101, 10, 'Suite 100', 0, 2, 2200, 4500, 'occupied');

INSERT INTO units (id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
VALUES (102, 11, 'Penthouse 4B', 2, 2.5, 1600, 3200, 'occupied');

INSERT INTO vendors (id, org_id, name, category, phone, color)
VALUES (10, 2, 'Capitol HVAC Solutions', 'hvac', '512-555-0990', 'indigo');

INSERT INTO vendors (id, org_id, name, category, phone, color)
VALUES (11, 2, 'Austin Clean Tech Services', 'cleaning', '512-555-0771', 'rose');

PRAGMA foreign_keys = ON;
