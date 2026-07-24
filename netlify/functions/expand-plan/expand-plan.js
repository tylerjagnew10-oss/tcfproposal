// Netlify serverless function — proxies OpenAI API call for report AI expansion
// Called by report-render.html: POST /api/expand-plan
// Requires OPENAI_API_KEY in Netlify environment variables

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 200, body: JSON.stringify({ error: 'AI key not configured' }) };
  }

  try {
    const { planText, orgName, siteCount, totalResidents } = JSON.parse(event.body);

    const prompt = `You are a menu-matching implementation specialist for TCF (Textured Concept Foods), a company that produces texture-modified meals (IDDSI Levels 4, 5, 6) for aged-care facilities.

A sales rep has written a brief status update for ${orgName}, which has ${siteCount || 'multiple'} site(s) and approximately ${totalResidents || '?'} texture-modified residents.

**Rep's status update:**
${planText}

---

**CRITICAL RULES — Read these FIRST:**

1. **Detect completed items.** These signal words mean DONE: "done", "completed", "approved", "confirmed", "signed off", "agreed", "finalised", "sorted", "locked in", "went well", "successful", "already". Mark them as \`"completed": true\`.

2. **Detect pending items.** These signal words mean NOT YET DONE: "need", "needs", "pending", "next", "will", "starting", "to be", "by end of", "want to", "looking to", "plan to", "aim to", "hoping". Mark them as \`"completed": false\`.

3. **NEVER create a phase for something the rep says is already done.** If the rep says "samples done and approved", do NOT create a "Complete Sample Tasting" phase. Only list it as a completed item.

4. **If the rep mentions specific sites at different stages**, create site-specific phases instead of generic group phases.

---

**OUTPUT 1: Opening page summary (1 concise sentence, under 20 words)**
Acknowledge what is specifically done, then state the single immediate next action.

Example input: "Samples done and approved. Numbers confirmed. Now need ordering by end of month and rollout next month."
Example summary: "With sampling and numbers approved, TCF will now finalise ordering ahead of rollout commencement."

BAD example (too generic): "TCF looks forward to partnering with ${orgName}." — DO NOT output generic statements.

---

**OUTPUT 2: Implementation phases**
Create completed phases (brief summary, 1 action each) and pending phases (specific actionable steps, max 2 actions each).

Each phase object:
{
  "title": "short action name (under 30 chars)",
  "timeframe": "Event-based guide (e.g., 'Awaiting dietician approval', 'Post sample session'). DO NOT add specific timelines (e.g., 'Week 1', 'Next month') unless explicitly stated in the input.",
  "completed": true or false,
  "actions": ["action 1", "action 2"] (max 2 per phase, active voice, under 80 chars each),
  "deliverables": "concrete output (under 60 chars)" — only for pending phases
}

Aim for 1-2 completed phases (if applicable) and 2-3 pending phases. Total max 5 phases.

---

**OUTPUT 3: Next Steps closing paragraph (2-3 sentences)**
Reference the immediate next action specifically. Do NOT use generic phrases like "present to a panel" or "demonstrate the Menu Builder" unless the rep explicitly mentioned those.

---

**OUTPUT 4: Follow-up recommendation (1 sentence)**
A specific follow-up action or review checkpoint. Example: "Schedule a 4-week review meeting with kitchen managers to assess product integration."

---

Respond with ONLY this JSON object, no other text:
{
  "summary": "1 sentence, under 20 words",
  "phases": [{"title":"...","timeframe":"...","completed":true/false,"actions":["..."],"deliverables":"..."}],
  "nextSteps": "2-3 sentence tailored closing",
  "followUp": "1 sentence follow-up recommendation"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (content) {
      const cleaned = content.replace(/```json\n?|```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ error: 'No content from AI' }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
