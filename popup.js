async function evaluateThoughtWithAI(userThought) {
  try {
    const res = await fetch(
      "https://dsa-mentor-worker.biprajit.workers.dev/evaluate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ explanation: userThought })
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
      🔒 <strong>Effort Gate Active</strong><br>
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

  const ai = await evaluateThoughtWithAI(text);

  if (ai.confidence_delta === 1 && state.confidence === "LOW")
    state.confidence = "MEDIUM";
  else if (ai.confidence_delta === 1 && state.confidence === "MEDIUM")
    state.confidence = "HIGH";
  else if (ai.confidence_delta === -1 && state.confidence === "HIGH")
    state.confidence = "MEDIUM";

  feedbackText.innerText = ai.feedback;
  state.phase = state.confidence === "HIGH" ? "REWARD" : "FEEDBACK";
  
  await saveState();
  render();
};

document.getElementById("askHint").onclick = () => {
  if (state.hintsUsed >= 3 || effortState.effortGateActive) return;

  state.hintsUsed++;
  
  // Activate effort gate in background
  chrome.runtime.sendMessage({ type: "START_EFFORT_GATE" });
  effortState.effortGateActive = true;
  effortState.effortTimeLeft = 120;
  effortState.runCount = 0;
  
  alert("Limited Hint #" + state.hintsUsed);
  
  const feedbackText = document.getElementById("feedbackText");
  feedbackText.innerText =
    "Use the hint and try implementing before asking another.";
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
  btn.onclick = () => {
    alert(btn.innerText + " unlocked");
    state.confidence = "MEDIUM";
    state.phase = "FEEDBACK";
    saveState();
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