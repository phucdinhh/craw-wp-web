import WPAPI from 'wpapi';
import axios from 'axios';
import cheerio from 'cheerio';
import fs from 'fs-extra';
import path from 'node:path';
import xml2js from 'xml2js';
import { decode } from 'html-entities';
import OpenAI from 'openai';
import puppeteer from 'puppeteer';
import axiosRetry from 'axios-retry';
import { siteConfigs } from './siteConfigs.mjs';

axiosRetry(axios, { retries: 3 });

export const openai = new OpenAI({
  apiKey: 'your-openai-api-key', // Đặt API key của bạn ở đây
});

export const wp = new WPAPI({
  endpoint: 'https://crawl.k-tech.net.vn/vebongda/wp-json',
  username: 'admin',
  password: '@ktech@1903'
});

const MAX_RETRIES = 5;
const RETRY_DELAY = 20000; // 20 seconds in milliseconds

export async function spinContent(content, retryCount = 0) {
  try {
    const response = await openai.completions.create({
      model: 'gpt-3.5-turbo-instruct',
      prompt: `Rewrite the following content in a different way while keeping the meaning the same:\n\n${content}`,
      max_tokens: 1000,
      temperature: 0.7,
    });
    console.log("🚀 ~ spinContent ~ response:", response);
    return response.choices[0].text.trim();
  } catch (error) {
    if (error.response && error.response.status === 429 && retryCount < MAX_RETRIES) {
      console.error(`=========================Rate limit reached. Retrying in 20 seconds... (Retry ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return spinContent(content, retryCount + 1); // Retry the request
    } else if (retryCount >= MAX_RETRIES) {
      console.error('Maximum retries reached. Returning original content.');
      return content; // Return the original content if max retries are reached
    } else {
      console.error('Error generating spun content:', error.status, error.error.message);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return spinContent(content, retryCount + 1); // Return the original content if there is an error
    }
  }
}

export async function checkCredentials() {
  try {
    const profile = await wp.users().me();
    console.log('Credentials are valid:', profile);
    return true;
  } catch (error) {
    console.error('Invalid credentials:', error);
    return false;
  }
}

export async function getCategoryByName(name) {
  try {
    const categories = await wp.categories().param('search', name).get();
    const existingCategory = categories.find(cat => cat.name.toLowerCase() === name.toLowerCase());
    return existingCategory ? existingCategory.id : null;
  } catch (error) {
    console.error(`Error fetching categories:`, error);
    return null;
  }
}

export async function createCategory(name) {
  try {
    const category = await wp.categories().create({ name });
    return category.id;
  } catch (error) {
    console.error(`Error creating category:`, error);
    return null;
  }
}

export async function getCategoryIds(names) {
  const categoryIds = await Promise.all(names.map(async (name) => {
    let categoryId = await getCategoryByName(name);
    if (!categoryId) {
      categoryId = await createCategory(name);
    }
    return categoryId;
  }));
  return categoryIds.filter(id => id); // Filter out null values
}

export async function downloadImage(url, dest) {
  const writer = fs.createWriteStream(dest);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

export async function uploadImageToWordPress(imagePath) {
  try {
    const imageData = fs.readFileSync(imagePath);
    const response = await wp.media().file(imageData, path.basename(imagePath)).create({
      title: path.basename(imagePath),
      alt_text: path.basename(imagePath),
    });
    return { id: response.id, url: response.source_url }; // Return both ID and URL
  } catch (error) {
    console.error('Error uploading image:', error);
    return null;
  }
}

export async function processImages(images) {
  const tempDir = path.join(path.resolve(), 'temp');
  fs.ensureDirSync(tempDir); // Ensure the temporary directory exists

  const uploadedImages = {};
  for (const imgUrl of images) {
    if (!imgUrl) {
      console.error('Image URL is undefined');
      continue;
    }

    const imagePath = path.join(tempDir, path.basename(imgUrl));
    try {
      await downloadImage(imgUrl, imagePath);
      const uploadResult = await uploadImageToWordPress(imagePath);
      if (uploadResult) {
        uploadedImages[imgUrl] = uploadResult;
      }
    } catch (error) {
      console.error(`Failed to process image ${imgUrl}:`, error);
    } finally {
      fs.removeSync(imagePath); // Clean up the temporary image file
    }
  }
  return uploadedImages;
}

export function sanitizeXML(xml) {
  // Remove BOM (Byte Order Mark) if present
  xml = xml.replace(/^\uFEFF/, '');
  // Ensure all ampersands are properly encoded
  xml = xml.replace(/&(?!#?\w+;)/g, '&amp;');
  return xml;
}

// Function to fetch and process the sitemap
export async function fetchSitemap(url, redirectCount = 0) {
  console.log("🚀 ~ fetchSitemap ~ url:", url)
  const maxRedirects = 5; // Set the maximum number of redirects

  if (redirectCount > maxRedirects) {
    console.error(`Exceeded maximum number of redirects for URL: ${url}`);
    return [];
  }

  try {
    // Configure Axios to limit the number of redirects
    const response = await axios.get(url, {
      maxRedirects: maxRedirects,
      timeout: 10000,  // Set a timeout to avoid hanging requests
    });

    let xmlContent = response.data;

    // Decode HTML entities
    xmlContent = decode(xmlContent);

    // Check for non-whitespace characters before the first tag and remove them
    const firstTagIndex = xmlContent.indexOf('<');
    if (firstTagIndex > 0) {
      xmlContent = xmlContent.slice(firstTagIndex);
    }

    // Sanitize the XML content
    const sanitizedXml = sanitizeXML(xmlContent);

    // Wrap xml2js.parseString in a promise-based function
    const parseXml = (xml) => {
      return new Promise((resolve, reject) => {
        xml2js.parseString(xml, (err, result) => {
          if (err) {
            return reject(err);
          }
          resolve(result);
        });
      });
    };

    const result = await parseXml(sanitizedXml);

    if (!result || (!result.sitemapindex && !result.urlset)) {
      console.error(`Invalid sitemap content at URL: ${url}`);
      return [];
    }

    let urls = [];
    if (result.sitemapindex && result.sitemapindex.sitemap) {
      // It's an index sitemap
      const sitemapUrls = result.sitemapindex.sitemap.map(entry => entry.loc[0]);
      for (const sitemapUrl of sitemapUrls) {
        try {
          const childUrls = await fetchSitemap(sitemapUrl, redirectCount + 1);
          urls = urls.concat(childUrls);
        } catch (fetchError) {
          console.error(`Error fetching child sitemap at ${sitemapUrl}:`, fetchError);
        }
      }
    } else if (result.urlset && result.urlset.url) {
      // It's a URL sitemap
      urls = result.urlset.url.map(entry => entry.loc[0]);
    } else {
      throw new Error('Invalid sitemap format');
    }

    return urls;
  } catch (error) {
    if (error.response && error.response.status >= 300 && error.response.status < 400) {
      console.error(`Redirection error: ${error.message}`);
    } else {
      console.error(`Error fetching sitemap at ${url}:`, error);
    }
    return [];
  }
}

// Function to check if the page is ready using Axios
export async function isPageReady(url) {
  console.log("🚀 ~ isPageReady ~ url:", url)
  try {
    const response = await axios.get(url, {
      timeout: 10000, // Thời gian chờ 10 giây
      maxRedirects: 5 // Giới hạn số lần redirect
    });
    console.log("🚀 ~ isPageReady ~ response:", url)

    // Kiểm tra mã trạng thái HTTP và nội dung phản hồi
    if (response.status === 200) {
      const $ = cheerio.load(response.data);
      return !!$('.td_block_wrap .tdb-block-inner .tdb-title-text').length;
    }
    return false;
  } catch (error) {
    console.error(`Error checking if page is ready at ${url}: ${error.message}`);
    return false;
  }
}

export async function fetchCategoryPages(categoryUrl, baseUrl) {
  let page = 1;
  const urls = [];

  while (true) {
    const currentPageUrl = `${categoryUrl}${page}`;
    try {
      console.log("🚀 ~ fetchCategoryPages ~ currentPageUrl:", currentPageUrl)
      const browser = await puppeteer.launch();
      const browserPage = await browser.newPage();
      await browserPage.goto(currentPageUrl, { waitUntil: 'networkidle2' });

      const content = await browserPage.content();
      const $ = cheerio.load(content);

      const container = $('.main');
      const links = container.find('.listNews .itemNews a'); // Cập nhật selector để lấy các link bài viết từ trang category
      if (links.length === 0) break;

      links.each((_, element) => {
        let link = $(element).attr('href');
        console.log("🚀 ~ links.each ~ link:", link)
        if (link) {
          if (!link.startsWith('http')) {
            link = baseUrl + link;
          }
          urls.push(link);
        }
      });

      browser.close()
      page++;
    } catch (error) {
      console.error(`Error fetching category page at ${currentPageUrl}: ${error.message}`);
      break;
    }
  }

  return urls;
}

export async function fetchArticles(webUrl, siteName, retryCount = 0) {
  const MAX_RETRIES = 5; // Số lần thử lại tối đa
  const TIMEOUT = 60000; // Tăng thời gian chờ lên 60 giây

  const siteConfig = siteConfigs.find(site => site.name === siteName);
  if (!siteConfig) {
    throw new Error(`No configuration found for site: ${siteName}`);
  }

  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(webUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });

    const content = await page.content();
    const $ = cheerio.load(content);
    const contentData = {};

    const title = $(siteConfig.selectors.title).text();
    console.log("🚀 ~ fetchArticles ~ title:", title)
    contentData.title = title;

    contentData.content = [];
    contentData.images = [];

    // Extract multiple categories
    contentData.categories = [];
    console.log("🚀 ~ $ ~ $(siteConfig.selectors.categories):", $('.listTagsWrap .listTags a p').text())
    $(siteConfig.selectors.categories).each((index, element) => {
      console.log("🚀 ~ $ ~ element:", element)
      const category = $(element).text();
      if (category) {
        contentData.categories.push(category);
      }
    });

    const elements = $(siteConfig.selectors.content).children().get();
    const classesToSkip = ['reading-time-number', 'tdb-minute-text', 'tdb-add-text'];

    for (const element of elements) {
      const tagName = $(element).prop('tagName').toLowerCase();

      if (tagName === 'p' && siteConfig.selectors.paragraphs.includes(tagName)) {
        const originalText = $(element).text();
        contentData.content.push({ type: 'text', content: originalText });
      } else if (siteConfig.selectors.headings.includes(tagName)) { // Check if it's a heading tag
        const originalText = $(element).text();
        contentData.content.push({ type: 'heading', level: tagName, content: originalText });
      } else if (tagName === 'img' && siteConfig.selectors.images.includes(tagName)) {
        contentData.content.push({ type: 'thumbnail', src: $(element).attr('src') });
        contentData.images.push($(element).attr('src'));
      } else if (tagName === 'figure' && siteConfig.selectors.figures.includes(tagName)) {
        const img = $(element).find('img');
        if (img.length) {
          contentData.content.push({ type: 'image', src: img.attr('src') });
          contentData.images.push(img.attr('src'));
        }
      } else if ((tagName === 'span' || tagName === 'b') && !classesToSkip.some(className => $(element).hasClass(className))) {
        const originalText = $(element).text();
        contentData.content.push({ type: 'text', content: originalText });
      } else if (siteConfig.selectors.listItems.includes(tagName)) {
        const listItems = $(element).find('li').map((i, el) => $(el).text()).get();
        const listContent = listItems.map(item => `<li>${item}</li>`).join('');
        contentData.content.push({ type: 'list', content: `<${tagName}>${listContent}</${tagName}>` });
      }
    }

    browser.close()
    return contentData;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.error(`Error fetching article at ${webUrl}: ${error.message}. Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Chờ 2 giây trước khi thử lại
      return fetchArticles(webUrl, siteName, retryCount + 1);
    } else {
      console.error(`Error fetching article at ${webUrl}: ${error.message}. No more retries left.`);
      return null; // Return null if there is an error fetching the article
    }
  }
}
