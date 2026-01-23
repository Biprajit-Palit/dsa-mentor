async function evaluateThoughtWithAI(userThought) {
  try {
    const response = await fetch(
      "https://dsa-mentor-worker.biprajit.workers.dev",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Evaluate explanation" },
            { role: "user", content: userThought }
          ]
        })
      }
    );

    const data = await response.json();

    if (
      !data ||
      !data.choices ||
      !data.choices[0] ||
      !data.choices[0].message ||
      !data.choices[0].message.content
    ) {
      throw new Error("Invalid AI response shape");
    }

    const raw = data.choices[0].message.content;
    return JSON.parse(raw);

  } catch (err) {
    console.error("AI evaluation failed:", err);
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

let timerInterval = null;

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

  document.getElementById("askHint").disabled =
    state.hintsUsed >= 3 || state.effortGateActive;

  if (state.phase === "FEEDBACK" && state.effortGateActive) {
    document.getElementById("feedbackText").innerText =
      "Use the hint and try implementing before asking another.";
  }
}

/*************** EVENTS ****************/

document.getElementById("startThinking").onclick = startThinkingTimer;

document.getElementById("skipThinking").onclick = () => {
  if (state.skipUsed) return;
  state.skipUsed = true;
  clearInterval(timerInterval);
  state.phase = "INPUT";
  render();
};

document.getElementById("explainBtn").onclick = () => {
  state.phase = "INPUT";
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
  render();
};

document.getElementById("askHint").onclick = () => {
  if (state.hintsUsed >= 3) return;

  state.hintsUsed++;
  state.effortGateActive = true;
  alert("Limited Hint #" + state.hintsUsed);
  state.phase = "FEEDBACK";
  render();
};

document.getElementById("reviseThought").onclick = () => {
  state.phase = "INPUT";
  render();
};

document.querySelectorAll(".rewardOption").forEach(btn => {
  btn.onclick = () => {
    alert(btn.innerText + " unlocked");
    state.confidence = "MEDIUM";
    state.phase = "FEEDBACK";
    render();
  };
});

/*************** INIT ****************/
render();
