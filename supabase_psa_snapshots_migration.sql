-- PSA Pop snapshots — weekly rollup for delta reporting.
-- Run in Supabase SQL editor (or any psql) once; idempotent.

CREATE TABLE IF NOT EXISTS psa_pop_snapshots (
    id SERIAL PRIMARY KEY,
    driver_name TEXT NOT NULL,
    parallel TEXT,
    grade TEXT,
    pop_count INTEGER NOT NULL,
    snapshot_date TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psa_snap_driver ON psa_pop_snapshots(driver_name, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_psa_snap_grade ON psa_pop_snapshots(grade, snapshot_date);
CREATE INDEX IF NOT EXISTS ix_psa_snap_driver_grade_date
    ON psa_pop_snapshots(driver_name, grade, snapshot_date);
