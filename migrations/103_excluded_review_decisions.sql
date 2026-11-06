-- The migration runner rebuilds review_decisions, preserving its indexes and
-- triggers, in this version's transaction before recording this migration.
-- Some installations already have the expanded CHECK from an older runtime.
SELECT 1;
