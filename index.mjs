import { Worker } from 'worker_threads';
import path from 'path';
import pLimit from 'p-limit';
import { fileURLToPath } from 'url';
import { checkCredentials, fetchSitemap, fetchCategoryPages } from './helper.mjs';
import { siteConfigs } from './siteConfigs.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_CONCURRENT_WORKERS = 3; // Số lượng worker threads chạy đồng thời tối đa

async function importArticles() {
  const credentialsValid = await checkCredentials();
  if (!credentialsValid) {
    console.error('Cannot proceed with invalid credentials.');
    return;
  }

  const limit = pLimit(MAX_CONCURRENT_WORKERS);

  for (const siteConfig of siteConfigs) {
    console.log("🚀 ~ importArticles ~ siteConfig:", siteConfig)
    let listWeb = [];
    if (siteConfig.hasSitemap) {
      listWeb = await fetchSitemap(siteConfig.sitemapUrl);
    } else {
      listWeb = await fetchCategoryPages(siteConfig.categoryUrl, siteConfig.baseUrl);
    }
    console.log("🚀 ~ importArticles ~ listWeb:", listWeb)

    // Loại bỏ các URL có vấn đề (trùng lặp redirect)
    const filteredListWeb = listWeb.filter(url => !url.includes('redirect'));

    const createWorker = (url) => {
      return limit(() => new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'worker.mjs'));

        worker.on('message', (message) => {
          if (message.status === 'success') {
            console.log(`Post created: ${message.post.id}`);
            resolve();
          } else {
            console.error(`Error from worker: ${message.message}`);
            reject(new Error(message.message));
          }
        });

        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });

        worker.postMessage({ webUrl: url, siteName: siteConfig.name });
      }));
    };

    try {
      await Promise.all(filteredListWeb.map(createWorker));
      console.log(`All articles processed successfully for site: ${siteConfig.name}`);
    } catch (error) {
      console.error(`Failed to process some articles for site: ${siteConfig.name}`, error.message);
    }
  }
}

importArticles();
