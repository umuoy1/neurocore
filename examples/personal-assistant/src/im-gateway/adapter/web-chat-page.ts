export const WEB_CHAT_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NeuroCore Personal Assistant</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5efe5;
        --panel: rgba(255, 252, 247, 0.88);
        --line: rgba(69, 55, 37, 0.14);
        --text: #2b241c;
        --muted: #766554;
        --accent: #b95c32;
        --accent-strong: #8c3f1d;
        --accent-soft: rgba(185, 92, 50, 0.12);
        --success: #2f7d4a;
        --warning: #9d5f12;
        --shadow: 0 20px 60px rgba(80, 53, 28, 0.15);
        --radius: 22px;
        --font-body: "IBM Plex Sans", "Helvetica Neue", sans-serif;
        --font-mono: "IBM Plex Mono", "SFMono-Regular", monospace;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: var(--font-body);
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(255, 186, 120, 0.34), transparent 30%),
          radial-gradient(circle at top right, rgba(180, 225, 207, 0.28), transparent 26%),
          linear-gradient(180deg, #fbf7f0 0%, #f0e5d7 100%);
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(69, 55, 37, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(69, 55, 37, 0.03) 1px, transparent 1px);
        background-size: 32px 32px;
        mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent 85%);
      }

      .shell {
        width: min(1120px, calc(100vw - 32px));
        margin: 24px auto;
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr);
        gap: 20px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }

      .sidebar {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
      }

      h1 {
        margin: 8px 0 0;
        font-size: 30px;
        line-height: 1;
      }

      .lede {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }

      .field-group {
        display: grid;
        gap: 12px;
      }

      .field {
        display: grid;
        gap: 6px;
      }

      .field label {
        font-size: 12px;
        color: var(--muted);
      }

      input,
      textarea,
      button {
        font: inherit;
      }

      input,
      textarea {
        width: 100%;
        border: 1px solid rgba(69, 55, 37, 0.18);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.85);
        color: var(--text);
        padding: 12px 14px;
        outline: none;
        transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }

      input:focus,
      textarea:focus {
        border-color: rgba(185, 92, 50, 0.7);
        box-shadow: 0 0 0 4px rgba(185, 92, 50, 0.12);
      }

      textarea {
        min-height: 110px;
        resize: vertical;
      }

      .button-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
      }

      button:hover {
        transform: translateY(-1px);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        transform: none;
      }

      .primary {
        color: #fff;
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
        box-shadow: 0 12px 28px rgba(140, 63, 29, 0.24);
      }

      .secondary {
        color: var(--text);
        background: rgba(69, 55, 37, 0.08);
      }

      .ghost {
        color: var(--muted);
        background: rgba(255, 255, 255, 0.64);
        border: 1px solid rgba(69, 55, 37, 0.12);
      }

      .status-card,
      .tips-card {
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 16px;
        background: rgba(255, 255, 255, 0.54);
      }

      .status-dot {
        display: inline-flex;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #b08e71;
        margin-right: 8px;
      }

      .status-dot.connected {
        background: var(--success);
        box-shadow: 0 0 0 6px rgba(47, 125, 74, 0.16);
      }

      .status-dot.connecting {
        background: var(--warning);
        box-shadow: 0 0 0 6px rgba(157, 95, 18, 0.16);
      }

      .status-line {
        display: flex;
        align-items: center;
        font-size: 14px;
      }

      .endpoint {
        margin-top: 12px;
        font-size: 12px;
        color: var(--muted);
        word-break: break-all;
        font-family: var(--font-mono);
      }

      .tips-card ul {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .workspace {
        min-height: calc(100vh - 48px);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        overflow: hidden;
      }

      .hero {
        padding: 26px 28px 20px;
        border-bottom: 1px solid var(--line);
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
      }

      .hero h2 {
        margin: 6px 0 0;
        font-size: 22px;
      }

      .hero p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 14px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent-strong);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .messages {
        padding: 22px 28px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .message {
        max-width: min(720px, 88%);
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.8);
        animation: slide-in 180ms ease;
      }

      .message.user {
        align-self: flex-end;
        background: linear-gradient(135deg, rgba(185, 92, 50, 0.92), rgba(140, 63, 29, 0.96));
        color: #fff;
        border-color: transparent;
      }

      .message.system {
        align-self: center;
        background: rgba(69, 55, 37, 0.08);
        color: var(--muted);
        font-size: 13px;
      }

      .message.assistant {
        align-self: flex-start;
      }

      .message-header {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 8px;
        font-size: 12px;
        color: inherit;
        opacity: 0.72;
      }

      .message-body {
        white-space: pre-wrap;
        line-height: 1.55;
        word-break: break-word;
      }

      .message-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 14px;
      }

      .approve {
        background: rgba(47, 125, 74, 0.14);
        color: var(--success);
      }

      .reject {
        background: rgba(185, 92, 50, 0.14);
        color: var(--accent-strong);
      }

      .composer {
        padding: 18px 24px 24px;
        border-top: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255, 252, 247, 0.1) 0%, rgba(255, 252, 247, 0.75) 100%);
      }

      .composer-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 14px;
        align-items: end;
      }

      .composer-hint {
        margin-top: 10px;
        font-size: 12px;
        color: var(--muted);
      }

      code {
        font-family: var(--font-mono);
        font-size: 0.95em;
      }

      @keyframes slide-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 920px) {
        .shell {
          grid-template-columns: 1fr;
        }

        .workspace {
          min-height: auto;
        }
      }

      @media (max-width: 640px) {
        .shell {
          width: min(100vw - 18px, 100%);
          margin: 9px auto;
          gap: 12px;
        }

        .sidebar,
        .hero,
        .messages,
        .composer {
          padding-left: 16px;
          padding-right: 16px;
        }

        .hero {
          flex-direction: column;
          align-items: flex-start;
        }

        .composer-grid {
          grid-template-columns: 1fr;
        }

        .message {
          max-width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="panel sidebar">
        <div>
          <div class="eyebrow">NeuroCore</div>
          <h1>Personal Assistant</h1>
          <p class="lede">Local-first Web Chat for Phase A debugging. It uses the same WebSocket gateway and session routing as the assistant app.</p>
        </div>

        <section class="field-group">
          <div class="field">
            <label for="chat-id">Chat ID</label>
            <input id="chat-id" type="text" />
          </div>
          <div class="field">
            <label for="user-id">User ID</label>
            <input id="user-id" type="text" />
          </div>
          <div class="button-row">
            <button id="connect-button" class="primary" type="button">Connect</button>
            <button id="disconnect-button" class="secondary" type="button">Disconnect</button>
          </div>
        </section>

        <section class="status-card">
          <div class="status-line">
            <span id="status-dot" class="status-dot"></span>
            <strong id="status-text">Disconnected</strong>
          </div>
          <div id="endpoint" class="endpoint"></div>
        </section>

        <section class="tips-card">
          <div class="eyebrow" style="margin-bottom: 10px;">Useful Commands</div>
          <ul>
            <li><code>/new</code> starts a fresh mapped session</li>
            <li><code>/reset</code> clears the current route and checkpoints if possible</li>
            <li><code>/status</code> prints runtime session state</li>
            <li><code>/history</code> lists known routes for this user</li>
          </ul>
        </section>
      </aside>

      <main class="panel workspace">
        <header class="hero">
          <div>
            <div class="eyebrow">Local Web Chat</div>
            <h2>Same gateway, easier debugging</h2>
            <p>Messages sent here go through the Web Chat adapter and session router, not a mock UI layer.</p>
          </div>
          <div class="badge" id="session-badge">Idle</div>
        </header>

        <section id="messages" class="messages"></section>

        <section class="composer">
          <div class="composer-grid">
            <div class="field">
              <label for="composer">Message</label>
              <textarea id="composer" placeholder="Ask a question, or try /status"></textarea>
            </div>
            <div class="button-row">
              <button id="send-button" class="primary" type="button">Send</button>
              <button id="clear-button" class="ghost" type="button">Clear Log</button>
            </div>
          </div>
          <div class="composer-hint">Press <code>Cmd/Ctrl + Enter</code> to send. Keep the same <code>chat_id</code> if you want to reuse the same conversation route.</div>
        </section>
      </main>
    </div>

    <script>
      const chatIdInput = document.getElementById("chat-id");
      const userIdInput = document.getElementById("user-id");
      const connectButton = document.getElementById("connect-button");
      const disconnectButton = document.getElementById("disconnect-button");
      const sendButton = document.getElementById("send-button");
      const clearButton = document.getElementById("clear-button");
      const composer = document.getElementById("composer");
      const messages = document.getElementById("messages");
      const statusDot = document.getElementById("status-dot");
      const statusText = document.getElementById("status-text");
      const endpoint = document.getElementById("endpoint");
      const sessionBadge = document.getElementById("session-badge");

      const state = {
        socket: null,
        status: "disconnected"
      };

      const params = new URLSearchParams(window.location.search);
      chatIdInput.value = params.get("chat_id") || loadValue("neurocore.chat_id") || "chat-" + shortId();
      userIdInput.value = params.get("user_id") || loadValue("neurocore.user_id") || "user-" + shortId();

      syncStatus("disconnected", "Disconnected");
      renderSystem("Ready. Connect to the local WebSocket gateway to begin.");

      connectButton.addEventListener("click", () => connect());
      disconnectButton.addEventListener("click", () => disconnect("Disconnected by user."));
      sendButton.addEventListener("click", () => sendCurrentMessage());
      clearButton.addEventListener("click", () => {
        messages.innerHTML = "";
        renderSystem("Log cleared.");
      });
      composer.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          sendCurrentMessage();
        }
      });

      function connect() {
        if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
          return;
        }

        const chatId = chatIdInput.value.trim();
        const userId = userIdInput.value.trim();
        if (!chatId || !userId) {
          renderSystem("Both chat_id and user_id are required.");
          return;
        }

        storeValue("neurocore.chat_id", chatId);
        storeValue("neurocore.user_id", userId);

        const wsUrl = buildWsUrl(chatId, userId);
        endpoint.textContent = wsUrl;
        syncStatus("connecting", "Connecting");

        const socket = new WebSocket(wsUrl);
        state.socket = socket;

        socket.addEventListener("open", () => {
          syncStatus("connected", "Connected");
          renderSystem("Connected as " + userId + " in " + chatId + ".");
        });

        socket.addEventListener("message", (event) => {
          handleIncoming(event.data);
        });

        socket.addEventListener("close", () => {
          if (state.socket === socket) {
            state.socket = null;
          }
          syncStatus("disconnected", "Disconnected");
        });

        socket.addEventListener("error", () => {
          renderSystem("WebSocket error. Check the assistant process output.");
        });
      }

      function disconnect(message) {
        if (message) {
          renderSystem(message);
        }
        if (state.socket) {
          state.socket.close();
          state.socket = null;
        }
        syncStatus("disconnected", "Disconnected");
      }

      function sendCurrentMessage() {
        const value = composer.value.trim();
        if (!value) {
          return;
        }
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
          renderSystem("Connect before sending messages.");
          return;
        }

        state.socket.send(value);
        renderMessage({
          role: "user",
          label: userIdInput.value.trim() || "user",
          text: value
        });
        composer.value = "";
        composer.focus();
      }

      function handleIncoming(raw) {
        let payload = raw;
        try {
          payload = JSON.parse(raw);
        } catch {}

        if (typeof payload !== "object" || payload === null) {
          renderMessage({
            role: "assistant",
            label: "assistant",
            text: String(payload)
          });
          return;
        }

        if (payload.type === "typing") {
          sessionBadge.textContent = "Assistant typing";
          return;
        }

        if (payload.type === "message" || payload.type === "edit") {
          sessionBadge.textContent = "Active";
          renderIncomingContent(payload.content, payload.message_id);
          return;
        }

        renderSystem("Received unsupported payload: " + JSON.stringify(payload));
      }

      function renderIncomingContent(content, messageId) {
        if (!content || typeof content !== "object") {
          renderMessage({ role: "assistant", label: "assistant", text: JSON.stringify(content) });
          return;
        }

        if (content.type === "approval_request") {
          const card = renderMessage({
            role: "assistant",
            label: "assistant",
            text: content.text || "Approval required",
            messageId
          });

          const actions = document.createElement("div");
          actions.className = "message-actions";

          const approve = document.createElement("button");
          approve.className = "approve";
          approve.type = "button";
          approve.textContent = content.approve_label || "Approve";
          approve.addEventListener("click", () => sendAction("approve", content.approval_id, messageId));

          const reject = document.createElement("button");
          reject.className = "reject";
          reject.type = "button";
          reject.textContent = content.reject_label || "Reject";
          reject.addEventListener("click", () => sendAction("reject", content.approval_id, messageId));

          actions.append(approve, reject);
          card.querySelector(".message-body").append(actions);
          return;
        }

        const text =
          content.type === "text" || content.type === "markdown"
            ? content.text || ""
            : JSON.stringify(content, null, 2);

        renderMessage({
          role: "assistant",
          label: "assistant",
          text,
          messageId
        });
      }

      function sendAction(action, approvalId, replyTo) {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
          renderSystem("Connection is closed.");
          return;
        }

        state.socket.send(JSON.stringify({
          type: "action",
          action,
          reply_to: replyTo,
          params: approvalId ? { approval_id: approvalId } : {}
        }));
        renderSystem("Sent " + action + " action.");
      }

      function renderMessage({ role, label, text, messageId }) {
        const node = document.createElement("article");
        node.className = "message " + role;

        const header = document.createElement("div");
        header.className = "message-header";
        const who = document.createElement("strong");
        who.textContent = label;
        const time = document.createElement("span");
        time.textContent = new Date().toLocaleTimeString();
        header.append(who, time);
        if (messageId) {
          const meta = document.createElement("span");
          meta.textContent = messageId;
          header.append(meta);
        }

        const body = document.createElement("div");
        body.className = "message-body";
        body.textContent = text;

        node.append(header, body);
        messages.append(node);
        messages.scrollTop = messages.scrollHeight;
        return node;
      }

      function renderSystem(text) {
        renderMessage({
          role: "system",
          label: "system",
          text
        });
      }

      function buildWsUrl(chatId, userId) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const base = new URL(window.location.href);
        base.protocol = protocol;
        base.pathname = "/chat";
        base.search = "";
        base.searchParams.set("chat_id", chatId);
        base.searchParams.set("user_id", userId);
        return base.toString();
      }

      function syncStatus(status, text) {
        state.status = status;
        statusText.textContent = text;
        statusDot.className = "status-dot";
        if (status === "connected") {
          statusDot.classList.add("connected");
          sessionBadge.textContent = "Connected";
        } else if (status === "connecting") {
          statusDot.classList.add("connecting");
          sessionBadge.textContent = "Connecting";
        } else {
          sessionBadge.textContent = "Idle";
        }
      }

      function shortId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID().slice(0, 8);
        }
        return Math.random().toString(16).slice(2, 10);
      }

      function loadValue(key) {
        try {
          return window.localStorage.getItem(key);
        } catch {
          return "";
        }
      }

      function storeValue(key, value) {
        try {
          window.localStorage.setItem(key, value);
        } catch {}
      }
    </script>
  </body>
</html>
`;
