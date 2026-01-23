let effortState = {
  effortGateActive: false,
  effortTimeLeft: 120,
  runCount: 0
};

let effortInterval = null;

function startEffortTimer() {
  if (effortInterval) return;

  effortInterval = setInterval(() => {
    if (!effortState.effortGateActive) {
      clearInterval(effortInterval);
      effortInterval = null;
      return;
    }

    effortState.effortTimeLeft--;

    if (effortState.effortTimeLeft <= 0) {
      unlockEffortGate();
    }
  }, 1000);
}

function unlockEffortGate() {
  effortState.effortGateActive = false;
  effortState.effortTimeLeft = 120;
  effortState.runCount = 0;

  chrome.runtime.sendMessage({ type: "EFFORT_UNLOCKED" });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // From content.js
  if (msg.type === "EDITOR_TYPING" && effortState.effortGateActive) {
    startEffortTimer();
  }

  if (msg.type === "RUN_CLICK" && effortState.effortGateActive) {
    effortState.runCount++;
    if (effortState.runCount >= 2) {
      unlockEffortGate();
    }
  }

  // From popup.js
  if (msg.type === "START_EFFORT_GATE") {
    effortState.effortGateActive = true;
    effortState.effortTimeLeft = 120;
    effortState.runCount = 0;
  }

  if (msg.type === "GET_EFFORT_STATE") {
    sendResponse(effortState);
  }

  return true;
});
