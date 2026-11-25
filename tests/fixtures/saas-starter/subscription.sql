-- Shaped like boxyhq/saas-starter-kit's Prisma Subscription model:
-- id, customerId, priceId, active, startDate, endDate, cancelAt.
-- Gatefit must run S1–S12 against this table without changing it.
CREATE TABLE Subscription (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  priceId TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  cancelAt TEXT
);
CREATE INDEX Subscription_customerId_idx ON Subscription (customerId);
