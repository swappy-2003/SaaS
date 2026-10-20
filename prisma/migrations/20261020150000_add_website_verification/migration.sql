-- A raw verification token is shown only at website creation. Store a hash so
-- a database read cannot be used to impersonate domain ownership.
ALTER TABLE "Website" ADD COLUMN "verificationTokenHash" TEXT;
ALTER TABLE "Website" ADD COLUMN "verifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Website_verificationTokenHash_key" ON "Website"("verificationTokenHash");
