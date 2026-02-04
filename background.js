// Persistent state stored in chrome.storage
let effortState = {
  effortGateActive: false,
  effortTimeLeft: 120,
  runCount: 0
};

let appState = {
  phase: "THINKING",
  confidence: "LOW",
  hintsUsed: 0,
  skipUsed: false,
  thinkingTimeLeft: 120,
  currentProblem: null // Track which problem we're on
};

let effortInterval = null;

// Load state on startup
chrome.storage.local.get(['effortState', 'appState'], (result) => {
  if (result.effortState) effortState = result.effortState;
  if (result.appState) appState = result.appState;
  
  // Resume effort timer if it was active
  if (effortState.effortGateActive) {
    startEffortTimer();
  }
});

// Helper to extract problem slug from URL
function getProblemSlug(url) {
  const match = url.match(/leetcode\.com\/problems\/([^\/]+)/);
  return match ? match[1] : null;
}

function saveState() {
  chrome.storage.local.set({ effortState, appState });
}

function startEffortTimer() {
  if (effortInterval) return;

  effortInterval = setInterval(() => {
    if (!effortState.effortGateActive) {
      clearInterval(effortInterval);
      effortInterval = null;
      return;
    }

    effortState.effortTimeLeft--;
    saveState(); // Persist state

    // Notify popup of timer update
    chrome.runtime.sendMessage({ 
      type: "EFFORT_TIMER_UPDATE", 
      timeLeft: effortState.effortTimeLeft 
    }).catch(() => {}); // Ignore if popup is closed

    if (effortState.effortTimeLeft <= 0) {
      unlockEffortGate();
    }
  }, 1000);
}

function unlockEffortGate() {
  effortState.effortGateActive = false;
  effortState.effortTimeLeft = 120;
  effortState.runCount = 0;
  saveState();

  chrome.runtime.sendMessage({ type: "EFFORT_UNLOCKED" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("📨 Background received:", msg.type, msg);
  
  // From content.js
  if (msg.type === "EDITOR_TYPING" && effortState.effortGateActive) {
    console.log("⌨️ Typing detected, starting timer");
    startEffortTimer();
  }

  if (msg.type === "RUN_CLICK") {
    console.log("🏃 RUN_CLICK received. Gate active?", effortState.effortGateActive, "Count:", effortState.runCount);
    
    if (effortState.effortGateActive) {
      effortState.runCount++;
      saveState();
      
      console.log("✅ Run count increased to:", effortState.runCount);
      
      // Notify popup
      chrome.runtime.sendMessage({ 
        type: "RUN_COUNT_UPDATE", 
        runCount: effortState.runCount 
      }).catch(() => {});
      
      if (effortState.runCount >= 2) {
        console.log("🎉 2 runs reached! Unlocking gate");
        unlockEffortGate();
      }
    } else {
      console.log("⚠️ Effort gate not active, ignoring run click");
    }
  }

  // From popup.js
  if (msg.type === "START_EFFORT_GATE") {
    console.log("🔒 START_EFFORT_GATE received");
    effortState.effortGateActive = true;
    effortState.effortTimeLeft = 120;
    effortState.runCount = 0;
    saveState();
    startEffortTimer();
    console.log("✅ Effort gate activated:", effortState);
    sendResponse({ success: true });
  }

  if (msg.type === "GET_EFFORT_STATE") {
    sendResponse(effortState);
  }

  if (msg.type === "GET_APP_STATE") {
    sendResponse(appState);
  }

  if (msg.type === "UPDATE_APP_STATE") {
    appState = { ...appState, ...msg.updates };
    saveState();
    sendResponse({ success: true });
  }

  // Check if problem changed - reset state if needed
  if (msg.type === "CHECK_PROBLEM") {
    const newProblem = getProblemSlug(msg.url);
    
    if (newProblem && newProblem !== appState.currentProblem) {
      // New problem detected - reset state
      console.log(`🔄 New problem detected: ${newProblem}`);
      
      appState = {
        phase: "THINKING",
        confidence: "LOW",
        hintsUsed: 0,
        skipUsed: false,
        thinkingTimeLeft: 120,
        currentProblem: newProblem
      };
      
      effortState = {
        effortGateActive: false,
        effortTimeLeft: 120,
        runCount: 0
      };
      
      saveState();
      sendResponse({ reset: true, problem: newProblem });
    } else {
      sendResponse({ reset: false, problem: newProblem });
    }
  }

  return true;
});