# Gatefit adapter environment ({{TEMPLATE}} template). Set these in CI; keep values out of git.
# A disposable Postgres: the CI service container or your local dev database.
DATABASE_URL=postgres://localhost:5432/gatefit_ci
# Only for a database host that is not local and is disposable.
# GATEFIT_ALLOW_REMOTE_DB=1
