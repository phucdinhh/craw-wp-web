const WPAPI = require('wpapi');
const axios = require('axios');
const cheerio = require('cheerio');
// const spin = require('spin-text');

const wp = new WPAPI({
  endpoint: 'http://crawl.k-tech.net.vn/vebongda/wp-json',
  username: 'admin',
  password: '@ktech@1903'
});

// wp.auth = {
//   username: 'admin',
//   password: '@ktech@1903'
// };

console.log(wp)

async function checkCredentials() {
  try {
    const profile = await wp.users().me();
    console.log('Credentials are valid:', profile);
    return true;
  } catch (error) {
    console.error('Invalid credentials:', error);
    return false;
  }
}


async function fetchArticles(webUrl) {
  const { data } = await axios.get(webUrl);
  const $ = cheerio.load(data);
  const contentData = {};

  const title = $('.td_block_wrap .tdb-block-inner .tdb-title-text').text();
  contentData.title = title;

  contentData.content = []

  $('.td_block_wrap .tdb-block-inner').children().each((index, element) => {
    const tagName = $(element).prop('tagName').toLowerCase();
    if (tagName === 'p') {
      contentData.content.push({ type: 'text', content: $(element).text() });
    } else if (tagName === 'img') {
      contentData.content.push({ type: 'thumbnail', src: $(element).attr('src') });
    } else if (tagName === 'figure') {
      const img = $(element).find('img');
      if (img.length) {
        contentData.content.push({ type: 'image', src: img.attr('src') });
      }
    }
  });

  return contentData;
}

async function importArticles() {
  const credentialsValid = await checkCredentials();
  if (!credentialsValid) {
    console.error('Cannot proceed with invalid credentials.');
    return;
  }

  const listWeb = [
    'https://vebongdaonline.vn/doi-hinh-mu-thoi-sir-alex/',
    'https://vebongdaonline.vn/cau-thu-ghi-nhieu-ban-thang-nhat-euro/'
  ];

  const articles = [];
  for (const web of listWeb) {
    const article = await fetchArticles(web);
    if (article) {
      articles.push(article);
    }
  }

  for (const article of articles) {
    try {
      // Combine content array into a single string
      const contentString = article.content.map(item => {
        if (item.type === 'text') {
          return `<p>${item.content}</p>`;
        } else if (item.type === 'image' || item.type === 'thumbnail') {
          return `<img src="${item.src}" alt="" />`;
        }
      }).join('');

      const post = await wp.posts().create({
        title: article.title,
        content: contentString,
        status: 'publish'
      });

      console.log('post', post);

      console.log(`Post created: ${post.id}`);
    } catch (error) {
      console.error(`Failed to create post: ${article.title}`);
      console.error(error);
    }
  }
}

importArticles();