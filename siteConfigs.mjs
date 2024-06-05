export const siteConfigs = [
  {
    name: 'vebongda',
    baseUrl: 'https://vebongdaonline.vn',
    sitemapUrl: 'https://vebongdaonline.vn/post-sitemap1.xml',
    hasSitemap: true,
    selectors: {
      title: '.td_block_wrap .tdb-block-inner .tdb-title-text',
      categories: '.td_block_wrap .tdb-category .tdb-entry-category',
      content: '.td_block_wrap .tdb-block-inner',
      images: 'img',
      paragraphs: 'p',
      headings: 'h1, h2, h3, h4, h5, h6',
      listItems: 'ul li, ol li',
      figures: 'figure img'
    }
  },
  {
    name: 'bongda',
    baseUrl: 'https://bongda.com.vn',
    categoryUrl: 'https://bongda.com.vn/v-league/?page=',
    hasSitemap: false,
    selectors: {
      title: 'h2',
      categories: '.listTagsWrap .listTags a p',
      content: '.contentEditor',
      images: 'img.article-image',
      paragraphs: 'p',
      headings: 'h1, h2, h3, h4, h5, h6',
      listItems: 'ul li, ol li',
      figures: 'figure img'
    }
  }
];
