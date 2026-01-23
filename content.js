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

// ---------- RUN BUTTON DETECTION ----------
const attachedButtons = new WeakSet();

function attachRunListener() {
  const buttons = document.querySelectorAll("button");

  buttons.forEach(btn => {
    if (
      btn.innerText &&
      btn.innerText.toLowerCase().includes("run") &&
      !attachedButtons.has(btn)
    ) {
      attachedButtons.add(btn);

      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "RUN_CLICK" });
      });
    }
  });
}

// Retry because LeetCode loads dynamically
setInterval(attachRunListener, 2000);
