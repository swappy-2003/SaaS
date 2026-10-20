-- Prevent duplicate worker load when two enqueue requests arrive concurrently.
CREATE UNIQUE INDEX "IndexingJob_one_active_per_website"
  ON "IndexingJob"("websiteId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
