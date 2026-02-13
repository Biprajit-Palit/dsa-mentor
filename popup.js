async function evaluateThoughtWithAI(userThought, explanationHistory = []) {
  try {
    const res = await fetch(
      "https://dsa-mentor-worker.biprajit.workers.dev/evaluate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          explanation: userThought,
          explanation_history: explanationHistory
        })
      }
    );

    const data = await res.json();
    console.log("AI RESPONSE FROM BACKEND:", data);
    return data;
  } catch (err) {
    console.error("Evaluation failed", err);
    return {
      verdict: "WRONG",
      confidence_delta: 0,
      feedback: "Unable to evaluate the explanation reliably.",
      allowed_hint_types: []
    };
  }
}

async function generateHintWithAI(hintType) {
  try {
    // Get problem info from background
    const appState = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_APP_STATE" }, resolve);
    });

    const res = await fetch(
      "https://dsa-mentor-worker.biprajit.workers.dev/hint",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          hint_type: hintType,
          problem_title: appState.problemTitle,
          problem_description: appState.problemDescription,
          user_explanation: appState.userExplanation
        })
      }
    );

    const data = await res.json();
    console.log("AI HINT RESPONSE:", data);
    return data.hint || "Unable to generate hint.";
  } catch (err) {
    console.error("Hint generation failed", err);
    return "Unable to generate hint at this time.";
  }
}

/*************** UI STATE ****************/

const thinking = document.getElementById("thinking");
const input = document.getElementById("input");
const feedback = document.getElementById("feedback");
const reward = document.getElementById("reward");

let state = {
  phase: "THINKING",
  confidence: "LOW",
  hintsUsed: 0,
  skipUsed: false,
  thinkingTimeLeft: 120,
  effortGateActive: false
};

let effortState = {
  effortGateActive: false,
  effortTimeLeft: 120,
  runCount: 0
};

let timerInterval = null;

/*************** LOAD STATE ON OPEN ****************/

async function loadState() {
  return new Promise((resolve) => {
    // First check if we're on a new problem
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        resolve();
        return;
      }
      
      chrome.runtime.sendMessage({ 
        type: "CHECK_PROBLEM", 
        url: tabs[0].url 
      }, (response) => {
        if (response?.reset) {
          console.log("🆕 State reset for new problem");
        }
        
        // Load current state
        chrome.runtime.sendMessage({ type: "GET_APP_STATE" }, (appState) => {
          chrome.runtime.sendMessage({ type: "GET_EFFORT_STATE" }, (effort) => {
            if (appState) state = appState;
            if (effort) effortState = effort;
            resolve();
          });
        });
      });
    });
  });
}

async function saveState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ 
      type: "UPDATE_APP_STATE", 
      updates: state 
    }, resolve);
  });
}

/*************** THINKING TIMER ****************/

function startThinkingTimer() {
  if (timerInterval) return;

  document.getElementById("startThinking").disabled = true;
  state.phase = "THINKING";
  render();

  timerInterval = setInterval(() => {
    state.thinkingTimeLeft--;

    const m = Math.floor(state.thinkingTimeLeft / 60);
    const s = state.thinkingTimeLeft % 60;

    document.getElementById("timer").innerText =
      `Time left: ${m}:${s.toString().padStart(2, "0")}`;

    if (state.thinkingTimeLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      document.getElementById("explainBtn").classList.remove("hidden");
    }
  }, 1000);
}

/*************** RENDER ****************/

