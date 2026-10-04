import React, { useState } from "react";
import { api } from "@/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, TrendingUp, AlertTriangle, Target } from "lucide-react";

export default function RelationshipInsights({ contact, linkedCompany, opportunities }) {
  const [insights, setInsights] = useState(null);
  const queryClient = useQueryClient();

  const generateInsightsMutation = useMutation({
    mutationFn: async () => {
      const prompt = `Analyze this business relationship and provide strategic insights:

**Contact Profile:**
- Name: ${contact.full_name}
- Title: ${contact.title}
- Company: ${contact.company_name}
- Contact Type: ${contact.contact_type}
- Current Relationship Strength: ${contact.relationship_strength}
- Current Engagement Level: ${contact.engagement_level}
- Number of Interactions: ${contact.interactions?.length || 0}
- Last Interaction: ${contact.last_interaction_date || 'None'}

${linkedCompany ? `
**Linked Company Data:**
- Revenue: $${linkedCompany.revenue}M
- EBITDA: $${linkedCompany.ebitda}M
- Sector: ${linkedCompany.sector}
- Market Cap: $${linkedCompany.market_cap}M
` : ''}

${opportunities.length > 0 ? `
**Linked Deal Opportunities:**
${opportunities.map(o => `- ${o.target_name}: $${o.estimated_value}M (Strategic Fit: ${o.strategic_fit_score}, Risk: ${o.risk_score})`).join('\n')}
` : ''}

**Analysis Required:**
1. Assess relationship health (score 0-100)
2. Identify engagement improvement opportunities
3. Recommend next best actions for strengthening the relationship
4. Calculate strategic importance score (0-100) based on:
   - Decision-making authority
   - Deal influence potential
   - Network value
   - Strategic alignment
5. Flag any concerns or risks
6. Suggest optimal engagement cadence and channels

Provide actionable insights for M&A relationship management.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: {
          type: "object",
          properties: {
            relationship_health_score: { type: "number" },
            strategic_importance: { type: "number" },
            health_summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            improvement_areas: { type: "array", items: { type: "string" } },
            next_best_actions: { type: "array", items: { type: "string" } },
            engagement_recommendations: {
              type: "object",
              properties: {
                frequency: { type: "string" },
                preferred_channels: { type: "array", items: { type: "string" } },
                topics_of_interest: { type: "array", items: { type: "string" } }
              }
            },
            concerns: { type: "array", items: { type: "string" } },
            key_contact_recommendation: { type: "boolean" }
          }
        }
      });

      // Update contact with AI insights
      await api.entities.Contact.update(contact.id, {
        strategic_importance: result.strategic_importance,
        ai_insights: result.health_summary,
        key_contact: result.key_contact_recommendation
      });

      queryClient.invalidateQueries({ queryKey: ['contacts'] });

      return result;
    },
    onSuccess: (result) => {
      setInsights(result);
    },
  });

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI Relationship Insights
          </CardTitle>
          <Button
            onClick={() => generateInsightsMutation.mutate()}
            disabled={generateInsightsMutation.isPending}
            variant="outline"
            size="sm"
          >
            {generateInsightsMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : insights ? (
              'Refresh'
            ) : (
              'Generate Insights'
            )}
          </Button>
        </div>
      </CardHeader>

      {insights && (
        <CardContent className="p-6 space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="border-indigo-200 bg-indigo-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-medium text-indigo-900">Relationship Health</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-indigo-600">{insights.relationship_health_score}</p>
                  <span className="text-indigo-900">/100</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-purple-200 bg-purple-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-purple-900">Strategic Importance</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-purple-600">{insights.strategic_importance}</p>
                  <span className="text-purple-900">/100</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-blue-900">{insights.health_summary}</p>
          </div>

          {insights.key_contact_recommendation && (
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 text-amber-900">
                <AlertTriangle className="w-4 h-4" />
                <strong>Recommendation:</strong> Mark as Key Contact for proactive engagement
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="border-emerald-200 bg-emerald-50">
              <CardHeader>
                <CardTitle className="text-sm text-emerald-900">Relationship Strengths</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {insights.strengths?.map((strength, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-emerald-900">
                      <span className="text-emerald-600 mt-0.5">✓</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="text-sm text-amber-900">Improvement Areas</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {insights.improvement_areas?.map((area, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-amber-900">
                      <span className="text-amber-600 mt-0.5">→</span>
                      {area}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="border-indigo-200 bg-indigo-50">
            <CardHeader>
              <CardTitle className="text-sm text-indigo-900">Next Best Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {insights.next_best_actions?.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-indigo-900">
                    <span className="text-indigo-600 font-bold">{idx + 1}.</span>
                    {action}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {insights.engagement_recommendations && (
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-sm">Engagement Recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Recommended Frequency</p>
                  <Badge>{insights.engagement_recommendations.frequency}</Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Preferred Channels</p>
                  <div className="flex flex-wrap gap-2">
                    {insights.engagement_recommendations.preferred_channels?.map((channel, idx) => (
                      <Badge key={idx} variant="outline">{channel}</Badge>
                    ))}
                  </div>
                </div>
                {insights.engagement_recommendations.topics_of_interest?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Topics of Interest</p>
                    <div className="flex flex-wrap gap-2">
                      {insights.engagement_recommendations.topics_of_interest.map((topic, idx) => (
                        <Badge key={idx} variant="outline">{topic}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {insights.concerns && insights.concerns.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-sm text-red-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Concerns & Risks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {insights.concerns.map((concern, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-red-900">
                      <span className="text-red-600 mt-0.5">⚠</span>
                      {concern}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </CardContent>
      )}

      {!insights && !generateInsightsMutation.isPending && (
        <CardContent className="p-12 text-center">
          <Brain className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600">
            Generate AI insights to assess relationship health and get strategic recommendations
          </p>
        </CardContent>
      )}
    </Card>
  );
}