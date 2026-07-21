import { logger } from '../utils/logger.js';
import { crawlSite } from '../crawler/crawler.js';
import { chunkContent, Chunk } from '../crawler/extractor.js';
import { embeddingsService } from '../embeddings/embeddings.js';
import { VectorStore, VectorRecord } from '../vector/vectorStore.js';
import { RagService } from './ragService.js';

export class IndexingService {
  /**
   * Executes the full crawl -> clean -> chunk -> embed -> store indexing pipeline for a tenant.
   */
  public static async indexSite(siteId: string, maxPages = 150): Promise<void> {
    logger.info(`Starting indexing process for siteId: "${siteId}"`);

    // 1. Retrieve the target site configuration (validates siteId exists)
    const siteConfig = RagService.getSiteConfig(siteId);
    
    try {
      // 2. Crawl the website
      const pages = await crawlSite(siteConfig.url, siteId, maxPages);
      if (pages.length === 0) {
        throw new Error(`Crawl returned 0 pages for siteId: "${siteId}". Vector store will not be updated.`);
      }

      // 3. Chunk the extracted text
      const allChunks: Chunk[] = [];
      for (const page of pages) {
        const chunks = chunkContent(page);
        allChunks.push(...chunks);
      }

      logger.info(`Total chunks generated for siteId "${siteId}": ${allChunks.length}`);
      if (allChunks.length === 0) {
        throw new Error(`Text extraction yielded no chunks for siteId: "${siteId}".`);
      }

      // 4. Generate local embeddings for all chunks
      const texts = allChunks.map(c => c.text);
      const embeddings = await embeddingsService.getEmbeddings(texts);

      // 5. Build LanceDB record structures
      const records: VectorRecord[] = allChunks.map((chunk, idx) => ({
        vector: embeddings[idx],
        id: chunk.id,
        text: chunk.text,
        title: chunk.title,
        url: chunk.url,
        section: chunk.section,
        siteId: chunk.siteId
      }));

      // 6. Write vector collection to local LanceDB (isolated sub-folder)
      await VectorStore.saveChunks(siteId, records);
      logger.info(`Successfully completed indexing for siteId: "${siteId}"`);
    } catch (error) {
      logger.error(`Indexing pipeline failed for siteId: "${siteId}"`, error);
      throw error;
    }
  }
}