function render() {
  thinking.classList.add("hidden");
  input.classList.add("hidden");
  feedback.classList.add("hidden");
  reward.classList.add("hidden");

  if (state.phase === "THINKING") thinking.classList.remove("hidden");
  if (state.phase === "INPUT") input.classList.remove("hidden");
  if (state.phase === "FEEDBACK") feedback.classList.remove("hidden");
  if (state.phase === "REWARD") reward.classList.remove("hidden");

  document.getElementById("confidence").innerText =
    "Confidence: " + state.confidence;

  document.getElementById("hintCount").innerText =
    `Hints used: ${state.hintsUsed}/3`;

  document.getElementById("skipThinking").style.display =
    state.skipUsed ? "none" : "inline-block";

  const askHintBtn = document.getElementById("askHint");
  askHintBtn.disabled = state.hintsUsed >= 3 || effortState.effortGateActive;
  
  // Show effort gate status
  const effortStatus = document.getElementById("effortStatus");
  if (effortState.effortGateActive) {
    const m = Math.floor(effortState.effortTimeLeft / 60);
    const s = effortState.effortTimeLeft % 60;
    effortStatus.innerHTML = `
       <strong>Effort Gate Active</strong><br>
      Code for ${m}:${s.toString().padStart(2, "0")} 
      OR run code ${effortState.runCount}/2 times
    `;
    effortStatus.classList.remove("hidden");
  } else {
    effortStatus.classList.add("hidden");
  }
}

/*************** EVENTS ****************/

document.getElementById("startThinking").onclick = () => {
  startThinkingTimer();
  saveState();
};

document.getElementById("skipThinking").onclick = () => {
  if (state.skipUsed) return;
  state.skipUsed = true;
  clearInterval(timerInterval);
  state.phase = "INPUT";
  saveState();
  render();
};

document.getElementById("explainBtn").onclick = () => {
  state.phase = "INPUT";
  saveState();
  render();
};

document.getElementById("submitThought").onclick = async () => {
  const text = document.getElementById("thoughtInput").value;
  const feedbackText = document.getElementById("feedbackText");

  feedbackText.innerText = "Evaluating your approach...";
  state.phase = "FEEDBACK";
  render();

  // Get current explanation history from background
  const appState = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_APP_STATE" }, resolve);
  });
  
  const explanationHistory = appState.explanationHistory || [];
  
  // Evaluate with history to check for duplicates
  const ai = await evaluateThoughtWithAI(text, explanationHistory);

  // If not a duplicate, add to history and update state
  if (ai.verdict !== "DUPLICATE") {
    explanationHistory.push(text);
    
    // Store user's explanation for hint context and add to history
    chrome.runtime.sendMessage({ 
      type: "UPDATE_APP_STATE", 
      updates: { 
        userExplanation: text,
        explanationHistory: explanationHistory
      }
    });

    // Update confidence based on AI response
    if (ai.confidence_delta === 1 && state.confidence === "LOW")
      state.confidence = "MEDIUM";
    else if (ai.confidence_delta === 1 && state.confidence === "MEDIUM")
      state.confidence = "HIGH";
    else if (ai.confidence_delta === -1 && state.confidence === "HIGH")
      state.confidence = "MEDIUM";
  }

  feedbackText.innerText = ai.feedback;
  state.phase = state.confidence === "HIGH" ? "REWARD" : "FEEDBACK";
  
  await saveState();
  render();
};

document.getElementById("askHint").onclick = async () => {
  if (state.hintsUsed >= 3 || effortState.effortGateActive) return;

  console.log("🎁 Hint requested. Activating effort gate...");
  
  const feedbackText = document.getElementById("feedbackText");
  feedbackText.innerText = "Generating hint...";
  
  // Get current state to check used hint types
  const appState = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_APP_STATE" }, resolve);
  });
  
  const usedHintTypes = appState.usedHintTypes || [];
  
  // Filter out already used hint types
  const allHintTypes = ["Structural Hint", "Pseudo Logic", "Edge Cases", "Complexity"];
  const availableHintTypes = allHintTypes.filter(type => !usedHintTypes.includes(type));
  
  // If all types used, show error
  if (availableHintTypes.length === 0) {
    feedbackText.innerHTML = `<strong>⚠️ All hint types already used!</strong><br><br>You've received all 4 types of hints. Try implementing what you've learned.`;
    return;
  }
  
  // Pick random from available types
  const randomHint = availableHintTypes[Math.floor(Math.random() * availableHintTypes.length)];
  
  state.hintsUsed++;
  
  const hint = await generateHintWithAI(randomHint);
  
  // Add this hint type to used list
  usedHintTypes.push(randomHint);
  chrome.runtime.sendMessage({ 
    type: "UPDATE_APP_STATE", 
    updates: { usedHintTypes }
  });
  
  // Activate effort gate in background
  chrome.runtime.sendMessage({ type: "START_EFFORT_GATE" }, (response) => {
    console.log("✅ Effort gate activation response:", response);
  });
  
  effortState.effortGateActive = true;
  effortState.effortTimeLeft = 120;
  effortState.runCount = 0;
  
  feedbackText.innerHTML = `<strong>💡 Hint #${state.hintsUsed}: ${randomHint}</strong><br><br>${hint}<br><br><em>Use the hint and implement before asking another.</em>`;
  state.phase = "FEEDBACK";
  
  saveState();
  render();
};

