"""
Supabase -> Neon migration.
Uses SQLAlchemy models (the source of truth in this repo) to recreate the
schema on Neon, then copies every public table row-for-row.

Requires two env vars:
  SOURCE_URL   - the current Supabase pooler URL (read from .env.prod by default)
  NEON_URL     - the new Neon connection string (pass via CLI or env)

Safe to re-run: on the target it drops all public tables first, then recreates
schema and re-copies data. So a partial failure is recoverable.
"""
from __future__ import annotations
import os, sys, time, argparse
from pathlib import Path

# Make backend imports work when run as a script.
THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from dotenv import load_dotenv
load_dotenv(THIS_DIR.parent / '.env.prod')

from sqlalchemy import create_engine, MetaData, text
from sqlalchemy.engine import Engine


BATCH_SIZE = 2000


def _redact(url: str) -> str:
    if '@' not in url:
        return url[:30] + '...'
    creds, host = url.split('@', 1)
    if ':' in creds.split('//', 1)[1]:
        scheme, rest = creds.split('//', 1)
        user = rest.split(':', 1)[0]
        return f"{scheme}//{user}:****@{host}"
    return url


def _connect(label: str, url: str) -> Engine:
    print(f"  connecting to {label}: {_redact(url)[:90]}")
    eng = create_engine(url, connect_args={'connect_timeout': 15, 'sslmode': 'require'}, pool_pre_ping=True)
    with eng.connect() as c:
        c.execute(text('select 1'))
    print(f"  {label} OK")
    return eng


def _drop_target_public(target: Engine):
    """Wipe target's public schema so re-runs are deterministic."""
    print("  wiping target public schema...")
    with target.begin() as conn:
        conn.execute(text("drop schema if exists public cascade"))
        conn.execute(text("create schema public"))
        conn.execute(text("grant all on schema public to public"))


def _reflect_source_schema(source: Engine) -> MetaData:
    """Pull the live schema from source via SQLAlchemy reflection. This sees
    every table actually present in Supabase, not just the ones our Python
    models register (routers define their own models that don't all flow
    through database.Base in a script run)."""
    # Restrict to the 'public' schema. Without this, reflection also pulls
    # Supabase's internal 'auth', 'storage', 'realtime', 'extensions' etc.
    # schemas — those are platform tables we don't own and can't recreate on
    # Neon (e.g. auth.users uses STORED generated columns referencing other
    # auth-private functions).
    print("  reflecting source 'public' schema...")
    meta = MetaData()
    meta.reflect(bind=source, schema='public')

    # Reflection follows FK references into other schemas (Supabase's auth.users
    # is referenced by public tables via user_id columns). We don't want those
    # — Neon won't have Supabase Auth. Drop every reflected table NOT in
    # public, then strip FK constraints that pointed at them.
    non_public = [k for k, t in meta.tables.items() if (t.schema or 'public') != 'public']
    for k in non_public:
        meta.remove(meta.tables[k])

    # Also strip FK *constraints* that still point at non-public referent tables.
    from sqlalchemy import ForeignKeyConstraint
    for tbl in list(meta.tables.values()):
        for c in list(tbl.constraints):
            if isinstance(c, ForeignKeyConstraint):
                bad = False
                for el in c.elements:
                    try:
                        ref_schema = el.column.table.schema
                    except Exception:
                        ref_schema = None
                    if ref_schema and ref_schema != 'public':
                        bad = True
                        break
                if bad:
                    tbl.constraints.discard(c)
                    # Also remove the matching ForeignKey objects on the columns
                    for fk in list(c.elements):
                        try:
                            fk.parent.foreign_keys.discard(fk)
                        except Exception:
                            pass

    print(f"  reflected {len(meta.tables)} public tables (dropped {len(non_public)} non-public)")
    return meta


def _recreate_schema(meta: MetaData, target: Engine):
    """Recreate the reflected schema on target."""
    print(f"  creating {len(meta.sorted_tables)} tables on target...")
    meta.create_all(target)
    print("  schema OK")


