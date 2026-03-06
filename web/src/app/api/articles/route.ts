import { NextRequest, NextResponse } from 'next/server';
import { searchArticles, getArticlesByDate } from '@/lib/db';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query') || '';
  const tags = searchParams.get('tags')?.split(',').filter(Boolean) || [];
  const date = searchParams.get('date');

  try {
    let articles;

    if (date) {
      articles = await getArticlesByDate(new Date(date));
    } else if (query || tags.length > 0) {
      articles = await searchArticles(query, tags);
    } else {
      return NextResponse.json(
        { error: 'Please provide query, tags, or date parameter' },
        { status: 400 }
      );
    }

    return NextResponse.json(articles);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch articles' },
      { status: 500 }
    );
  }
}
