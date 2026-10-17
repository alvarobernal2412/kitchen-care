-- Every post now has a required title (1-80 characters). Add the column with a temporary default so
-- existing rows survive, backfill them, then drop the default so inserts must provide a title.
ALTER TABLE "posts" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Milestone posts get the chore label; everything else the first line of the body (80 characters
-- at most), with a fixed fallback for the impossible empty case.
UPDATE "posts" SET "title" = COALESCE(NULLIF(btrim(left(btrim(COALESCE(
	(SELECT t."label" FROM "submissions" s JOIN "tasks" t ON t."key" = s."task_key" WHERE s."id" = "posts"."milestone_submission_id"),
	NULLIF(btrim(split_part("posts"."body", E'\n', 1)), ''),
	'Post'
)), 80)), ''), 'Post');--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "title" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_title_length_check" CHECK (char_length("posts"."title") between 1 and 80);
