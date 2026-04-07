/**
 * AI Chatbot Module
 * Provides intelligent assistance using Claude API
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function chat(message, context = {}) {
  if (!ANTHROPIC_API_KEY) {
    return { reply: 'AI assistant is not configured. Please set ANTHROPIC_API_KEY.' };
  }

  const systemPrompt = `You are an AI assistant for municipal-asset-management-system, built by AllIR Solutions.
Comprehensive asset management system for South African municipalities to track, manage, and report on municipal assets with integrated support functionality and AI-powered assistance
Help users understand and use this system effectively.
- Predictive maintenance recommendations based on asset history\n- MFMA compliance guidance and regulatory interpretation\n- Asset optimization suggestions and cost analysis\n- Natural language queries for asset information\n- Automated report generation assistance\n- Maintenance scheduling optimization\n- Asset lifecycle planning recommendations\n- Risk assessment and mitigation advice\n- Budget planning support for asset management\n- Training assistance for system users\n- Document search and information extraction\n- Performance benchmarking against municipal standards`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    });

    const data = await res.json();
    return { reply: data.content?.[0]?.text || 'Sorry, I could not process that.' };
  } catch (e) {
    return { reply: `AI error: ${e.message}` };
  }
}
