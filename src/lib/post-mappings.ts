type PostWithMappings = {
  postStocks: {
    mentionType: string;
    sentiment: string | null;
    stock: {
      ticker: string;
      market: string;
      assetType?: string | null;
      companyName?: string | null;
    };
  }[];
  postSectors: {
    confidence: unknown;
    evidence: string;
    sentiment: string | null;
    sector: {
      id?: string;
      slug: string;
      name: string;
      market: string;
      etfs?: {
        ticker: string;
        market: string;
        name: string;
        rank: number;
      }[];
    };
  }[];
};

export function buildPostMappings(post: PostWithMappings) {
  const stocks = post.postStocks.map((ps) => ({
    ticker: ps.stock.ticker,
    market: ps.stock.market,
    assetType: ps.stock.assetType ?? "STOCK",
    companyName: ps.stock.companyName ?? "",
    mentionType: ps.mentionType,
    sentiment: ps.sentiment,
    associationType: ps.stock.assetType === "ETF" ? "direct_etf" : "direct_stock",
    confidence: 1,
  }));

  const sectors = post.postSectors.map((ps) => {
    const confidence = Number(ps.confidence);
    return {
      id: ps.sector.id,
      slug: ps.sector.slug,
      name: ps.sector.name,
      market: ps.sector.market,
      confidence,
      evidence: ps.evidence,
      sentiment: ps.sentiment,
      associationType:
        confidence >= 0.7 ? "direct_or_etf_sector" : "weak_inferred_sector",
    };
  });

  const etfByKey = new Map<
    string,
    {
      ticker: string;
      market: string;
      name: string;
      rank: number;
      sourceSectors: string[];
      associationType: "recommended_etf";
    }
  >();

  for (const ps of post.postSectors) {
    for (const etf of ps.sector.etfs ?? []) {
      const key = `${etf.market}:${etf.ticker}`;
      const existing = etfByKey.get(key);
      if (existing) {
        if (!existing.sourceSectors.includes(ps.sector.name)) {
          existing.sourceSectors.push(ps.sector.name);
        }
      } else {
        etfByKey.set(key, {
          ticker: etf.ticker,
          market: etf.market,
          name: etf.name,
          rank: etf.rank,
          sourceSectors: [ps.sector.name],
          associationType: "recommended_etf",
        });
      }
    }
  }

  return {
    stocks,
    sectors,
    etfs: Array.from(etfByKey.values()).sort((a, b) => a.rank - b.rank),
  };
}