def _copy_table(src: Engine, tgt: Engine, table_name: str) -> tuple[int, float]:
    """Bulk copy via psycopg2 COPY ... TO STDOUT / FROM STDIN binary streams.
    Sustained throughput is 30-100k rows/sec on transcontinental links — vs.
    SQLAlchemy executemany at ~25 rows/sec because it round-trips per row.
    """
    import io
    t0 = time.time()
    # Raw psycopg2 connections from the SQLAlchemy engines
    src_raw = src.raw_connection()
    tgt_raw = tgt.raw_connection()
    try:
        src_cur = src_raw.cursor()
        tgt_cur = tgt_raw.cursor()

        src_cur.execute(f'select count(*) from "{table_name}"')
        n_total = src_cur.fetchone()[0] or 0
        if n_total == 0:
            return 0, 0.0

        # Get column list from source so SELECT and INSERT line up exactly.
        src_cur.execute(
            "select column_name from information_schema.columns "
            "where table_schema='public' and table_name=%s order by ordinal_position",
            (table_name,),
        )
        cols = [r[0] for r in src_cur.fetchall()]
        col_csv = ','.join(f'"{c}"' for c in cols)

        # Pipe-through: src COPY TO STDOUT (binary) -> in-memory -> tgt COPY FROM STDIN
        # Binary is ~30% smaller than text on the wire AND avoids escaping
        # cost on both ends. Memory peak is the full table size — fine here
        # (comp_medians is the biggest at ~80MB worst case).
        buf = io.BytesIO()
        src_cur.copy_expert(
            f'copy (select {col_csv} from "{table_name}") to stdout with (format binary)',
            buf,
        )
        buf.seek(0)
        tgt_cur.copy_expert(
            f'copy "{table_name}" ({col_csv}) from stdin with (format binary)',
            buf,
        )
        tgt_raw.commit()
        return n_total, time.time() - t0
    finally:
        try: src_raw.close()
        except Exception: pass
        try: tgt_raw.close()
        except Exception: pass


def _reset_sequences(tgt: Engine, table_name: str):
    """After bulk copy, restart any owned sequence so nextval > max(id)."""
    with tgt.begin() as conn:
        seqs = conn.execute(text("""
            select s.relname, a.attname
            from pg_class s
            join pg_depend d on d.objid = s.oid and d.deptype = 'a'
            join pg_class t on t.oid = d.refobjid
            join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
            where s.relkind = 'S' and t.relname = :t and t.relnamespace = 'public'::regnamespace
        """), {'t': table_name}).fetchall()
        for seq_name, col_name in seqs:
            max_row = conn.execute(text(f'select coalesce(max("{col_name}"),0) from "{table_name}"')).scalar()
            conn.execute(text(f'select setval(\'public."{seq_name}"\', :v, true)'),
                         {'v': max(int(max_row or 0), 1)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=os.environ.get('SOURCE_URL') or os.environ.get('DATABASE_URL'))
    ap.add_argument('--target', default=os.environ.get('NEON_URL'))
    ap.add_argument('--skip-tables', default='', help='comma-separated table names to skip')
    args = ap.parse_args()
    if not args.source: raise SystemExit('missing --source / SOURCE_URL / DATABASE_URL')
    if not args.target: raise SystemExit('missing --target / NEON_URL')

    skip = {s.strip() for s in args.skip_tables.split(',') if s.strip()}

    print("=== migrate Supabase -> Neon ===")
    src = _connect('SOURCE', args.source)
    tgt = _connect('TARGET', args.target)

    meta = _reflect_source_schema(src)
    _drop_target_public(tgt)
    _recreate_schema(meta, tgt)

    # sorted_tables = FK-safe insert order.
    grand_total = 0
    grand_t0 = time.time()
    for table in meta.sorted_tables:
        if table.name in skip:
            print(f"  skip {table.name}")
            continue
        try:
            n, dt = _copy_table(src, tgt, table.name)
            grand_total += n
            print(f"  {table.name}: {n:,} rows  ({dt:.1f}s)")
            if n > 0:
                _reset_sequences(tgt, table.name)
        except Exception as e:
            print(f"  ERR {table.name}: {type(e).__name__}: {str(e)[:200]}")

    print(f"\n=== DONE — {grand_total:,} rows in {time.time()-grand_t0:.1f}s ===")


if __name__ == '__main__':
    main()
