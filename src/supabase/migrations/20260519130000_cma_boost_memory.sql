-- Migration: cma_boost_memory function for CMA synaptic boost
-- Date: 2026-05-19
CREATE OR REPLACE FUNCTION cma_boost_memory(memory_ids bigint []) RETURNS void AS $$ BEGIN
UPDATE memories
SET recall_count = recall_count + 1,
    decay_score = LEAST(1.0, decay_score + 0.2)
WHERE id = ANY(memory_ids);
END;
$$ LANGUAGE plpgsql;