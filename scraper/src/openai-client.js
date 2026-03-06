const OpenAI = require('openai');
const { logger } = require('./logger');

class OpenAIClient {
  constructor(apiKey, baseURL) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || undefined
    });
  }

  async summarizeArticle(title, url) {
    try {
      logger.debug('Summarizing article', { title, url });

      const prompt = `Summarize this Hacker News article in 2-3 sentences and suggest 3 relevant tags.

Title: ${title}
URL: ${url}

Please respond in the following JSON format:
{
  "summary": "Your 2-3 sentence summary here",
  "tags": ["tag1", "tag2", "tag3"]
}

Make the summary informative and the tags specific (e.g., "machine-learning", "rust", "databases" rather than generic terms).`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes technical articles and suggests relevant tags. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
      });

      logger.debug('OpenAI response received', {
        title,
        response: JSON.stringify(response)
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        logger.error('No content in OpenAI response', {
          title,
          response: JSON.stringify(response)
        });
        throw new Error('No content in OpenAI response');
      }

      // Parse the JSON response
      const parsed = JSON.parse(content);

      // Validate the response structure
      if (!parsed.summary || !Array.isArray(parsed.tags)) {
        throw new Error('Invalid response structure from OpenAI');
      }

      logger.debug('Article summarized', {
        title,
        tagsCount: parsed.tags.length
      });

      return {
        summary: parsed.summary,
        tags: parsed.tags.slice(0, 3) // Ensure max 3 tags
      };
    } catch (error) {
      logger.error('Failed to summarize article', {
        title,
        url,
        error: error instanceof Error ? error.message : String(error)
      });

      // Return fallback summary
      return {
        summary: `${title} - Visit the article for more details.`,
        tags: ['general', 'tech', 'hackernews']
      };
    }
  }
}

module.exports = { OpenAIClient };
