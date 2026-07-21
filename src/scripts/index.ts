import { IndexingService } from '../services/indexingService.js';
import { logger } from '../utils/logger.js';

/**
 * CLI Indexing Script.
 * Usage: npm run index -- --siteId=sanjivani --maxPages=100
 */
async function runCliIndexer() {
  const args = process.argv.slice(2);
  let siteId = '';
  let maxPages = 150;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--siteId=')) {
      siteId = arg.split('=')[1];
    } else if (arg === '--siteId' && i + 1 < args.length) {
      siteId = args[i + 1];
      i++;
    } else if (arg.startsWith('--maxPages=')) {
      const parsedMax = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsedMax)) maxPages = parsedMax;
    } else if (arg === '--maxPages' && i + 1 < args.length) {
      const parsedMax = parseInt(args[i + 1], 10);
      if (!isNaN(parsedMax)) {
        maxPages = parsedMax;
        i++;
      }
    }
  }

  // Default fallback if argument is missing
  if (!siteId) {
    logger.warn('No --siteId parameter provided. Defaulting to "sanjivani".');
    siteId = 'sanjivani';
  }

  logger.info(`🚀 Starting CLI Indexer for siteId: "${siteId}" (maxPages limit: ${maxPages})`);
  
  try {
    await IndexingService.indexSite(siteId, maxPages);
    logger.info(`✅ CLI Indexer finished successfully for siteId: "${siteId}"!`);
    process.exit(0);
  } catch (error) {
    logger.error(`❌ CLI Indexer failed for siteId: "${siteId}"`, error);
    process.exit(1);
  }
}

runCliIndexer();
