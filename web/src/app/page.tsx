import { getRecentArticles } from '@/lib/db';
import { ArticleList } from '@/components/article-list';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const articles = await getRecentArticles(30);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-2">Latest Stories</h2>
        <p className="text-muted-foreground">
          {articles.length > 0 ? (
            <>
              Last updated {formatDistanceToNow(new Date(articles[0].scraped_at))} ago
            </>
          ) : (
            'No articles yet. Run the scraper to fetch stories.'
          )}
        </p>
      </div>

      <ArticleList articles={articles} />
    </div>
  );
}
