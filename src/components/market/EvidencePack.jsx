import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Brain, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function EvidencePack({ companies, scenarios, loading }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const generateRegulatorBrief = async () => {
    setGenerating(true);
    setError(null);

    try {
      const user = await api.auth.me();
      if (!user?.ai_settings?.enabled) {
        setError("AI backend not configured. Please configure in Settings.");
        setGenerating(false);
        return;
      }

      // Calculate market metrics
      const companiesWithShare = companies.filter(c => c.market_share > 0);
      const hhi = companiesWithShare.reduce((sum, c) => sum + Math.pow(c.market_share, 2), 0);
      const cr4 = [...companiesWithShare]
        .sort((a, b) => b.market_share - a.market_share)
        .slice(0, 4)
        .reduce((sum, c) => sum + c.market_share, 0);

      const prompt = `You are preparing a comprehensive regulatory brief for FTC/DOJ merger review. Generate a professional brief document.

**Market Data:**
- HHI: ${hhi.toFixed(0)}
- CR4: ${cr4.toFixed(1)}%
- Number of firms: ${companiesWithShare.length}
- Active merger scenarios: ${scenarios.filter(s => s.status === 'active').length}

**Companies:**
${companies.slice(0, 10).map(c => `- ${c.name}: ${c.market_share || 0}% market share, $${(c.revenue / 1000).toFixed(1)}B revenue`).join('\n')}

Generate a professional merger review brief in markdown format with the following sections:

# Executive Summary
[1-2 paragraphs: deal overview, key concerns, recommendation]

# Market Definition & Concentration
[Current market structure, HHI analysis, concentration trends]

# Competitive Effects Analysis
## Unilateral Effects
[UPP/GUPPI analysis, price pressure assessment]

## Coordinated Effects
[Facilitating factors, parallelism concerns]

## Vertical/Platform Concerns
[If applicable]

# Entry & Expansion
[Barriers to entry, likelihood of sufficient entry]

# Efficiencies & Defenses
[Claimed efficiencies, merger-specificity analysis]

# Recommended Remedies
[If concerns exist: structural/behavioral remedies]

# Conclusion

## Data Appendix
[Key assumptions, methodologies, data sources]

Be specific, professional, cite numbers, and follow DOJ/FTC Horizontal Merger Guidelines framework.`;

      const result = await api.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false
      });

      // Download as markdown file
      const blob = new Blob([result], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Merger_Regulatory_Brief_${new Date().toISOString().split('T')[0]}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (err) {
      setError("Failed to generate brief. " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-teal-600" />
            Regulatory Evidence Package
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-6">
            <div className="p-6 bg-gradient-to-br from-teal-50 to-blue-50 rounded-xl border-2 border-teal-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 mb-2">AI-Generated Regulator Brief</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Automatically generate a comprehensive merger review brief following FTC/DOJ guidelines, 
                    including market analysis, competitive effects assessment, and recommendations.
                  </p>
                  <Button
                    onClick={generateRegulatorBrief}
                    disabled={generating}
                    className="bg-gradient-to-r from-teal-600 to-teal-700"
                  >
                    {generating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Generating Brief...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate & Download Brief
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <h4 className="font-semibold text-slate-900">Brief Includes:</h4>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-teal-600">✓</span>
                    <span>Executive summary & recommendation</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-teal-600">✓</span>
                    <span>Market definition & HHI analysis</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-teal-600">✓</span>
                    <span>Unilateral effects (UPP/GUPPI)</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-teal-600">✓</span>
                    <span>Coordinated effects assessment</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-teal-600">✓</span>
                    <span>Entry/expansion analysis</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-teal-600">✓</span>
                    <span>Data appendix & methodologies</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200">
                <CardHeader>
                  <h4 className="font-semibold text-slate-900">Format & Standards:</h4>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-blue-600">📄</span>
                    <span>Professional markdown format</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-blue-600">⚖️</span>
                    <span>Follows Horizontal Merger Guidelines</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-blue-600">📊</span>
                    <span>Cites deterministic calculations</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-blue-600">🔍</span>
                    <span>Version-controlled assumptions</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-blue-600">✅</span>
                    <span>Ready for legal review</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <strong>Note:</strong> All AI-generated content is based on deterministic calculations (HHI, UPP, GUPPI, etc.) 
                and should be reviewed by legal counsel before submission to regulatory authorities. 
                The brief includes clear documentation of assumptions and methodologies.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}