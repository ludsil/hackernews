const axios = require('axios');
const { logger } = require('./logger');

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const REQUEST_DELAY = 100; // ms between requests to avoid rate limiting

class HNClient {
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getTopStories(limit = 30) {
    try {
      logger.info('Fetching top stories', { limit });
      const response = await axios.get(`${HN_API_BASE}/topstories.json`);
      const topStories = response.data.slice(0, limit);
      logger.info('Fetched top stories', { count: topStories.length });
      return topStories;
    } catch (error) {
      logger.error('Failed to fetch top stories', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to fetch top stories: ${error}`);
    }
  }

  async getStory(id) {
    try {
      await this.delay(REQUEST_DELAY);

      logger.debug('Fetching story', { hn_id: id });
      const response = await axios.get(`${HN_API_BASE}/item/${id}.json`);

      const story = response.data;

      // Filter out stories without URLs (Ask HN, Show HN without links, etc.)
      if (!story || !story.url) {
        logger.debug('Story has no URL, skipping', { hn_id: id, title: story?.title });
        return null;
      }

      // Only return story type items
      if (story.type !== 'story') {
        logger.debug('Item is not a story, skipping', { hn_id: id, type: story.type });
        return null;
      }

      logger.debug('Fetched story', {
        hn_id: id,
        title: story.title,
        score: story.score
      });

      return story;
    } catch (error) {
      logger.error('Failed to fetch story', {
        hn_id: id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async getStories(ids) {
    const stories = [];

    for (const id of ids) {
      const story = await this.getStory(id);
      if (story) {
        stories.push(story);
      }
    }

    logger.info('Fetched stories', {
      requested: ids.length,
      successful: stories.length
    });

    return stories;
  }
}

module.exports = { HNClient };
