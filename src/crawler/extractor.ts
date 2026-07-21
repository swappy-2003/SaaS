import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

export interface ExtractedPage {
  title: string;
  url: string;
  content: string;
  headings: { text: string; level: number }[];
  siteId: string;
}

export interface Chunk {
  id: string;
  text: string;
  title: string;
  url: string;
  section: string;
  siteId: string;
}

/**
 * Parses raw HTML, removes non-content elements, and formats core layout structures.
 */
export function cleanHtmlAndExtract(html: string, url: string, siteId: string): ExtractedPage {
  const $ = cheerio.load(html);

  // 1. Remove noise elements
  const selectorsToRemove = [
    'header', 'footer', 'nav', 'aside', 'script', 'style', 'noscript', 'iframe',
    '.cookie-banner', '#cookie-banner', '.cookie-consent', '#cookie-consent',
    '.newsletter-popup', '.social-icons', '.social-media', '.menu', '#menu',
    '.navigation', '#navigation', '.sidebar', '#sidebar', '.ads', '.ad',
    '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]',
    '#popup', '.popup', '.modal', '.newsletter-form'
  ];

  selectorsToRemove.forEach(selector => {
    $(selector).remove();
  });

  // Extract page title
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || 'Untitled Page';

  // Find all headings
  const headings: { text: string; level: number }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const text = $(element).text().trim().replace(/\s+/g, ' ');
    const tag = element.tagName.toLowerCase();
    const level = parseInt(tag.charAt(1), 10);
    if (text) {
      headings.push({ text, level });
    }
  });

  // Select primary content container or default to body
  let contentContainer = $('body');
  for (const selector of ['main', 'article', '#content', '.content', '.main-content']) {
    const el = $(selector);
    if (el.length > 0) {
      contentContainer = el;
      break;
    }
  }

  const lines: string[] = [];

  // Recursively process DOM nodes to retain section blocks, list structures, and tables
  function processNode(node: any) {
    $(node).find('script, style, noscript, header, footer, nav, aside').remove();

    $(node).contents().each((_, child) => {
      if (child.type === 'text') {
        const text = $(child).text().trim();
        if (text) {
          lines.push(text);
        }
      } else if (child.type === 'tag') {
        const tagName = child.tagName.toLowerCase();
        
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
          const headingText = $(child).text().trim().replace(/\s+/g, ' ');
          if (headingText) {
            lines.push(`\n## ${headingText} ##\n`);
          }
        } else if (tagName === 'p') {
          const pText = $(child).text().trim().replace(/\s+/g, ' ');
          if (pText) {
            lines.push(pText);
          }
        } else if (tagName === 'li') {
          const liText = $(child).text().trim().replace(/\s+/g, ' ');
          if (liText) {
            lines.push(`- ${liText}`);
          }
        } else if (tagName === 'tr') {
          const cells: string[] = [];
          $(child).find('th, td').each((_, cell) => {
            cells.push($(cell).text().trim().replace(/\s+/g, ' '));
          });
          if (cells.length > 0) {
            lines.push(`| ${cells.join(' | ')} |`);
          }
        } else if (['div', 'section', 'ul', 'ol', 'table', 'tbody'].includes(tagName)) {
          processNode(child);
        } else {
          // Inline and misc elements
          const inlineText = $(child).text().trim().replace(/\s+/g, ' ');
          if (inlineText && !['a', 'button'].includes(tagName)) {
            processNode(child);
          }
        }
      }
    });
  }

  processNode(contentContainer);

  const rawContent = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  logger.debug(`Extracted content from: ${url} (${rawContent.length} chars)`);

  return {
    title,
    url,
    content: rawContent,
    headings,
    siteId
  };
}

/**
 * Splits extracted page text into semantic chunks of ~500-800 words with ~100 words overlap.
 */
export function chunkContent(page: ExtractedPage): Chunk[] {
  const { content, title, url, siteId } = page;
  
  // Split into sentences (keeping punctuation using lookbehind)
  const sentences = content.split(/(?<=[.!?])\s+/);
  const chunks: Chunk[] = [];
  
  let currentSection = 'Main';
  let currentChunkSentences: string[] = [];
  let currentWordCount = 0;

  const maxWords = 600; // Target chunk size (within 500-800 words range)
  const overlapWords = 100; // Target overlap

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    if (!sentence) continue;

    // Detect section markers we injected
    const headingMatch = sentence.match(/^##\s+(.+?)\s+##$/);
    if (headingMatch) {
      currentSection = headingMatch[1];
    }

    const wordCount = sentence.split(/\s+/).length;
    
    currentChunkSentences.push(sentence);
    currentWordCount += wordCount;

    if (currentWordCount >= maxWords) {
      const chunkText = currentChunkSentences.join(' ');
      const base64Url = Buffer.from(url).toString('base64').substring(0, 16);
      const chunkId = `${siteId}_${base64Url}_${chunks.length}`;
      
      chunks.push({
        id: chunkId,
        text: chunkText,
        title,
        url,
        section: currentSection,
        siteId
      });

      // Backtrack to build the overlap block
      let overlapCount = 0;
      let overlapSentences: string[] = [];
      for (let j = currentChunkSentences.length - 1; j >= 0; j--) {
        const words = currentChunkSentences[j].split(/\s+/).length;
        if (overlapCount + words > overlapWords && overlapSentences.length > 0) {
          break;
        }
        overlapSentences.unshift(currentChunkSentences[j]);
        overlapCount += words;
      }

      currentChunkSentences = overlapSentences;
      currentWordCount = overlapCount;
    }
  }

  // Flush remaining sentences
  if (currentChunkSentences.length > 0) {
    const chunkText = currentChunkSentences.join(' ');
    const base64Url = Buffer.from(url).toString('base64').substring(0, 16);
    const chunkId = `${siteId}_${base64Url}_${chunks.length}`;
    
    chunks.push({
      id: chunkId,
      text: chunkText,
      title,
      url,
      section: currentSection,
      siteId
    });
  }

  return chunks;
}
