-- GATEFIT-H25 collector schema. Aggregates only: counts has no install column, and
-- installs holds a 16-hex SHA-256 prefix per day for distinct-install counts.
-- '' instead of NULL so the primary key deduplicates.
CREATE TABLE counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cli', 'site')),
  command TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  node TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  arch TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  pack TEXT NOT NULL DEFAULT '',
  suite TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, command, version, node, platform, arch, outcome, template, pack, suite, event)
);

CREATE TABLE installs (
  day TEXT NOT NULL,
  install_hash TEXT NOT NULL,
  PRIMARY KEY (day, install_hash)
);
