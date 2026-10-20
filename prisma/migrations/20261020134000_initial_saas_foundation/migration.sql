-- Initial durable tenancy, project, indexing, widget, and usage ledger schema.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "WebsiteStatus" AS ENUM ('DRAFT', 'INDEXING', 'READY', 'FAILED', 'DISABLED');
CREATE TYPE "IndexJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ConversationRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "User" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Organization" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Membership" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "organizationId" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Project" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "vectorNamespace" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Website" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "name" TEXT NOT NULL, "url" TEXT NOT NULL,
  "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[], "status" "WebsiteStatus" NOT NULL DEFAULT 'DRAFT',
  "lastIndexedAt" TIMESTAMP(3), "indexedPageCount" INTEGER NOT NULL DEFAULT 0,
  "indexedChunkCount" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Assistant" (
  "id" UUID NOT NULL, "websiteId" UUID NOT NULL, "publicId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "welcomeMessage" TEXT NOT NULL, "theme" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assistant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "IndexingJob" (
  "id" UUID NOT NULL, "websiteId" UUID NOT NULL, "status" "IndexJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempt" INTEGER NOT NULL DEFAULT 0, "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
  "chunksCreated" INTEGER NOT NULL DEFAULT 0, "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  CONSTRAINT "IndexingJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ApiKey" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "label" TEXT NOT NULL, "prefix" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Conversation" (
  "id" UUID NOT NULL, "websiteId" UUID NOT NULL, "visitorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ChatMessage" (
  "id" UUID NOT NULL, "conversationId" UUID NOT NULL, "role" "ConversationRole" NOT NULL, "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UsageEvent" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "projectId" UUID, "eventType" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0, "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}', CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");
CREATE UNIQUE INDEX "Project_vectorNamespace_key" ON "Project"("vectorNamespace");
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");
CREATE UNIQUE INDEX "Project_organizationId_slug_key" ON "Project"("organizationId", "slug");
CREATE INDEX "Website_projectId_idx" ON "Website"("projectId");
CREATE UNIQUE INDEX "Website_projectId_url_key" ON "Website"("projectId", "url");
CREATE UNIQUE INDEX "Assistant_websiteId_key" ON "Assistant"("websiteId");
CREATE UNIQUE INDEX "Assistant_publicId_key" ON "Assistant"("publicId");
CREATE INDEX "IndexingJob_websiteId_status_idx" ON "IndexingJob"("websiteId", "status");
CREATE INDEX "ApiKey_projectId_revokedAt_idx" ON "ApiKey"("projectId", "revokedAt");
CREATE UNIQUE INDEX "ApiKey_projectId_prefix_key" ON "ApiKey"("projectId", "prefix");
CREATE INDEX "Conversation_websiteId_createdAt_idx" ON "Conversation"("websiteId", "createdAt");
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");
CREATE INDEX "UsageEvent_organizationId_createdAt_idx" ON "UsageEvent"("organizationId", "createdAt");
CREATE INDEX "UsageEvent_projectId_createdAt_idx" ON "UsageEvent"("projectId", "createdAt");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Website" ADD CONSTRAINT "Website_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assistant" ADD CONSTRAINT "Assistant_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexingJob" ADD CONSTRAINT "IndexingJob_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
