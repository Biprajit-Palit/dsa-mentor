export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------- CORS ----------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    try {
      // ---------- /evaluate ----------
      if (url.pathname === "/evaluate" && request.method === "POST") {
        const { explanation } = await request.json();

        const systemPrompt = `
You are a strict evaluator for a coding mentor tool.

Rules:
- Evaluate reasoning quality, not code.
- Do NOT give solutions.
- Respond ONLY in valid JSON.
- Be concise.

JSON format:
{
  "verdict": "CORRECT | PARTIAL | WRONG",
  "confidence_delta": -1 | 0 | 1,
  "feedback": "short sentence",
  "allowed_hint_types": []
}
`;

        const openaiRes = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: explanation }
              ],
              temperature: 0.2
            })
          }
        );

        const data = await openaiRes.json();
        let raw = data.choices[0].message.content;

        raw = raw.replace(/```json|```/g, "").trim();

        return new Response(raw, {
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json"
          }
        });
      }

      // ---------- /hint ----------
      if (url.pathname === "/hint" && request.method === "POST") {
        const { hint_type } = await request.json();

        const systemPrompt = `
You generate ONLY hints, never solutions.

Hint type: ${hint_type}

Rules:
- Be orthogonal (do not stack toward solution)
- No code
- No final logic
- 1–2 sentences max
`;

        const openaiRes = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "system", content: systemPrompt }],
              temperature: 0.4
            })
          }
        );

        const data = await openaiRes.json();
        const hint = data.choices[0].message.content.trim();

        return new Response(
          JSON.stringify({ hint }),
          {
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          }
        );
      }

      // ---------- fallback ----------
      return new Response(
        JSON.stringify({ error: "Not Found" }),
        {
          status: 404,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json"
          }
        }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        {
          status: 500,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json"
          }
        }
      );
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
