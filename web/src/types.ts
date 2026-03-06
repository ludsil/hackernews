export interface Article {
  id: number;
  hn_id: number;
  title: string;
  url: string;
  summary: string;
  tags: string[];
  score: number;
  image_url: string | null;
  s3_raw_path: string;
  scraped_at: Date;
  created_at: Date;
}
