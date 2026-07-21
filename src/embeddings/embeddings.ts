import { pipeline } from '@xenova/transformers';
import { logger } from '../utils/logger.js';

export interface EmbeddingsService {
  getEmbedding(text: string): Promise<number[]>;
  getEmbeddings(texts: string[]): Promise<number[][]>;
}

class LocalEmbeddingsService implements EmbeddingsService {
  private extractor: any = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';

  private async init() {
    if (this.extractor) return;
    try {
      logger.info(`Loading local embedding model: ${this.modelName}`);
      this.extractor = await pipeline('feature-extraction', this.modelName);
      logger.info(`Successfully loaded local embedding model: ${this.modelName}`);
    } catch (error) {
      logger.error('Failed to load local embedding model', error);
      throw new Error(`Embedding model load failed: ${(error as Error).message}`);
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    await this.init();
    try {
      // Normalize yields cosine similarity on dot product search
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data) as number[];
    } catch (error) {
      logger.error(`Failed to generate embedding for text: "${text.substring(0, 30)}..."`, error);
      throw error;
    }
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    await this.init();
    try {
      logger.info(`Generating embeddings for ${texts.length} chunks locally...`);
      const embeddings: number[][] = [];
      
      for (let i = 0; i < texts.length; i++) {
        if (i % 20 === 0 && i > 0) {
          logger.info(`Embedded ${i}/${texts.length} chunks...`);
        }
        const emb = await this.getEmbedding(texts[i]);
        embeddings.push(emb);
      }
      logger.info(`Successfully generated all ${texts.length} embeddings.`);
      return embeddings;
    } catch (error) {
      logger.error('Failed to generate batch embeddings', error);
      throw error;
    }
  }
}

export const embeddingsService = new LocalEmbeddingsService();
export default embeddingsService;
