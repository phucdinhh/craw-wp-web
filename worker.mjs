import { parentPort } from 'worker_threads';
import { fetchArticles, processImages, getCategoryIds, wp } from './helper.mjs';

parentPort.on('message', async ({ webUrl, siteName }) => {
  try {
    const article = await fetchArticles(webUrl, siteName);
    console.log("🚀 ~ parentPort.on ~ article:", article)
    if (!article) {
      parentPort.postMessage({ status: 'error', message: `No article found at ${webUrl}` });
      return;
    }

    console.log("🚀 ~ parentPort.on ~ article.categories:", article.categories)
    const categoryIds = await getCategoryIds(article.categories || ['Default Category']);
    if (categoryIds.length === 0) {
      parentPort.postMessage({ status: 'error', message: `Failed to get or create categories for: ${article.title}` });
      return;
    }

    const uploadedImages = await processImages(article.images);
    const firstImageUrl = article.images[0];
    const featuredMediaId = firstImageUrl ? uploadedImages[firstImageUrl].id : null;

    const contentString = article.content.map(item => {
      if (item.type === 'text') {
        return `<p>${item.content}</p>`;
      } else if ((item.type === 'image' || item.type === 'thumbnail') && item.src !== firstImageUrl) {
        const newSrc = uploadedImages[item.src] ? uploadedImages[item.src].url : item.src;
        return `<img src="${newSrc}" alt="" />`;
      } else if (item.type === 'heading') {
        return `<${item.level}>${item.content}</${item.level}>`;
      } else if (item.type === 'nested' && item.level === 'span-b') {
        return `<h3><span><b>${item.content}</b></span></h3>`;
      } else if (item.type === 'list') {
        return item.content;
      }
      return '';
    }).join('');

    const post = await wp.posts().create({
      title: article.title,
      content: contentString,
      status: 'publish',
      categories: categoryIds,
      featured_media: featuredMediaId
    });
    console.log("🚀 ~ post ~ article.title:", article.title)

    parentPort.postMessage({ status: 'success', post });
  } catch (error) {
    parentPort.postMessage({ status: 'error', message: error.message });
  }
});
