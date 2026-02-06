// ---------- EDITOR TYPING (throttled) ----------
let typingCooldown = false;

document.addEventListener("keydown", () => {
  if (typingCooldown) return;

  typingCooldown = true;
  chrome.runtime.sendMessage({ type: "EDITOR_TYPING" });

  setTimeout(() => {
    typingCooldown = false;
  }, 1000); // at most once per second
});

// ---------- PROBLEM EXTRACTION ----------
function extractProblemInfo() {
  // Try to find problem title
  const titleElement = document.querySelector('[data-cy="question-title"]') || 
                       document.querySelector('div[class*="title"]') ||
                       document.querySelector('h1');
  
  // Try to find problem description
  const descElement = document.querySelector('[class*="elfjS"]') || // LeetCode's description class
                      document.querySelector('[data-track-load="description_content"]') ||
                      document.querySelector('.question-content');
  
  const title = titleElement?.innerText?.trim() || "Unknown Problem";
  const description = descElement?.innerText?.trim().substring(0, 1500) || ""; // Limit length
  
  console.log("📝 Extracted problem:", title);
  
  return { title, description };
}

// Send problem info to background when page loads
setTimeout(() => {
  const problemInfo = extractProblemInfo();
  chrome.runtime.sendMessage({ 
    type: "PROBLEM_INFO", 
    ...problemInfo 
  });
}, 2000); // Wait for LeetCode to load

// ---------- RUN BUTTON DETECTION ----------
const attachedButtons = new WeakSet();

function attachRunListener() {
  const buttons = document.querySelectorAll("button");

  buttons.forEach(btn => {
    // Skip if already attached
    if (attachedButtons.has(btn)) return;

    const text = btn.innerText || btn.textContent || "";
    const lowerText = text.toLowerCase().trim();
    
    // Check for "Run", "Run Code", etc.
    // Also check data attributes that LeetCode might use
    const isRunButton = 
      lowerText.includes("run") || 
      btn.getAttribute("data-e2e-locator")?.includes("console-run") ||
      btn.className?.includes("run");

    if (isRunButton) {
      attachedButtons.add(btn);
      
      console.log("✅ DSA Mentor: Run button detected:", text);

      btn.addEventListener("click", () => {
        console.log("🔥 DSA Mentor: Run button clicked!");
        chrome.runtime.sendMessage({ type: "RUN_CLICK" });
      }, true); // Use capture phase to catch it early
    }
  });
}

// More aggressive detection
setInterval(attachRunListener, 1000);

// Also listen for any button clicks as fallback
document.addEventListener("click", (e) => {
  const target = e.target.closest("button");
  if (!target) return;
  
  const text = (target.innerText || target.textContent || "").toLowerCase();
  
  // Fallback detection for Run button
  if (text.includes("run") && !text.includes("submit")) {
    console.log("🔥 DSA Mentor: Run detected via click fallback");
    chrome.runtime.sendMessage({ type: "RUN_CLICK" });
  }
}, true);