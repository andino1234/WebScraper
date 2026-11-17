'use strict';

const cheerio = require('cheerio');
const { squish } = require('../../lib/text');

/** Canal RSS o Atom. */
module.exports = {
  id: 'rss',
  label: 'Canal RSS',
  async fetch({ http, source }) {
    const res = await http.get(source.Url, { responseType: 'text' });
    const $ = cheerio.load(String(res.data), { xmlMode: true });
    const items = [];
    $('item, entry').each((_, el) => {
      const e = $(el);
      const link = e.find('link').attr('href') || squish(e.find('link').first().text());
      const description = squish(cheerio.load(`<div>${e.find('description, summary, content').first().text()}</div>`)('div').text());
      items.push({
        title: squish(e.find('title').first().text()),
        url: link,
        description,
        publishedAt: squish(e.find('pubDate, published, updated').first().text()) || null
      });
    });
    return items;
  }
};
