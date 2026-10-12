-- STEP 34 - go-live approval gate (additive: two new tables, nothing existing is touched).
CREATE TABLE "GoLiveState" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "readyById" TEXT,
    "readyAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "liveById" TEXT,
    "liveAt" TIMESTAMP(3),
    "commitSha" TEXT,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoLiveState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoLiveEvent" (
    "id" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "commitSha" TEXT,
    "gateSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoLiveEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoLiveEvent_createdAt_idx" ON "GoLiveEvent"("createdAt");
