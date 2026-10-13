-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ARTICLE', 'GUIDE');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ContentAuthor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCategory" (
    "id" TEXT NOT NULL,
    "type" "ContentType" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPost" (
    "id" TEXT NOT NULL,
    "type" "ContentType" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" TEXT,
    "authorId" TEXT NOT NULL,
    "tags" TEXT[],
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "readingMinutes" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentCategory_type_slug_key" ON "ContentCategory"("type", "slug");

-- CreateIndex
CREATE INDEX "ContentPost_status_publishedAt_idx" ON "ContentPost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "ContentPost_type_status_idx" ON "ContentPost"("type", "status");

-- CreateIndex
CREATE INDEX "ContentPost_categoryId_idx" ON "ContentPost"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPost_type_slug_key" ON "ContentPost"("type", "slug");

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ContentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "ContentAuthor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

