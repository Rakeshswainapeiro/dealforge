import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ExternalLink, TrendingUp, MessageSquare, Calendar } from "lucide-react";
import { api } from "@/api/client";

export default function CompanyNewsScraper({ company }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const handleScrape = async () => {
    setLoading(true);
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Search and gather comprehensive information about ${company.name} (${company.ticker || 'no ticker'}) from multiple sources:

1. Yahoo Finance (finance.yahoo.com) - Latest stock data, financial metrics, analyst ratings
2. Twitter/X - Recent mentions, sentiment, trending topics
3. LinkedIn - Company updates, employee insights
4. Financial news sites - Recent news articles, press releases
5. Reddit - r/stocks, r/investing discussions

Provide the following information:

FINANCIAL DATA (from Yahoo Finance):
- Current stock price and change
- 52-week high/low
- P/E ratio, Market cap
- Analyst ratings summary
- Recent financial highlights

NEWS & PRESS:
- Top 5 recent news headlines with dates and brief summaries
- Links to news sources

SOCIAL SENTIMENT:
- Overall sentiment (positive/negative/neutral)
- Key topics being discussed
- Notable mentions or trending discussions
- Recent LinkedIn company posts

MARKET INSIGHTS:
- Analyst recommendations
- Price targets
- Recent developments or announcements

Search broadly across these sources and compile comprehensive, up-to-date information.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            financial_data: {
              type: "object",
              properties: {
                current_price: { type: "number" },
                price_change: { type: "number" },
                pe_ratio: { type: "number" },
                week_52_high: { type: "number" },
                week_52_low: { type: "number" },
                analyst_rating: { type: "string" },
                highlights: { type: "array", items: { type: "string" } }
              }
            },
            news: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  headline: { type: "string" },
                  date: { type: "string" },
                  summary: { type: "string" },
                  source: { type: "string" },
                  url: { type: "string" }
                }
              }
            },
            social_sentiment: {
              type: "object",
              properties: {
                overall: { type: "string" },
                topics: { type: "array", items: { type: "string" } },
                notable_mentions: { type: "array", items: { type: "string" } }
              }
            },
            market_insights: {
              type: "object",
              properties: {
                analyst_recommendations: { type: "string" },
                price_targets: { type: "string" },
                recent_developments: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      });

      setData(result);
    } catch (err) {
      console.error("Scrape error:", err);
      alert("Failed to fetch data: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getSentimentColor = (sentiment) => {
    if (!sentiment) return "bg-slate-100 text-slate-700";
    const s = sentiment.toLowerCase();
    if (s.includes("positive")) return "bg-green-100 text-green-700";
    if (s.includes("negative")) return "bg-red-100 text-red-700";
    return "bg-yellow-100 text-yellow-700";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-600" />
              Multi-Source Intelligence
            </CardTitle>
            <Button 
              onClick={handleScrape}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Gathering Data...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Fetch Latest Data
                </>
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {data && (
        <div className="space-y-4">
          {/* Financial Data */}
          {data.financial_data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  Yahoo Finance Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {data.financial_data.current_price && (
                    <div>
                      <p className="text-xs text-slate-600">Current Price</p>
                      <p className="text-lg font-bold text-slate-900">
                        ${data.financial_data.current_price.toFixed(2)}
                      </p>
                      {data.financial_data.price_change && (
                        <p className={`text-xs font-medium ${data.financial_data.price_change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {data.financial_data.price_change >= 0 ? '+' : ''}{data.financial_data.price_change.toFixed(2)}%
                        </p>
                      )}
                    </div>
                  )}
                  {data.financial_data.pe_ratio && (
                    <div>
                      <p className="text-xs text-slate-600">P/E Ratio</p>
                      <p className="text-lg font-bold text-slate-900">{data.financial_data.pe_ratio.toFixed(2)}</p>
                    </div>
                  )}
                  {data.financial_data.week_52_high && (
                    <div>
                      <p className="text-xs text-slate-600">52W High</p>
                      <p className="text-lg font-bold text-slate-900">${data.financial_data.week_52_high.toFixed(2)}</p>
                    </div>
                  )}
                  {data.financial_data.week_52_low && (
                    <div>
                      <p className="text-xs text-slate-600">52W Low</p>
                      <p className="text-lg font-bold text-slate-900">${data.financial_data.week_52_low.toFixed(2)}</p>
                    </div>
                  )}
                </div>
                {data.financial_data.analyst_rating && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Analyst Rating</p>
                    <Badge className="bg-blue-100 text-blue-800">{data.financial_data.analyst_rating}</Badge>
                  </div>
                )}
                {data.financial_data.highlights && data.financial_data.highlights.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-600 mb-2">Financial Highlights</p>
                    <ul className="space-y-1">
                      {data.financial_data.highlights.map((highlight, idx) => (
                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                          <span className="text-teal-600">•</span>
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* News */}
          {data.news && data.news.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-purple-600" />
                  Recent News & Press
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.news.map((article, idx) => (
                    <div key={idx} className="border-b border-slate-100 pb-3 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 text-sm mb-1">{article.headline}</h4>
                          <p className="text-xs text-slate-600 mb-2">{article.summary}</p>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{article.source}</Badge>
                            {article.date && (
                              <span className="text-xs text-slate-500">{article.date}</span>
                            )}
                          </div>
                        </div>
                        {article.url && (
                          <a 
                            href={article.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-700"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Social Sentiment */}
          {data.social_sentiment && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-orange-600" />
                  Social Media Sentiment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.social_sentiment.overall && (
                  <div>
                    <p className="text-xs text-slate-600 mb-2">Overall Sentiment</p>
                    <Badge className={getSentimentColor(data.social_sentiment.overall)}>
                      {data.social_sentiment.overall}
                    </Badge>
                  </div>
                )}
                {data.social_sentiment.topics && data.social_sentiment.topics.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-600 mb-2">Trending Topics</p>
                    <div className="flex flex-wrap gap-2">
                      {data.social_sentiment.topics.map((topic, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">{topic}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {data.social_sentiment.notable_mentions && data.social_sentiment.notable_mentions.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-600 mb-2">Notable Mentions</p>
                    <ul className="space-y-1">
                      {data.social_sentiment.notable_mentions.map((mention, idx) => (
                        <li key={idx} className="text-sm text-slate-700">{mention}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Market Insights */}
          {data.market_insights && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Market Insights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.market_insights.analyst_recommendations && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Analyst Recommendations</p>
                    <p className="text-sm text-slate-900">{data.market_insights.analyst_recommendations}</p>
                  </div>
                )}
                {data.market_insights.price_targets && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Price Targets</p>
                    <p className="text-sm text-slate-900">{data.market_insights.price_targets}</p>
                  </div>
                )}
                {data.market_insights.recent_developments && data.market_insights.recent_developments.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-600 mb-2">Recent Developments</p>
                    <ul className="space-y-1">
                      {data.market_insights.recent_developments.map((dev, idx) => (
                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                          <span className="text-blue-600">•</span>
                          <span>{dev}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!data && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600">
              Click "Fetch Latest Data" to gather information from Yahoo Finance, social media, and news sources
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}