document.getElementById("reviseThought").onclick = () => {
  state.phase = "INPUT";
  saveState();
  render();
};

document.querySelectorAll(".rewardOption").forEach(btn => {
  btn.onclick = async () => {
    const hintType = btn.innerText; // "Structural Hint", "Pseudo Logic", etc.
    
    // Check if this hint type was already used
    const appState = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_APP_STATE" }, resolve);
    });
    
    const usedHintTypes = appState.usedHintTypes || [];
    
    if (usedHintTypes.includes(hintType)) {
      alert(`⚠️ You already received a "${hintType}" hint! Choose a different type.`);
      return;
    }
    
    btn.disabled = true;
    btn.innerText = "Generating...";
    
    const hint = await generateHintWithAI(hintType);
    
    // Add to used hint types
    usedHintTypes.push(hintType);
    chrome.runtime.sendMessage({ 
      type: "UPDATE_APP_STATE", 
      updates: { usedHintTypes }
    });
    
    // Show hint in feedback section
    const feedbackText = document.getElementById("feedbackText");
    feedbackText.innerHTML = `<strong>🎁 ${hintType}</strong><br><br>${hint}`;
    
    state.confidence = "MEDIUM";
    state.phase = "FEEDBACK";
    
    await saveState();
    render();
  };
});

/*************** LISTEN FOR BACKGROUND UPDATES ****************/

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "EFFORT_UNLOCKED") {
    effortState.effortGateActive = false;
    alert("✅ Effort gate unlocked! You can ask another hint.");
    render();
  }
  
  if (msg.type === "EFFORT_TIMER_UPDATE") {
    effortState.effortTimeLeft = msg.timeLeft;
    render();
  }
  
  if (msg.type === "RUN_COUNT_UPDATE") {
    effortState.runCount = msg.runCount;
    render();
  }
});

/*************** INIT ****************/
(async () => {
  await loadState();
  render();
})();
/*************** HIDDEN ADMIN RESET (Ctrl+Shift+R) ****************/

document.addEventListener("keydown", (e) => {
  // Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "R") {
    e.preventDefault();
    
    // Confirm before resetting
    const confirmed = confirm("🔧 ADMIN: Reset this problem's state?");
    
    if (confirmed) {
      // Reset to fresh state
      state = {
        phase: "THINKING",
        confidence: "LOW",
        hintsUsed: 0,
        skipUsed: false,
        thinkingTimeLeft: 120
      };
      
      effortState = {
        effortGateActive: false,
        effortTimeLeft: 120,
        runCount: 0
      };
      
      // Clear timer
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      
      // Update background
      chrome.runtime.sendMessage({ 
        type: "UPDATE_APP_STATE", 
        updates: { 
          phase: "THINKING",
          confidence: "LOW",
          hintsUsed: 0,
          skipUsed: false,
          thinkingTimeLeft: 120,
          userExplanation: "",
          lastAttemptTimestamp: null,
          explanationHistory: [], // Clear history on manual reset
          usedHintTypes: [] // Clear used hint types
        }
      });
      
      console.log("🔧 ADMIN RESET: State cleared");
      alert("✅ State reset! Problem is fresh.");
      render();
    }
  }
});