// ============================================
// CONFIGURATION - Adjust reset period here
// ============================================
const RESET_AFTER_DAYS = 1; // Reset state after 1 day (change to 7 for weekly, etc.)

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
  currentProblem: null, 
  problemTitle: "",
  problemDescription: "",
  userExplanation: "", 
  lastAttemptTimestamp: null, 
  explanationHistory: [], // Added missing comma
  usedHintTypes: [] 
};

let effortInterval = null;

// Load state on startup
chrome.storage.local.get(['effortState', 'appState'], (result) => {
  if (result.effortState) effortState = result.effortState;
  if (result.appState) appState = result.appState;
  
  if (effortState.effortGateActive) {
    startEffortTimer();
  }
});

function getProblemSlug(url) {
  const match = url.match(/leetcode\.com\/problems\/([^\/]+)/);
  return match ? match[1] : null;
}

function shouldResetByTime(lastTimestamp) {
  if (!lastTimestamp) return true; 
  
  const now = Date.now();
  const daysSince = (now - lastTimestamp) / (1000 * 60 * 60 * 24);
  
  return daysSince >= RESET_AFTER_DAYS;
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
    saveState(); 

    chrome.runtime.sendMessage({ 
      type: "EFFORT_TIMER_UPDATE", 
      timeLeft: effortState.effortTimeLeft 
    }).catch(() => {}); 

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
  
  if (msg.type === "EDITOR_TYPING" && effortState.effortGateActive) {
    startEffortTimer();
  }

  if (msg.type === "RUN_CLICK") {
    if (effortState.effortGateActive) {
      effortState.runCount++;
      saveState();
      
      chrome.runtime.sendMessage({ 
        type: "RUN_COUNT_UPDATE", 
        runCount: effortState.runCount 
      }).catch(() => {});
      
      if (effortState.runCount >= 2) {
        unlockEffortGate();
      }
    }
  }

  if (msg.type === "PROBLEM_INFO") {
    appState.problemTitle = msg.title;
    appState.problemDescription = msg.description;
    saveState();
  }

  if (msg.type === "START_EFFORT_GATE") {
    effortState.effortGateActive = true;
    effortState.effortTimeLeft = 120;
    effortState.runCount = 0;
    appState.lastAttemptTimestamp = Date.now();
    saveState();
    startEffortTimer();
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
    appState.lastAttemptTimestamp = Date.now();
    saveState();
    sendResponse({ success: true });
  }

  if (msg.type === "CHECK_PROBLEM") {
    const newProblem = getProblemSlug(msg.url);
    
    if (newProblem && newProblem !== appState.currentProblem) {
      appState = {
        phase: "THINKING",
        confidence: "LOW",
        hintsUsed: 0,
        skipUsed: false,
        thinkingTimeLeft: 120,
        currentProblem: newProblem,
        problemTitle: "",
        problemDescription: "",
        userExplanation: "",
        lastAttemptTimestamp: Date.now(),
        explanationHistory: [], // Added missing comma
        usedHintTypes: []
      };
      
      effortState = {
        effortGateActive: false,
        effortTimeLeft: 120,
        runCount: 0
      };
      
      saveState();
      sendResponse({ reset: true, reason: "new_problem", problem: newProblem });
    }
    else if (newProblem && shouldResetByTime(appState.lastAttemptTimestamp)) {
      const daysSince = ((Date.now() - appState.lastAttemptTimestamp) / (1000 * 60 * 60 * 24)).toFixed(1);
      
      appState = {
        phase: "THINKING",
        confidence: "LOW",
        hintsUsed: 0,
        skipUsed: false,
        thinkingTimeLeft: 120,
        currentProblem: newProblem,
        problemTitle: appState.problemTitle,
        problemDescription: appState.problemDescription,
        userExplanation: "",
        lastAttemptTimestamp: Date.now(),
        explanationHistory: [], // Added missing comma
        usedHintTypes: []
      };
      
      effortState = {
        effortGateActive: false,
        effortTimeLeft: 120,
        runCount: 0
      };
      
      saveState();
      sendResponse({ reset: true, reason: "time_based", daysSince, problem: newProblem });
    }
    else {
      sendResponse({ reset: false, problem: newProblem });
    }
  }

  // return true keeps the message channel open for sendResponse
  return true; 
});