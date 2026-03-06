const axios = require('axios');
const cheerio = require('cheerio');
const { logger } = require('./logger');

class ImageScraper {
  constructor() {
    this.timeout = 5000; // 5 seconds timeout
  }

  async extractImage(url) {
    try {
      logger.debug('Extracting image from URL', { url });

      // Fetch the HTML content
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HNDigestBot/1.0)'
        },
        maxRedirects: 5,
      });

      const html = response.data;
      const $ = cheerio.load(html);

      // Try og:image meta tag first (most reliable)
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage && this.isValidImageUrl(ogImage)) {
        logger.debug('Found og:image', { url, imageUrl: ogImage });
        return this.normalizeUrl(ogImage, url);
      }

      // Try twitter:image meta tag
      const twitterImage = $('meta[name="twitter:image"]').attr('content');
      if (twitterImage && this.isValidImageUrl(twitterImage)) {
        logger.debug('Found twitter:image', { url, imageUrl: twitterImage });
        return this.normalizeUrl(twitterImage, url);
      }

      // Try first img tag
      const firstImg = $('img').first().attr('src');
      if (firstImg && this.isValidImageUrl(firstImg)) {
        logger.debug('Found first img tag', { url, imageUrl: firstImg });
        return this.normalizeUrl(firstImg, url);
      }

      logger.debug('No suitable image found', { url });
      return null;
    } catch (error) {
      logger.warn('Failed to extract image', {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  isValidImageUrl(url) {
    if (!url || url.length === 0) {
      return false;
    }

    // Filter out tiny images, tracking pixels, and common non-content images
    const invalidPatterns = [
      /1x1/i,
      /pixel/i,
      /tracker/i,
      /beacon/i,
      /analytics/i,
      /logo/i,
      /icon/i,
      /avatar/i,
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(url)) {
        return false;
      }
    }

    return true;
  }

  normalizeUrl(imageUrl, baseUrl) {
    try {
      // If it's already an absolute URL, return as-is
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return imageUrl;
      }

      // If it starts with //, prepend https:
      if (imageUrl.startsWith('//')) {
        return `https:${imageUrl}`;
      }

      // Otherwise, resolve relative to base URL
      const base = new URL(baseUrl);
      const resolved = new URL(imageUrl, base.origin);
      return resolved.toString();
    } catch (error) {
      logger.warn('Failed to normalize image URL', { imageUrl, baseUrl });
      return imageUrl;
    }
  }

  async downloadImage(imageUrl) {
    try {
      logger.debug('Downloading image', { imageUrl });

      const response = await axios.get(imageUrl, {
        timeout: this.timeout,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HNDigestBot/1.0)'
        },
        maxRedirects: 5,
      });

      const buffer = Buffer.from(response.data);

      logger.debug('Image downloaded', {
        imageUrl,
        size: buffer.length
      });

      return buffer;
    } catch (error) {
      logger.warn('Failed to download image', {
        imageUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

module.exports = { ImageScraper };
