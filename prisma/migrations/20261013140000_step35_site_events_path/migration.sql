-- AlterTable (additive, nullable: existing marketing events are untouched)
ALTER TABLE "MarketingEvent" ADD COLUMN     "path" VARCHAR(80);

-- CreateIndex
CREATE INDEX "MarketingEvent_type_path_occurredAt_idx" ON "MarketingEvent"("type", "path", "occurredAt");
