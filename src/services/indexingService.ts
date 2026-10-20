import { logger } from '../utils/logger.js';
import { crawlSite } from '../crawler/crawler.js';
import { chunkContent, Chunk } from '../crawler/extractor.js';
import { embeddingsService } from '../embeddings/embeddings.js';
import { VectorStore, VectorRecord } from '../vector/vectorStore.js';
import { RagService } from './ragService.js';

export interface IndexingResult {
  pageCount: number;
  chunkCount: number;
}

export class IndexingService {
  /**
   * Executes the full crawl -> clean -> chunk -> embed -> store indexing pipeline for a tenant.
   */
  public static async indexSite(siteId: string, maxPages = 150): Promise<IndexingResult> {
    logger.info(`Starting indexing process for siteId: "${siteId}"`);

    // 1. Retrieve the target site configuration (validates siteId exists)
    const siteConfig = RagService.getSiteConfig(siteId);
    
    return this.indexWebsite({ websiteId: siteId, url: siteConfig.url, maxPages });
  }

  /**
   * Database-backed indexing path. The website UUID is also the LanceDB
   * namespace, preventing one website from overwriting another's vectors.
   */
  public static async indexWebsite(input: {
    websiteId: string;
    url: string;
    maxPages: number;
  }): Promise<IndexingResult> {
    const { websiteId, url, maxPages } = input;
    logger.info(`Starting indexing process for websiteId: "${websiteId}"`);

    try {
      // 1. Crawl only after the crawler's public-network checks pass.
      const pages = await crawlSite(url, websiteId, maxPages);
      if (pages.length === 0) {
        throw new Error(`Crawl returned 0 pages for websiteId: "${websiteId}". Vector store will not be updated.`);
      }

      // 3. Chunk the extracted text
      const allChunks: Chunk[] = [];
      for (const page of pages) {
        const chunks = chunkContent(page);
        allChunks.push(...chunks);
      }

      logger.info(`Total chunks generated for websiteId "${websiteId}": ${allChunks.length}`);
      if (allChunks.length === 0) {
        throw new Error(`Text extraction yielded no chunks for websiteId: "${websiteId}".`);
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
      // Overwrite happens only after a complete crawl and embedding pass, so a
      // failed index leaves the previous LanceDB collection intact.
      await VectorStore.saveChunks(websiteId, records);
      logger.info(`Successfully completed indexing for websiteId: "${websiteId}"`);
      return { pageCount: pages.length, chunkCount: allChunks.length };
    } catch (error) {
      logger.error(`Indexing pipeline failed for websiteId: "${websiteId}"`, error);
      throw error;
    }
  }
}
