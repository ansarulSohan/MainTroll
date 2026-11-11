
/*
 * MainTroll AI Assistant Chat Widget
 * Load AFTER auth.js and script.js.
 * Reuses the existing request() function for Cognito authentication.
 */

(() => {
  "use strict";

  const AI_API_URL =
    "https://u6yw7twxil.execute-api.eu-north-1.amazonaws.com/assistant/chat";

  const MAX_HISTORY_MESSAGES = 6;
  const REQUEST_TIMEOUT_MS = 35000;

  // Chat elements
  const chatWindow = document.getElementById("chat-window");
  const chatToggle = document.getElementById("chat-toggle");
  const chatClose = document.getElementById("chat-close");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatMessages = document.getElementById("chat-messages");

  // Stop if the chat HTML is not present
  if (
    !chatWindow ||
    !chatToggle ||
    !chatForm ||
    !chatInput ||
    !chatMessages
  ) {
    return;
  }

  const sendButton = chatForm.querySelector("button[type='submit']");

  if (!sendButton) return;

  // Conversation history stays in memory only
  const history = [];

  function addMessage(text, who, extraClass) {
    const element = document.createElement("div");

    element.className =
      who === "user" ? "user-message" : "assistant-message";

    if (extraClass) {
      element.classList.add(extraClass);
    }

    // Safe rendering: messages are treated as text, not HTML
    element.textContent = text;

    chatMessages.appendChild(element);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return element;
  }

  function setBusy(busy) {
    sendButton.disabled = busy;
    chatInput.disabled = busy;
  }

  function withTimeout(promise, ms) {
    let timer;

    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("TIMEOUT"));
      }, ms);
    });

    return Promise.race([promise, timeout])
      .finally(() => clearTimeout(timer));
  }

  function friendlyError(error) {
    const message = String(error?.message || "");

    if (message === "TIMEOUT") {
      return "That took too long. Please try again.";
    }

    if (message.startsWith("Could not reach the API")) {
      return "Could not reach the assistant. Check your connection and try again.";
    }

    const status =
      (message.match(/\((\d{3})\)/) || [])[1];

    if (status === "401" || status === "403") {
      return "Your login could not be verified. Please sign in again and retry.";
    }

    if (status === "429") {
      return "The assistant is busy. Please wait a moment and try again.";
    }

    const detail =
      message.match(/\((?:400|500|502)\): (.+)$/);

    if (detail) {
      return detail[1];
    }

    return "Sorry, I could not process your request. Please try again.";
  }

  // Open and close the chat window
  chatToggle.addEventListener("click", () => {
    chatWindow.hidden = !chatWindow.hidden;

    chatToggle.setAttribute(
      "aria-expanded",
      String(!chatWindow.hidden)
    );

    if (!chatWindow.hidden) {
      chatInput.focus();
    }
  });

  // Close button
  if (chatClose) {
    chatClose.addEventListener("click", () => {
      chatWindow.hidden = true;
      chatToggle.setAttribute("aria-expanded", "false");
      chatToggle.focus();
    });
  }
   const welcome = document.querySelector("#maintroll-chat .chat-welcome");

  // Clicking a suggestion sends it as a question
  document.querySelectorAll("#maintroll-chat .chat-suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      if (sendButton.disabled) return;
      chatInput.value = button.textContent.trim();
      chatForm.requestSubmit();
    });
  });
  // Send a message
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = chatInput.value.trim();

    if (!message) return;

    addMessage(message, "user");

        if (welcome) welcome.hidden = true;   // free up space after the first question

    chatInput.value = "";
    setBusy(true);

    const thinking = addMessage(
      "Thinking...",
      "assistant",
      "thinking"
    );

    try {
      // request() handles Cognito token retrieval and refresh
      const data = await withTimeout(
        request("POST", AI_API_URL, {
          message: message,
          history: history.slice(-MAX_HISTORY_MESSAGES)
        }),
        REQUEST_TIMEOUT_MS
      );

      const reply =
        data && typeof data.reply === "string"
          ? data.reply.trim()
          : "";

      if (!reply) {
        throw new Error("The assistant returned an empty reply.");
      }

      thinking.remove();
      addMessage(reply, "assistant");

      history.push(
        { role: "user", text: message },
        { role: "assistant", text: reply }
      );

      while (history.length > MAX_HISTORY_MESSAGES) {
        history.shift();
      }

    } catch (error) {
      console.error("[MainTroll AI]", error);

      thinking.remove();

      addMessage(
        friendlyError(error),
        "assistant",
        "chat-error"
      );

    } finally {
      setBusy(false);

      if (!chatWindow.hidden) {
        chatInput.focus();
      }
    }
  });

})();
