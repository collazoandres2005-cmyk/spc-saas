-- ============================================================
-- Esquema de base de datos — SPC SaaS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Empresas suscritas
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  subscription_status VARCHAR(30) DEFAULT 'inactive',
  subscription_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usuarios por empresa
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'analyst',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Procesos definidos por empresa
CREATE TABLE IF NOT EXISTS processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  unit VARCHAR(50),
  usl NUMERIC,
  lsl NUMERIC,
  nominal NUMERIC,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mediciones individuales por proceso
CREATE TABLE IF NOT EXISTS measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID REFERENCES processes(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  value NUMERIC NOT NULL,
  subgroup_id INTEGER,
  phase SMALLINT NOT NULL DEFAULT 1,  -- 1 = Fase 1 (histórico), 2 = Fase 2 (monitoreo)
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID REFERENCES users(id)
);

-- Cartas de control guardadas
CREATE TABLE IF NOT EXISTS control_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID REFERENCES processes(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  chart_type VARCHAR(20) NOT NULL,
  cl NUMERIC,
  ucl NUMERIC,
  lcl NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_processes_company ON processes(company_id);
CREATE INDEX IF NOT EXISTS idx_measurements_process ON measurements(process_id);
CREATE INDEX IF NOT EXISTS idx_measurements_company ON measurements(company_id);
CREATE INDEX IF NOT EXISTS idx_measurements_recorded ON measurements(recorded_at);
CREATE INDEX IF NOT EXISTS idx_measurements_phase ON measurements(process_id, phase);
