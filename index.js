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

        if (!openaiRes.ok) {
          const errorText = await openaiRes.text();
          console.error("OpenAI API error:", openaiRes.status, errorText);
          return new Response(JSON.stringify({
            verdict: "WRONG",
            confidence_delta: 0,
            feedback: `OpenAI API error: ${openaiRes.status}. Check your API key and credits.`,
            allowed_hint_types: []
          }), {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }

        const data = await openaiRes.json();
        
        if (!data.choices || !data.choices[0]) {
          console.error("Invalid OpenAI response:", data);
          return new Response(JSON.stringify({
            verdict: "WRONG",
            confidence_delta: 0,
            feedback: "OpenAI returned invalid response. Check API configuration.",
            allowed_hint_types: []
          }), {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }
        
        let raw = data.choices[0].message.content;

        // Clean and validate JSON
        raw = raw.replace(/```json|```/g, "").trim();
        
        // Try to parse and validate
        try {
          const parsed = JSON.parse(raw);
          
          // Ensure required fields exist
          if (!parsed.feedback) {
            parsed.feedback = "Evaluation completed.";
          }
          if (parsed.verdict === undefined) {
            parsed.verdict = "PARTIAL";
          }
          if (parsed.confidence_delta === undefined) {
            parsed.confidence_delta = 0;
          }
          if (!parsed.allowed_hint_types) {
            parsed.allowed_hint_types = [];
          }
          
          return new Response(JSON.stringify(parsed), {
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        } catch (parseErr) {
          // If parsing fails, return a safe default
          console.error("JSON parse error:", parseErr, "Raw:", raw);
          return new Response(JSON.stringify({
            verdict: "PARTIAL",
            confidence_delta: 0,
            feedback: "Evaluation completed but response format was invalid.",
            allowed_hint_types: []
          }), {
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }
      }

      // ---------- /hint ----------
      if (url.pathname === "/hint" && request.method === "POST") {
        const { hint_type, problem_title, problem_description, user_explanation } = await request.json();

        const systemPrompt = `
You are a DSA mentor providing ORTHOGONAL hints. Your goal is to guide thinking WITHOUT giving away the solution.

CRITICAL RULES:
- NEVER provide code or pseudocode
- NEVER reveal the complete algorithm
- Each hint type provides a DIFFERENT angle of understanding
- Hints are NON-PROGRESSIVE (they don't build toward a solution)
- Keep hints to 2-3 sentences maximum
- Be specific to THIS problem, not generic

Problem: ${problem_title}
Description: ${problem_description?.substring(0, 500)}
User's approach so far: ${user_explanation || "Not provided yet"}

Hint type requested: ${hint_type}

HINT TYPE GUIDELINES:

Structural Hint:
- Suggest a data structure or high-level pattern
- Example: "Consider using a hash map to track seen values"
- DON'T reveal the complete traversal strategy

Pseudo Logic:
- Describe a conceptual flow WITHOUT implementation details
- Example: "Think about what you need to remember as you iterate"
- DON'T provide step-by-step pseudocode

Edge Cases:
- Point out special scenarios the solution must handle
- Example: "What happens when the array has duplicate values?"
- DON'T explain how to handle them

Complexity:
- Discuss time/space trade-offs
- Example: "You can achieve O(n) time if you use O(n) extra space"
- DON'T reveal which data structure achieves this

Generate a focused, orthogonal hint based on the type requested.
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
                { role: "user", content: `Give me a ${hint_type}` }
              ],
              temperature: 0.7,
              max_tokens: 150
            })
          }
        );

        if (!openaiRes.ok) {
          const errorText = await openaiRes.text();
          console.error("OpenAI API error:", openaiRes.status, errorText);
          return new Response(JSON.stringify({
            hint: `OpenAI API error: ${openaiRes.status}. Check your API key and credits.`
          }), {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }

        const data = await openaiRes.json();
        
        if (!data.choices || !data.choices[0]) {
          console.error("Invalid OpenAI response:", data);
          return new Response(JSON.stringify({
            hint: "OpenAI returned invalid response. Check API configuration."
          }), {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }
        
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