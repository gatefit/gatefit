-- GATEFIT-H30 status checks. One row per probe run per service; detail is a short code
-- ("timeout", "http 503", "bad body", "no version") or the version that was checked.
-- Nothing else from a probe response is stored, and no client data at all.
CREATE TABLE checks (
  ts INTEGER NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('site', 'npm', 'telemetry', 'action', 'polar')),
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 64),
  PRIMARY KEY (service, ts)
);

-- Nightly rollup of finished UTC days, kept for 90 days.
CREATE TABLE check_days (
  day TEXT NOT NULL,
  service TEXT NOT NULL,
  total INTEGER NOT NULL,
  up INTEGER NOT NULL,
  slow INTEGER NOT NULL,
  PRIMARY KEY (day, service)
);
