import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Loader2, Sparkles, Download, Edit2, Save, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import AIOutputBadge from "@/components/shared/AIOutputBadge";

export default function DealMemoGenerator({ opportunity, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [memo, setMemo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editedMemo, setEditedMemo] = useState("");
  const [error, setError] = useState(null);

  const generateMemo = async () => {
    setGenerating(true);
    setError(null);

    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Generate a comprehensive, professional deal memo for the following M&A opportunity:

**TARGET COMPANY:** ${opportunity.target_name}
**SECTOR:** ${opportunity.target_sector}
**DEAL TYPE:** ${opportunity.opportunity_type}

**FINANCIAL OVERVIEW:**
- Estimated Deal Value: $${opportunity.estimated_value}M
- Annual Revenue: $${opportunity.target_revenue}M
- EBITDA: $${opportunity.target_ebitda || 'Not available'}M
- Strategic Fit Score: ${opportunity.strategic_fit_score}/100
- Risk Score: ${opportunity.risk_score}/100

**STRATEGIC RATIONALE:**
${opportunity.strategic_rationale}

**KEY SYNERGIES:**
${opportunity.key_synergies?.map((s, i) => `${i + 1}. ${s}`).join('\n')}

**RISK FACTORS:**
${opportunity.risk_factors?.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**MARKET CONTEXT:**
${opportunity.market_trends?.join(', ') || 'Not specified'}

**NEWS SOURCES:**
${opportunity.news_sources?.slice(0, 3).join('\n') || 'Not available'}

Create a formal, executive-level deal memo with the following sections:

1. **EXECUTIVE SUMMARY** (2-3 paragraphs)
   - Concise overview of the opportunity
   - Key financial highlights
   - Strategic importance

2. **COMPANY OVERVIEW**
   - Target company profile
   - Market position and competitive landscape
   - Business model and key capabilities

3. **STRATEGIC RATIONALE**
   - Why this acquisition makes sense
   - Alignment with strategic priorities
   - Long-term value creation potential

4. **FINANCIAL ANALYSIS**
   - Valuation overview
   - Revenue and profitability metrics
   - Deal structure considerations

5. **SYNERGY OPPORTUNITIES**
   - Revenue synergies
   - Cost synergies
   - Strategic synergies
   - Quantified synergy estimates where possible

6. **RISK ASSESSMENT**
   - Key risks and mitigation strategies
   - Integration challenges
   - Regulatory considerations

7. **RECOMMENDATION**
   - Clear recommendation (Proceed/Do Not Proceed/Further Due Diligence)
   - Next steps
   - Timeline considerations

Format as a professional business document. Use clear headings, bullet points where appropriate, and maintain a formal yet accessible tone.`,
        add_context_from_internet: false
      });

      setMemo(result);
      setEditedMemo(result);
    } catch (err) {
      console.error("Memo generation error:", err);
      setError(err.message || "Failed to generate deal memo");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = () => {
    setMemo(editedMemo);
    setEditing(false);
  };

  const handleDownload = () => {
    const blob = new Blob([editedMemo || memo], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Deal_Memo_${opportunity.target_name.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-indigo-200 shadow-lg">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-indigo-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            AI Deal Memo Generator
            <AIOutputBadge />
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {!memo ? (
          <>
            <div className="text-center py-8">
              <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                Generate Professional Deal Memo
              </h3>
              <p className="text-slate-600 mb-6">
                AI will create a comprehensive executive summary including financial analysis, strategic rationale, synergies, and risk assessment.
              </p>
              <Button
                onClick={generateMemo}
                disabled={generating}
                className="bg-indigo-600 hover:bg-indigo-700 h-12 px-8"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating Memo...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate Deal Memo
                  </>
                )}
              </Button>
            </div>

            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-900">{error}</AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Deal Memo: {opportunity.target_name}</h3>
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <Button onClick={handleSave} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </Button>
                    <Button onClick={() => { setEditing(false); setEditedMemo(memo); }} size="sm" variant="outline">
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => setEditing(true)} size="sm" variant="outline">
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button onClick={handleDownload} size="sm" className="bg-blue-600 hover:bg-blue-700">
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </>
                )}
              </div>
            </div>

            {editing ? (
              <Textarea
                value={editedMemo}
                onChange={(e) => setEditedMemo(e.target.value)}
                className="min-h-[600px] font-mono text-sm"
              />
            ) : (
              <div className="prose prose-slate max-w-none bg-white p-6 rounded-lg border border-slate-200 max-h-[600px] overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-900 leading-relaxed">
                  {memo}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
