import * as xml2js from 'xml2js';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import { cleanHtmlAndExtract, ExtractedPage } from './extractor.js';
import { logger } from '../utils/logger.js';
import { assertPublicWebsiteUrl, fetchPublicWebsiteContent } from '../security/publicUrl.js';

/**
 * Attempts to parse a sitemap.xml and returns all loc links inside.
 * Recursively parses sitemap indices if present.
 */
async function parseSitemap(sitemapUrl: string, hostname: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  try {
    logger.info(`Fetching sitemap at ${sitemapUrl}`);
    const response = await fetchPublicWebsiteContent(sitemapUrl, hostname);
    if (!response.contentType.includes('xml') && !response.contentType.includes('text/')) return [];

    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.body);

    if (result.urlset && result.urlset.url) {
      const urls = Array.isArray(result.urlset.url)
        ? result.urlset.url.map((u: any) => u.loc)
        : [result.urlset.url.loc];
      return urls.filter(Boolean);
    } else if (result.sitemapindex && result.sitemapindex.sitemap) {
      const sitemapUrls = Array.isArray(result.sitemapindex.sitemap)
        ? result.sitemapindex.sitemap.map((s: any) => s.loc)
        : [result.sitemapindex.sitemap.loc];

      const allUrls: string[] = [];
      for (const subSitemap of sitemapUrls) {
        if (subSitemap) {
          const subSitemapUrl = new URL(subSitemap);
          if (subSitemapUrl.hostname !== hostname) continue;
          const subUrls = await parseSitemap(subSitemap, hostname, depth + 1);
          allUrls.push(...subUrls);
        }
      }
      return allUrls;
    }
  } catch (error) {
    logger.warn(`Could not fetch or parse sitemap at ${sitemapUrl}: ${(error as Error).message}`);
  }
  return [];
}

/**
 * Helper to determine if a URL string points to an asset rather than a page.
 */
function isAsset(urlStr: string): boolean {
  const assetExtensions = [
    '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.mp4', '.webm', '.avi',
    '.mov', '.zip', '.tar.gz', '.xml', '.css', '.js', '.mp3', '.wav', '.webp',
    '.ico', '.dmg', '.pkg', '.epub', '.csv', '.xls', '.xlsx', '.doc', '.docx'
  ];
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    return assetExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return true; // Ignore if invalid URL
  }
}

/**
 * Normalizes and checks if a URL is an internal link.
 */
function getInternalLink(currentUrl: string, href: string, origin: string): string | null {
  if (!href) return null;

  // Remove anchor portion
  const hashIdx = href.indexOf('#');
  if (hashIdx !== -1) {
    href = href.substring(0, hashIdx);
  }
  href = href.trim();
  if (!href) return null;

  try {
    const absoluteUrl = new URL(href, currentUrl).toString();
    const targetUrlObj = new URL(absoluteUrl);
    const originUrlObj = new URL(origin);

    // Verify same hostname & non-asset extension
    if (targetUrlObj.hostname === originUrlObj.hostname) {
      if (!isAsset(absoluteUrl)) {
        return absoluteUrl;
      }
    }
  } catch {
    // Ignore invalid urls
  }
  return null;
}

/**
 * Fetches site HTML and extracts cleaned pages.
 */
export async function crawlSite(
  startUrl: string,
  siteId: string,
  maxPages = 150
): Promise<ExtractedPage[]> {
  logger.info(`Starting crawl for siteId: "${siteId}" at URL: ${startUrl}`);

  const startUrlObj = await assertPublicWebsiteUrl(startUrl);
  const origin = startUrlObj.origin;
  
  // Try checking sitemap first
  let urlsToCrawl: string[] = [];
  const sitemapUrl = `${origin}/sitemap.xml`;
  const sitemapUrls = await parseSitemap(sitemapUrl, startUrlObj.hostname);
  
  if (sitemapUrls.length > 0) {
    logger.info(`Found ${sitemapUrls.length} links in sitemap.xml. Will index sitemap links.`);
    // Filter sitemap URLs to match origin & check if they are assets
    urlsToCrawl = sitemapUrls.filter(u => {
      try {
        const uObj = new URL(u);
        return uObj.hostname === startUrlObj.hostname && !isAsset(u);
      } catch {
        return false;
      }
    });
  }

  const visited = new Set<string>();
  const pages: ExtractedPage[] = [];

  if (urlsToCrawl.length > 0) {
    // Sitemap-driven fetch
    // Keep it within maxPages count
    const targetUrls = urlsToCrawl.slice(0, maxPages);
    logger.info(`Crawling ${targetUrls.length} pages listed in sitemap...`);

    for (const url of targetUrls) {
      if (visited.has(url)) continue;
      visited.add(url);

      try {
        logger.info(`Fetching page: ${url}`);
        const response = await fetchPublicWebsiteContent(url, startUrlObj.hostname);

        // Ensure response is HTML
        const contentType = response.contentType;
        if (!contentType.includes('text/html')) {
          logger.warn(`Skipping non-HTML page ${url}: Content-Type is ${contentType}`);
          continue;
        }

        const page = cleanHtmlAndExtract(response.body, response.url, siteId);
        if (page.content) {
          pages.push(page);
        }
      } catch (err) {
        logger.error(`Failed to crawl sitemap page: ${url}`, err);
      }
    }
  } else {
    // Fallback: Queue-based recursive crawl
    logger.info(`No sitemap found. Falling back to recursive crawler starting from ${startUrl}`);
    
    const queue: string[] = [startUrl];
    visited.add(startUrl);

    while (queue.length > 0 && pages.length < maxPages) {
      const currentUrl = queue.shift()!;
      logger.info(`Crawling queue link (${pages.length}/${maxPages} indexed, ${queue.length} in queue): ${currentUrl}`);

      try {
        const response = await fetchPublicWebsiteContent(currentUrl, startUrlObj.hostname);

        const contentType = response.contentType;
        if (!contentType.includes('text/html')) {
          logger.warn(`Skipping non-HTML page ${currentUrl}`);
          continue;
        }

        // Extract links from HTML to enqueue
        const $ = cheerio.load(response.body);
        $('a').each((_, element) => {
          const href = $(element).attr('href');
          if (href) {
            const internalLink = getInternalLink(currentUrl, href, origin);
            if (internalLink && !visited.has(internalLink)) {
              visited.add(internalLink);
              queue.push(internalLink);
            }
          }
        });

        const page = cleanHtmlAndExtract(response.body, response.url, siteId);
        if (page.content) {
          pages.push(page);
        }
      } catch (err) {
        logger.error(`Failed to crawl queue page: ${currentUrl}`, err);
      }
    }
  }

  logger.info(`Crawl completed. Successfully extracted ${pages.length} pages for siteId: "${siteId}"`);
  return pages;
}
