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
        const { explanation, explanation_history } = await request.json();

        // Check for duplicate/similar explanations
        if (explanation_history && explanation_history.length > 0) {
          const similarity = checkSimilarity(explanation, explanation_history);
          
          if (similarity.isDuplicate) {
            return new Response(JSON.stringify({
              verdict: "DUPLICATE",
              confidence_delta: 0,
              feedback: `You've already explained something very similar${similarity.previousIndex !== undefined ? ' in attempt #' + (similarity.previousIndex + 1) : ''}. Try a different approach or add more details.`,
              allowed_hint_types: []
            }), {
              headers: {
                ...corsHeaders(),
                "Content-Type": "application/json"
              }
            });
          }
        }

        const systemPrompt = `
You are a strict evaluator for a coding mentor tool.

Rules:
- Evaluate reasoning quality, not code.
- If the user provides nonsense, gibberish, or irrelevant text, mark as WRONG with feedback explaining they need to describe their problem-solving approach.
- If the user provides a valid approach (even if incorrect), evaluate it constructively.
- Do NOT give solutions.
- Respond ONLY in valid JSON.
- Be concise but helpful.

JSON format:
{
  "verdict": "CORRECT | PARTIAL | WRONG",
  "confidence_delta": -1 | 0 | 1,
  "feedback": "short helpful sentence",
  "allowed_hint_types": []
}

Examples:
- Input: "hello" → {"verdict": "WRONG", "confidence_delta": 0, "feedback": "Please describe your problem-solving approach, not just a greeting.", "allowed_hint_types": []}
- Input: "I'll use a hash map to store seen values" → Evaluate the approach quality
`;

        const groqRes = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: explanation }
              ],
              temperature: 0.2
            })
          }
        );

        if (!groqRes.ok) {
          const errorText = await groqRes.text();
          console.error("Groq API error:", groqRes.status, errorText);
          return new Response(JSON.stringify({
            verdict: "WRONG",
            confidence_delta: 0,
            feedback: `Groq API error: ${groqRes.status}. Check your API key.`,
            allowed_hint_types: []
          }), {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }

        const data = await groqRes.json();
        
        if (!data.choices || !data.choices[0]) {
          console.error("Invalid Groq response:", data);
          return new Response(JSON.stringify({
            verdict: "WRONG",
            confidence_delta: 0,
            feedback: "Groq returned invalid response. Check API configuration.",
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
You are a DSA mentor. Generate ONE specific hint for this problem. DO NOT explain what the hint type means - just give the actual hint.

Problem: ${problem_title}
Description: ${problem_description?.substring(0, 800)}
User's approach: ${user_explanation || "Not yet provided"}

HINT TYPE: ${hint_type}

RULES FOR EACH TYPE:

${hint_type === "Structural Hint" ? `
Give a SPECIFIC data structure or pattern suggestion for THIS problem.
✅ Good: "A hash map can help you find the complement in O(1) time."
❌ Bad: "Consider using a data structure to improve efficiency."
Focus on WHAT data structure, not why or how to use it.
` : ''}

${hint_type === "Pseudo Logic" ? `
Describe a KEY INSIGHT about the approach for THIS problem.
✅ Good: "As you traverse the list, you need to track the difference between target and current value."
❌ Bad: "Think about what you need to remember while iterating."
Give a conceptual nudge, not implementation steps.
` : ''}

${hint_type === "Edge Cases" ? `
Point out a SPECIFIC edge case for THIS problem.
✅ Good: "What happens when there are duplicate numbers in the array?"
❌ Bad: "Consider edge cases that might break your solution."
Ask about the specific scenario, don't explain how to handle it.
` : ''}

${hint_type === "Complexity" ? `
Give a SPECIFIC complexity target or trade-off for THIS problem.
✅ Good: "You can solve this in O(n) time using O(n) extra space."
❌ Bad: "Think about time vs space trade-offs."
State the achievable complexity, not the technique.
` : ''}

Generate 1-2 SHORT sentences. Be SPECIFIC to this exact problem. No meta-explanations.
`;

        const groqRes = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Generate a ${hint_type} for: ${problem_title}` }
              ],
              temperature: 0.8,
              max_tokens: 100
            })
          }
        );

        if (!groqRes.ok) {
          const errorText = await groqRes.text();
          console.error("Groq API error:", groqRes.status, errorText);
          return new Response(JSON.stringify({
            hint: `Groq API error: ${groqRes.status}. Check your API key.`
          }), {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "application/json"
            }
          });
        }

        const data = await groqRes.json();
        
        if (!data.choices || !data.choices[0]) {
          console.error("Invalid Groq response:", data);
          return new Response(JSON.stringify({
            hint: "Groq returned invalid response. Check API configuration."
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

// Helper function to check if explanation is too similar to previous ones
function checkSimilarity(newExplanation, previousExplanations) {
  console.log("🔍 Checking similarity...");
  console.log("New explanation:", newExplanation);
  console.log("Previous count:", previousExplanations.length);
  
  const normalize = (text) => text.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const newNorm = normalize(newExplanation);
  
  // ULTRA STRICT: Check for ANY technical term overlap
  const techTerms = ['hash', 'hashmap', 'map', 'dict', 'dictionary', 'set', 'array', 'list', 'linkedlist', 'tree', 'bst', 'graph', 'stack', 'queue', 'heap', 'priorityqueue', 'pointer', 'pointers', 'trie', 'sort', 'sorting', 'search', 'searching', 'binary', 'dfs', 'bfs', 'dp', 'dynamic', 'programming', 'greedy', 'sliding', 'window', 'two', 'divide', 'conquer', 'recursion', 'recursive', 'iteration', 'iterative', 'backtrack', 'backtracking', 'memoization', 'tabulation', 'prefix', 'suffix', 'inorder', 'preorder', 'postorder', 'level', 'breadth', 'depth'];
  
  // Check if explanation contains any tech terms
  const getTechTermsInText = (text) => {
    const terms = [];
    for (const term of techTerms) {
      if (text.includes(term)) {
        terms.push(term);
      }
    }
    return terms;
  };
  
  const newTechTerms = getTechTermsInText(newNorm);
  console.log("Tech terms in new:", newTechTerms);
  
  // Compare with each previous explanation
  for (let i = 0; i < previousExplanations.length; i++) {
    const prevNorm = normalize(previousExplanations[i]);
    const prevTechTerms = getTechTermsInText(prevNorm);
    
    console.log(`Comparing with previous #${i + 1}:`, previousExplanations[i].substring(0, 50));
    console.log("Tech terms in previous:", prevTechTerms);
    
    // If BOTH have tech terms and ANY overlap, it's a duplicate
    if (newTechTerms.length > 0 && prevTechTerms.length > 0) {
      const commonTech = newTechTerms.filter(term => prevTechTerms.includes(term));
      
      if (commonTech.length > 0) {
        console.log("❌ DUPLICATE DETECTED! Common tech:", commonTech);
        return { 
          isDuplicate: true, 
          previousIndex: i,
          reason: `Same technique detected: ${commonTech.join(', ')}`
        };
      }
    }
    
    // Also check for general word overlap (for non-technical similar explanations)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'use', 'using', 'used', 'need', 'needs', 'needed', 'think', 'thinking', 'thought', 'approach', 'solution', 'problem', 'try', 'trying', 'tried', 'make', 'making', 'made', 'get', 'getting', 'got', 'find', 'finding', 'found', 'want', 'wanted', 'then', 'first', 'next', 'last', 'also', 'just', 'now', 'know', 'here', 'there', 'when', 'where', 'what', 'which', 'who', 'how', 'why', 'if', 'so', 'because', 'since', 'while']);
    
    const getKeywords = (text) => {
      return text.split(/\s+/).filter(word => word.length > 3 && !stopWords.has(word));
    };
    
    const newWords = getKeywords(newNorm);
    const prevWords = getKeywords(prevNorm);
    
    // Count common meaningful words
    const commonWords = newWords.filter(word => prevWords.includes(word));
    
    console.log("Common words:", commonWords, `(${commonWords.length} total)`);
    
    // If 3+ common words (stricter than before), flag as duplicate
    if (commonWords.length >= 3) {
      console.log("❌ DUPLICATE DETECTED! Too many common words");
      return {
        isDuplicate: true,
        previousIndex: i,
        reason: `Similar wording detected`
      };
    }
  }
  
  console.log("✅ NOT a duplicate");
  return { isDuplicate: false };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}