import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { Chunk } from '../crawler/extractor.js';

export interface VectorRecord {
  vector: number[];
  id: string;
  text: string;
  title: string;
  url: string;
  section: string;
  siteId: string;
}

export interface SearchResult {
  id: string;
  text: string;
  title: string;
  url: string;
  section: string;
  siteId: string;
  _distance?: number;
}

export class VectorStore {
  private static TABLE_NAME = 'chunks';
  private static BASE_DIR = path.resolve('vectors');

  /**
   * Resolves the storage path for a given site tenant.
   */
  private static getSiteDbPath(siteId: string): string {
    const cleanSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '');
    const dir = path.join(this.BASE_DIR, cleanSiteId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Overwrites the vectors table for the given site tenant with new chunk records.
   */
  public static async saveChunks(siteId: string, records: VectorRecord[]): Promise<void> {
    const dbPath = this.getSiteDbPath(siteId);
    logger.info(`Connecting to LanceDB at: ${dbPath} for saving chunks`);
    
    const db = await lancedb.connect(dbPath);
    
    if (records.length === 0) {
      logger.warn(`No records provided to save for siteId: ${siteId}`);
      return;
    }

    try {
      // Overwrite the table with the new items to replace previous indexes
      await db.createTable(this.TABLE_NAME, records as any[], { mode: 'overwrite' });
      logger.info(`Successfully stored ${records.length} vector records in LanceDB for siteId: "${siteId}"`);
    } catch (error) {
      logger.error(`Failed to store vector records in LanceDB for siteId: "${siteId}"`, error);
      throw error;
    }
  }

  /**
   * Searches the site's database using the query vector.
   */
  public static async search(
    siteId: string,
    queryVector: number[],
    limit = 5
  ): Promise<SearchResult[]> {
    const dbPath = this.getSiteDbPath(siteId);
    const db = await lancedb.connect(dbPath);

    try {
      const tableNames = await db.tableNames();
      if (!tableNames.includes(this.TABLE_NAME)) {
        logger.warn(`Table "${this.TABLE_NAME}" does not exist for siteId: "${siteId}". Database might be empty.`);
        return [];
      }

      const table = await db.openTable(this.TABLE_NAME);
      logger.info(`Searching top ${limit} matches in table "${this.TABLE_NAME}" for siteId: "${siteId}"`);

      // Search and convert output array
      const results = await table
        .search(queryVector)
        .limit(limit)
        .toArray();

      return results.map((r: any) => ({
        id: r.id,
        text: r.text,
        title: r.title,
        url: r.url,
        section: r.section,
        siteId: r.siteId,
        _distance: r._distance
      }));
    } catch (error) {
      logger.error(`Error during vector search for siteId: "${siteId}"`, error);
      throw error;
    }
  }
}
