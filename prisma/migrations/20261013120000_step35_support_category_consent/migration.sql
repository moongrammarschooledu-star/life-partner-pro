-- AlterTable (additive, nullable: existing support messages are untouched)
ALTER TABLE "SupportMessage" ADD COLUMN "category" TEXT,
ADD COLUMN "consentAt" TIMESTAMP(3);
