-- One row per received Remote ID frame. `frame` is the receiver's JSON as-is
-- ("uav id", "uav latitude", ...); the writer (receiver/ingest) inserts, the API only reads.
CREATE TABLE IF NOT EXISTS detections (
  id       bigserial PRIMARY KEY,
  received timestamptz NOT NULL DEFAULT now(),
  frame    jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS detections_recent ON detections (received DESC);
