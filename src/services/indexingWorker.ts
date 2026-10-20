import { IndexJobStatus, WebsiteStatus } from '@prisma/client';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { IndexingService } from './indexingService.js';

/**
 * A deliberately small persistent worker for a single VPS. Jobs live in
 * Postgres, so a restart does not lose queued work. A later BullMQ migration
 * can preserve this API if throughput requires it.
 */
class IndexingWorker {
  private timer?: NodeJS.Timeout;
  private running = false;

  async start(): Promise<void> {
    if (!config.databaseUrl || this.timer) return;
    await this.requeueStaleJobs();
    await this.tick();
    this.timer = setInterval(() => void this.tick(), config.indexWorkerPollMs);
    this.timer.unref();
    logger.info('Persistent indexing worker started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async requeueStaleJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - config.indexJobStaleMs);
    const result = await prisma.indexingJob.updateMany({
      where: { status: IndexJobStatus.RUNNING, startedAt: { lt: staleBefore } },
      data: { status: IndexJobStatus.QUEUED, startedAt: null, errorMessage: 'Recovered after worker restart.' }
    });
    if (result.count) logger.warn(`Requeued ${result.count} stale indexing jobs.`);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processOne();
    } catch (error) {
      logger.error('Indexing worker tick failed', error);
    } finally {
      this.running = false;
    }
  }

  private async processOne(): Promise<void> {
    const candidate = await prisma.indexingJob.findFirst({
      where: { status: IndexJobStatus.QUEUED },
      select: { id: true },
      orderBy: { requestedAt: 'asc' }
    });
    if (!candidate) return;

    // Conditional claim protects against accidental duplicate workers.
    const claimed = await prisma.indexingJob.updateMany({
      where: { id: candidate.id, status: IndexJobStatus.QUEUED },
      data: { status: IndexJobStatus.RUNNING, startedAt: new Date(), attempt: { increment: 1 }, errorMessage: null }
    });
    if (claimed.count !== 1) return;

    const job = await prisma.indexingJob.findUnique({
      where: { id: candidate.id },
      include: { website: { select: { id: true, url: true, verifiedAt: true } } }
    });
    if (!job) return;

    if (!job.website.verifiedAt) {
      await this.fail(job.id, job.website.id, 'Website ownership must be verified before indexing.');
      return;
    }

    try {
      const result = await IndexingService.indexWebsite({
        websiteId: job.website.id,
        url: job.website.url,
        maxPages: config.crawlMaxPages
      });
      const finishedAt = new Date();
      await prisma.$transaction([
        prisma.indexingJob.update({
          where: { id: job.id },
          data: {
            status: IndexJobStatus.SUCCEEDED,
            pagesCrawled: result.pageCount,
            chunksCreated: result.chunkCount,
            finishedAt
          }
        }),
        prisma.website.update({
          where: { id: job.website.id },
          data: {
            status: WebsiteStatus.READY,
            lastIndexedAt: finishedAt,
            indexedPageCount: result.pageCount,
            indexedChunkCount: result.chunkCount
          }
        })
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Indexing failed unexpectedly.';
      await this.fail(job.id, job.website.id, message);
      logger.error(`Indexing job failed: ${job.id}`, error);
    }
  }

  private async fail(jobId: string, websiteId: string, errorMessage: string): Promise<void> {
    const finishedAt = new Date();
    await prisma.$transaction([
      prisma.indexingJob.update({
        where: { id: jobId },
        data: { status: IndexJobStatus.FAILED, errorMessage, finishedAt }
      }),
      prisma.website.update({ where: { id: websiteId }, data: { status: WebsiteStatus.FAILED } })
    ]);
  }
}

export const indexingWorker = new IndexingWorker();
