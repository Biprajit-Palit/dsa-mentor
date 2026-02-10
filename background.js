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
  currentProblem: null, // Track which problem we're on
  problemTitle: "",
  problemDescription: "",
  userExplanation: "", // Store for hint context
  lastAttemptTimestamp: null // Track when user last worked on this problem
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

// Helper to check if state should reset based on time
function shouldResetByTime(lastTimestamp) {
  // MIGRATION: If no timestamp exists (old data), assume it's old and should reset
  if (!lastTimestamp) return true; // ← Changed to true for migration
  
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

  // Store problem info from content.js
  if (msg.type === "PROBLEM_INFO") {
    appState.problemTitle = msg.title;
    appState.problemDescription = msg.description;
    saveState();
    console.log("📝 Problem info stored:", msg.title);
  }

  // From popup.js
  if (msg.type === "START_EFFORT_GATE") {
    console.log("🔒 START_EFFORT_GATE received");
    effortState.effortGateActive = true;
    effortState.effortTimeLeft = 120;
    effortState.runCount = 0;
    
    // Update timestamp when user actively works on problem
    appState.lastAttemptTimestamp = Date.now();
    
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
    
    // Update timestamp whenever state changes (user is actively working)
    appState.lastAttemptTimestamp = Date.now();
    
    saveState();
    sendResponse({ success: true });
  }

  // Check if problem changed - reset state if needed
  if (msg.type === "CHECK_PROBLEM") {
    const newProblem = getProblemSlug(msg.url);
    
    // Case 1: Different problem - always reset
    if (newProblem && newProblem !== appState.currentProblem) {
      console.log(`🔄 New problem detected: ${newProblem}`);
      
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
        lastAttemptTimestamp: Date.now()
      };
      
      effortState = {
        effortGateActive: false,
        effortTimeLeft: 120,
        runCount: 0
      };
      
      saveState();
      sendResponse({ reset: true, reason: "new_problem", problem: newProblem });
    }
    // Case 2: Same problem - check if enough time has passed
    else if (newProblem && shouldResetByTime(appState.lastAttemptTimestamp)) {
      const daysSince = ((Date.now() - appState.lastAttemptTimestamp) / (1000 * 60 * 60 * 24)).toFixed(1);
      console.log(`⏰ Time-based reset: ${daysSince} days since last attempt`);
      
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
        lastAttemptTimestamp: Date.now()
      };
      
      effortState = {
        effortGateActive: false,
        effortTimeLeft: 120,
        runCount: 0
      };
      
      saveState();
      sendResponse({ reset: true, reason: "time_based", daysSince, problem: newProblem });
    }
    // Case 3: Same problem, within time limit - keep state
    else {
      sendResponse({ reset: false, problem: newProblem });
    }
  }

  return true;
});