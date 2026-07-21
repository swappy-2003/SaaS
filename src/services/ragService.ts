import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { embeddingsService } from '../embeddings/embeddings.js';
import { VectorStore, SearchResult } from '../vector/vectorStore.js';
import { openRouterClient, ChatMessage } from './openRouter.js';
import { getSystemPrompt } from '../prompts/systemPrompt.js';

export interface SiteConfig {
  siteId: string;
  url: string;
  name: string;
}

export interface SourceCitation {
  title: string;
  url: string;
}

export interface RagResult {
  answer: string;
  sources: SourceCitation[];
}

export interface RagStreamResult {
  stream: AsyncGenerator<string, void, unknown>;
  sources: SourceCitation[];
}

export class RagService {
  private static SITES_DIR = path.resolve('sites');

  /**
   * Retrieves the site tenant configuration from the local json store.
   */
  public static getSiteConfig(siteId: string): SiteConfig {
    const cleanSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '');
    const sitePath = path.join(this.SITES_DIR, `${cleanSiteId}.json`);

    if (!fs.existsSync(sitePath)) {
      logger.error(`Tenant configuration not found for siteId: "${siteId}" at path ${sitePath}`);
      throw new Error(`Invalid siteId: Tenant configuration for "${siteId}" does not exist.`);
    }

    try {
      const data = fs.readFileSync(sitePath, 'utf8');
      return JSON.parse(data) as SiteConfig;
    } catch (error) {
      logger.error(`Failed to parse config file for siteId: "${siteId}"`, error);
      throw new Error(`Failed to load configuration for siteId "${siteId}".`);
    }
  }

  /**
   * Helper to format retrieved LanceDB search results into a clean context string.
   */
  private static buildContext(results: SearchResult[]): string {
    if (results.length === 0) {
      return "No matching context found on the website.";
    }

    return results
      .map((r, i) => {
        return `[Document ${i + 1}]
Title: ${r.title}
URL: ${r.url}
Section: ${r.section}
Content:
${r.text}`;
      })
      .join('\n\n========================================\n\n');
  }

  /**
   * Helper to extract unique source citations from LanceDB search results.
   */
  private static extractSources(results: SearchResult[]): SourceCitation[] {
    const seen = new Set<string>();
    const citations: SourceCitation[] = [];

    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        citations.push({
          title: r.title,
          url: r.url
        });
      }
    }
    return citations;
  }

  /**
   * Processes a non-streaming query.
   */
  public static async query(siteId: string, message: string): Promise<RagResult> {
    // 1. Load config
    const config = this.getSiteConfig(siteId);

    // 2. Generate embedding for user message
    logger.info(`Embedding query for siteId: "${siteId}": "${message.substring(0, 40)}..."`);
    const queryVector = await embeddingsService.getEmbedding(message);

    // 3. Search vector DB (top 5 chunks)
    const searchResults = await VectorStore.search(siteId, queryVector, 5);
    const sources = this.extractSources(searchResults);

    // 4. Build system prompt & prompt context
    const contextStr = this.buildContext(searchResults);
    const systemPrompt = getSystemPrompt(siteId, contextStr);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];

    // 5. Query OpenRouter
    const answer = await openRouterClient.chatCompletion(messages);

    return {
      answer,
      sources
    };
  }

  /**
   * Processes a streaming query, returning the citation sources and the SSE generator.
   */
  public static async queryStream(siteId: string, message: string): Promise<RagStreamResult> {
    // 1. Load config
    const config = this.getSiteConfig(siteId);

    // 2. Generate embedding for user message
    logger.info(`Embedding query stream for siteId: "${siteId}": "${message.substring(0, 40)}..."`);
    const queryVector = await embeddingsService.getEmbedding(message);

    // 3. Search vector DB (top 5 chunks)
    const searchResults = await VectorStore.search(siteId, queryVector, 5);
    const sources = this.extractSources(searchResults);

    // 4. Build system prompt & prompt context
    const contextStr = this.buildContext(searchResults);
    const systemPrompt = getSystemPrompt(siteId, contextStr);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];

    // 5. Initialize SSE stream generator from OpenRouter
    const stream = openRouterClient.streamChatCompletion(messages);

    return {
      stream,
      sources
    };
  }
}
