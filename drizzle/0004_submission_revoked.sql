ALTER TABLE "submissions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "revoked_by" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;