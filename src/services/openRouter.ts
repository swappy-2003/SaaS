import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OpenRouterClient {
  private apiKey: string;
  private defaultModel: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor() {
    this.apiKey = config.openRouterApiKey;
    this.defaultModel = config.openRouterModel;
  }

  /**
   * Retrieves the request headers, checking if the API key is set.
   */
  private getHeaders() {
    if (!this.apiKey) {
      logger.error('OPENROUTER_API_KEY environment variable is missing.');
      throw new Error('OPENROUTER_API_KEY is not configured on the server. Please set it in your .env file.');
    }
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://hospitalsanjivani.in',
      'X-Title': 'Multi-Tenant AI RAG Backend'
    };
  }

  /**
   * Performs a standard non-streaming chat completion request.
   */
  public async chatCompletion(
    messages: ChatMessage[],
    model = this.defaultModel
  ): Promise<string> {
    logger.info(`Sending chat request to OpenRouter (model: ${model})`);
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model,
          messages
        },
        {
          headers: this.getHeaders()
        }
      );
      
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenRouter returned an empty response');
      }
      return content;
    } catch (error: any) {
      const errorMsg = error?.response?.data || error.message;
      logger.error('OpenRouter request failed', errorMsg);
      throw new Error(`OpenRouter completion failed: ${JSON.stringify(errorMsg)}`);
    }
  }

  /**
   * Streams response tokens from OpenRouter.
   * Yields individual string tokens.
   */
  public async *streamChatCompletion(
    messages: ChatMessage[],
    model = this.defaultModel
  ): AsyncGenerator<string, void, unknown> {
    logger.info(`Initiating streaming response from OpenRouter (model: ${model})`);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`OpenRouter streaming call failed with status ${response.status}`, errText);
      throw new Error(`OpenRouter stream failed: ${errText}`);
    }

    if (!response.body) {
      throw new Error('Response body from OpenRouter was empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Save the last partial line back to the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          if (cleanLine.startsWith('data: ')) {
            const dataStr = cleanLine.substring(6);
            if (dataStr === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(dataStr);
              const token = parsed?.choices?.[0]?.delta?.content || '';
              if (token) {
                yield token;
              }
            } catch (err) {
              logger.debug(`Could not parse JSON from SSE line: "${cleanLine}"`);
            }
          }
        }
      }

      // Flush remaining data
      if (buffer.trim()) {
        const cleanLine = buffer.trim();
        if (cleanLine.startsWith('data: ')) {
          const dataStr = cleanLine.substring(6);
          if (dataStr !== '[DONE]') {
            try {
              const parsed = JSON.parse(dataStr);
              const token = parsed?.choices?.[0]?.delta?.content || '';
              if (token) {
                yield token;
              }
            } catch {
              // Ignore
            }
          }
        }
      }
    } catch (error) {
      logger.error('Streaming reader exception occurred', error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}

export const openRouterClient = new OpenRouterClient();
export default openRouterClient;
