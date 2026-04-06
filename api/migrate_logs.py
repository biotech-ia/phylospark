"""One-time migration: add cancelled enum + experiment_logs table."""
from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TYPE experimentstatus ADD VALUE IF NOT EXISTS 'cancelled'"))
        conn.commit()
        print("Added cancelled enum value")
    except Exception as e:
        print(f"Enum note: {e}")

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS experiment_logs (
            id SERIAL PRIMARY KEY,
            experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
            level VARCHAR(20) NOT NULL DEFAULT 'info',
            step VARCHAR(100),
            message TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_experiment_logs_experiment_id ON experiment_logs(experiment_id)"))
    conn.commit()
    print("Created experiment_logs table + index")
