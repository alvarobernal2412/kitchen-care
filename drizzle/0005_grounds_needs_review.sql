-- The coffee grounds chore is now a reviewed photo task. Seeding only inserts missing rows, so the
-- already-deployed row is changed here. Idempotent, and a no-op on an empty tasks table.
UPDATE "tasks" SET "requires_photo" = true, "persist_photo" = true, "needs_review" = true, "milestone" = false WHERE "key" = 'grounds';