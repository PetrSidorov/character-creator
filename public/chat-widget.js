// chat-widget.js
// Usage:
// <chat-widget
//   api-url="https://yourapp.com/api/customer-trpc"
//   api-key="sk_your_domain_api_key_here"
//   primary-color="#7c6af7"
//   welcome-message="Hi! How can I help?"
//   title="Support Chat"
//   position="bottom-right"
//   theme="dark"
// ></chat-widget>

class ChatWidget extends HTMLElement {
  static get observedAttributes() {
    return [
      "api-url",
      "api-key",
      "primary-color",
      "welcome-message",
      "position",
      "force-open",
      "title",
      "language",
      "timezone",
      "logo-url",
      "theme",
      "auto-open-delay-ms",
      "prechat-collect-name",
      "prechat-collect-email",
      "show-faq-suggestions",
      "open-time",
      "close-time",
      "weekend-closed",
    ];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.messages = [];
    this.isPending = false;
    this.isWidgetOpen = false;
    this.prechatSubmitted = false;
    this.prechatData = { name: "", email: "" };
    this.autoOpenTimer = null;

    // State
    this.chatId = null;          // created on first interaction
    this.sessionKey = null;      // stored in sessionStorage per domain
    this.isInitializing = false;
    this.chats = [];             // fetched from server
    this.activeChatId = null;
  }
  // ─── Auth ─────────────────────────────────────────────────────────────────

  get isRegisterMode() { return this._authMode === "register"; }

  toggleAuthMode() {
    this._authMode = this.isRegisterMode ? "login" : "register";
    const sr = this.shadowRoot;
    sr.getElementById("auth-title").textContent = this.isRegisterMode ? "Create account" : "Welcome back";
    sr.getElementById("auth-subtitle").textContent = this.isRegisterMode ? "Sign up to start chatting." : "Sign in to continue your conversation.";
    sr.getElementById("auth-name-field").style.display = this.isRegisterMode ? "flex" : "none";
    sr.getElementById("auth-submit").textContent = this.isRegisterMode ? "Create account →" : "Sign in →";
    sr.getElementById("auth-switch").textContent = this.isRegisterMode ? "Sign in instead" : "Create one";
    sr.getElementById("auth-toggle").childNodes[0].textContent = this.isRegisterMode ? "Already have an account? " : "Don't have an account? ";
    sr.getElementById("auth-error").textContent = "";
  }

  async submitAuth() {
    const sr = this.shadowRoot;
    const email = sr.getElementById("auth-email").value.trim();
    const password = sr.getElementById("auth-password").value;
    const name = sr.getElementById("auth-name").value.trim();
    const errorEl = sr.getElementById("auth-error");
    const submitBtn = sr.getElementById("auth-submit");

    if (!email || !password) { errorEl.textContent = "Email and password are required."; return; }
    if (this.isRegisterMode && !name) { errorEl.textContent = "Name is required."; return; }

    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = this.isRegisterMode ? "Creating account…" : "Signing in…";

    try {
      const path = this.isRegisterMode ? "auth.register" : "auth.login";
      const input = this.isRegisterMode
        ? { email, password, name }
        : { email, password };

      const result = await this.trpc(path, input, "mutation");
      console.log("[auth] result", result); // 👈

      // this._customerToken = result.token;
      this._customerToken = result.json?.token ?? result.token;
      this._customer = result.json?.user ?? result.user;

      this.saveAuth(this._customerToken, this._customer); // ✅ add this

      // Hide auth, show chat
      sr.getElementById("auth-screen").classList.remove("visible");
      sr.getElementById("chat-main-area").style.display = "flex";
      await this.initChat();
      // Hide auth, show chat


    } catch (err) {
      errorEl.textContent = err.message ?? "Something went wrong. Please try again.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this.isRegisterMode ? "Create account →" : "Sign in →";
    }
  }
  // ─── Auth persistence ─────────────────────────────────────────────────────

  getAuthKey(suffix) { return `cw_${suffix}_${this.apiKey.slice(-8)}`; }

  saveAuth(token, user) {
    try {
      localStorage.setItem(this.getAuthKey("token"), token);
      localStorage.setItem(this.getAuthKey("user"), JSON.stringify(user));
      console.log("[widget] saved auth:", { token, user: user?.email, key: this.getAuthKey("token") });

    } catch (e) {
      console.error("[widget] saveAuth failed:", e);

    }
  }

  loadAuth() {
    try {
      const key = this.getAuthKey("token");
      console.log("[widget] loading auth from key:", key);
      this._customerToken = localStorage.getItem(key);
      this._customer = JSON.parse(localStorage.getItem(this.getAuthKey("user")) || "null");
      console.log("[widget] loadAuth result:", { token: this._customerToken, customer: this._customer?.email });
    } catch (e) {
      console.error("[widget] loadAuth failed:", e);
    }
  }

  clearAuth() {
    try {
      localStorage.removeItem(this.getAuthKey("token"));
      localStorage.removeItem(this.getAuthKey("user"));
    } catch { }
  }

  logout() {
    this.clearAuth();
    this.clearSession();
    this._customerToken = null;
    this._customer = null;
    this.chatId = null;
    this.activeChatId = null;
    this.messages = [];
    this.showAuthScreen("login");
  }
  showAuthScreen(mode = "login") {
    this._authMode = mode;
    const sr = this.shadowRoot;
    sr.getElementById("auth-screen").classList.add("visible");
    sr.getElementById("chat-main-area").style.display = "none";
    // Apply correct labels for initial mode
    this.toggleAuthMode();
    this._authMode = mode; // toggleAuthMode flips it, reset
    sr.getElementById("auth-title").textContent = mode === "register" ? "Create account" : "Welcome back";
    sr.getElementById("auth-subtitle").textContent = mode === "register" ? "Sign up to start chatting." : "Sign in to continue your conversation.";
    sr.getElementById("auth-name-field").style.display = mode === "register" ? "flex" : "none";
    sr.getElementById("auth-submit").textContent = mode === "register" ? "Create account →" : "Sign in →";
  }
  // ─── Attribute helpers ────────────────────────────────────────────────────

  get primaryColor() { return this.getAttribute("primary-color") || "#7c6af7"; }
  get welcomeMessage() { return this.getAttribute("welcome-message") || ""; }
  get position() { return this.getAttribute("position") || "bottom-right"; }
  get forceOpen() { return this.getAttribute("force-open") === "true"; }
  get widgetTitle() { return this.getAttribute("title") || "AI Assistant"; }
  get language() { return this.getAttribute("language") || navigator.language || "en"; }
  get timezone() { return this.getAttribute("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone; }
  get logoUrl() { return this.getAttribute("logo-url") || ""; }
  get theme() { return this.getAttribute("theme") || "dark"; }
  get autoOpenDelayMs() { const v = parseInt(this.getAttribute("auto-open-delay-ms"), 10); return isNaN(v) ? null : v; }
  get apiKey() { return this.getAttribute("api-key") || ""; }
  get prechatCollectName() { return this.getAttribute("prechat-collect-name") === "true"; }
  get prechatCollectEmail() { return this.getAttribute("prechat-collect-email") === "true"; }
  get apiUrl() { return this.getAttribute("api-url") || "/api/customer-trpc"; }

  get faqSuggestions() {
    const raw = this.getAttribute("show-faq-suggestions");
    if (!raw || raw === "false" || raw === "true") return [];
    return raw.split(",").map(s => s.trim()).filter(Boolean);
  }

  parseTime(attr) {
    const val = this.getAttribute(attr);
    if (!val) return null;
    const [h, m] = val.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return { h, m };
  }

  get openTime() { return this.parseTime("open-time"); }
  get closeTime() { return this.parseTime("close-time"); }
  get weekendClosed() { return this.getAttribute("weekend-closed") === "true"; }

  // ─── tRPC client ──────────────────────────────────────────────────────────

  async trpc(path, input, method = "query") {
    const url = new URL(`${this.apiUrl}/${path}`);
    const headers = {
      "Content-Type": "application/json",
      ...(this.apiKey && { "x-api-key": this.apiKey }),
      ...(this._customerToken && { "Authorization": `Bearer ${this._customerToken}` }), // ✅
    };
    console.log("[trpc] request", { path, method, headers, input }); // 👈 add this

    let res;
    if (method === "query") {
      url.searchParams.set("input", JSON.stringify({ json: input ?? {} }));
      res = await fetch(url.toString(), { method: "GET", headers });
    } else {
      res = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({ json: input ?? {} }),
        credentials: "include",
      });
    }

    if (!res.ok) throw new Error(`tRPC ${path} failed: ${res.status}`);
    const json = await res.json();

    // tRPC wraps response in { result: { data: ... } }
    if (json.error) throw new Error(json.error.message);
    return json.result?.data ?? json;
  }

  // ─── Session persistence ──────────────────────────────────────────────────

  getStorageKey() {
    return `cw_chatId_${this.apiKey.slice(-8)}`;
  }

  saveSession(chatId) {
    try { sessionStorage.setItem(this.getStorageKey(), chatId); } catch { }
  }

  loadSession() {
    try { return sessionStorage.getItem(this.getStorageKey()); } catch { return null; }
  }

  clearSession() {
    try { sessionStorage.removeItem(this.getStorageKey()); } catch { }
  }

  // ─── Chat initialization ──────────────────────────────────────────────────

  async initChat() {
    if (this.isInitializing) return;
    this.isInitializing = true;

    const typing = this.shadowRoot.getElementById("typing");
    const messages = this.shadowRoot.getElementById("messages");

    typing.classList.add("visible");
    this.shadowRoot.getElementById("empty").style.display = "none";
    messages.style.display = "flex";

    try {
      // Try to resume existing session
      const savedChatId = this.loadSession();
      if (savedChatId) {
        await this.loadExistingChat(savedChatId);
      } else {
        await this.createNewChat();
      }
    } catch (err) {
      console.error("[ChatWidget] init failed", err);
      this.clearSession();
      try { await this.createNewChat(); } catch { }
    } finally {
      typing.classList.remove("visible");
      this.isInitializing = false;
      this.isPending = false;
      this.showEmptyOrMessages();
    }
  }

  async createNewChat() {
    const chat = await this.trpc("chat.create", {
      language: this.language,
      timezone: this.timezone,
      title: "Support Chat",
    }, "mutation");

    this.chatId = chat.id;
    this.activeChatId = chat.id;
    this.saveSession(chat.id);
    this.messages = [];

    // Fetch welcome message from AI
    if (this.welcomeMessage) {
      this.addMessage(this.welcomeMessage, "ai");
    } else {
      await this.fetchWelcome();
    }
  }

  async fetchWelcome() {
    const res = await this.trpc("aiMessage.send", {
      chatId: this.chatId,
      content: "__init__",
    }, "mutation");

    if (res?.content) {
      this.addMessage(res.content, "ai");
    }
  }

  async loadExistingChat(chatId) {
    try {
      const [chat, messageList] = await Promise.all([
        this.trpc("chat.getById", { chatId }),
        this.trpc("message.list", { chatId, limit: 50 }),
      ]);

      if (!chat) throw new Error("Chat not found");

      this.chatId = chat.id;
      this.activeChatId = chat.id;
      this.messages = [];

      // Render existing messages
      for (const msg of messageList) {
        this.addMessage(msg.content, msg.role === "user" ? "user" : "ai", new Date(msg.createdAt));
      }
    } catch {
      // Chat no longer exists, start fresh
      this.clearSession();
      await this.createNewChat();
    }
  }

  async fetchChatList() {
    try {
      const chats = await this.trpc("chat.list", {});
      console.log('loaded chats ', chats)
      this.chats = chats ?? [];
      this.renderChatList();
    } catch { }
  }

  async switchChat(chatId) {
    if (chatId === this.activeChatId || this.isPending) return;

    const typing = this.shadowRoot.getElementById("typing");
    const messages = this.shadowRoot.getElementById("messages");

    typing.classList.add("visible");
    messages.style.display = "flex";
    this.shadowRoot.getElementById("empty").style.display = "none";

    try {
      const messageList = await this.trpc("message.list", { chatId, limit: 50 });

      this.chatId = chatId;
      this.activeChatId = chatId;
      this.saveSession(chatId);
      this.messages = [];

      // Clear and re-render
      messages.innerHTML = "";
      for (const msg of messageList) {
        this.addMessage(msg.content, msg.role === "user" ? "user" : "ai", new Date(msg.createdAt));
      }
    } catch (err) {
      console.error("[ChatWidget] switch chat failed", err);
    } finally {
      typing.classList.remove("visible");
      this.showEmptyOrMessages();
      this.renderChatList();
    }
  }

  async startNewChat() {
    if (this.isPending) return;
    this.isPending = true;

    const messages = this.shadowRoot.getElementById("messages");
    messages.innerHTML = "";
    this.messages = [];

    try {
      await this.createNewChat();
      await this.fetchChatList();
    } catch (err) {
      console.error("[ChatWidget] new chat failed", err);
    } finally {
      this.isPending = false;
      this.showEmptyOrMessages();
    }
  }

  // ─── Send message ─────────────────────────────────────────────────────────

  async sendMessage() {
    if (!this.isWithinBusinessHours()) return;
    if (!this.chatId) return;

    const input = this.shadowRoot.getElementById("input");
    const sendBtn = this.shadowRoot.getElementById("send-btn");
    const typing = this.shadowRoot.getElementById("typing");
    const messages = this.shadowRoot.getElementById("messages");

    const text = input.value.trim();
    if (!text || this.isPending) return;

    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    this.isPending = true;

    this.addMessage(text, "user");
    typing.classList.add("visible");
    messages.scrollTop = messages.scrollHeight;

    try {
      const res = await this.trpc("aiMessage.send", {
        chatId: this.chatId,
        content: text,
        ...(this.prechatSubmitted && this.prechatData.name && { visitorName: this.prechatData.name }),
        ...(this.prechatSubmitted && this.prechatData.email && { visitorEmail: this.prechatData.email }),
      }, "mutation");

      typing.classList.remove("visible");
      this.addMessage(res?.content ?? "No response received.", "ai");
    } catch (err) {
      typing.classList.remove("visible");
      console.error("[ChatWidget] send failed", err);
      this.addMessage("Something went wrong. Please try again.", "ai");
    } finally {
      this.isPending = false;
      sendBtn.disabled = !input.value.trim() || !this.isWithinBusinessHours();
    }
  }

  // ─── Business hours ────────────────────────────────────────────────────────

  isWithinBusinessHours() {
    if (!this.openTime && !this.closeTime && !this.weekendClosed) return true;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: this.timezone }));
    const day = now.getDay();
    if (this.weekendClosed && (day === 0 || day === 6)) return false;
    if (this.openTime && this.closeTime) {
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const openMins = this.openTime.h * 60 + this.openTime.m;
      const closeMins = this.closeTime.h * 60 + this.closeTime.m;
      if (nowMins < openMins || nowMins >= closeMins) return false;
    }
    return true;
  }

  formatBusinessHours() {
    if (!this.openTime || !this.closeTime) return "";
    const fmt = t => { const h = t.h % 12 || 12; const m = String(t.m).padStart(2, "0"); return `${h}:${m} ${t.h < 12 ? "AM" : "PM"}`; };
    return `${this.weekendClosed ? "Mon–Fri" : "Daily"}, ${fmt(this.openTime)} – ${fmt(this.closeTime)}`;
  }

  // ─── Color helpers ────────────────────────────────────────────────────────

  hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }

  formatTime(date) {
    try {
      return date.toLocaleTimeString(this.language, { hour: "2-digit", minute: "2-digit", timeZone: this.timezone });
    } catch {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  connectedCallback() {
    this.loadAuth(); // ✅ before render so token is ready
    console.log("[widget] loaded auth:", {
      token: this._customerToken,
      customer: this._customer?.email,
    });
    this.render();
    this.bindEvents();
    this.applyDynamicSettings();

    setTimeout(() => {
      this.showEmptyOrMessages();
      if (this.forceOpen) this.openWidget();
    }, 50);

    if (!this.forceOpen && this.autoOpenDelayMs !== null) {
      this.autoOpenTimer = setTimeout(() => {
        if (!this.isWidgetOpen) this.openWidget();
      }, this.autoOpenDelayMs);
    }
  }

  disconnectedCallback() {
    if (this.autoOpenTimer) clearTimeout(this.autoOpenTimer);
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal || !this.shadowRoot.innerHTML) return;
    this.applyDynamicSettings();
    if (name === "force-open" && newVal === "true") this.openWidget();
  }

  // ─── Apply live attribute changes ─────────────────────────────────────────

  applyDynamicSettings() {
    const rgb = this.hexToRgb(this.primaryColor);
    let overrideStyle = this.shadowRoot.getElementById("__override");
    if (!overrideStyle) {
      overrideStyle = document.createElement("style");
      overrideStyle.id = "__override";
      this.shadowRoot.appendChild(overrideStyle);
    }

    const isLight = this.theme === "light";
    overrideStyle.textContent = `
      :host {
        --accent: ${this.primaryColor};
        --accent-dim: rgba(${rgb}, 0.15);
        --accent-glow: rgba(${rgb}, 0.25);
        --user-bubble: ${isLight ? `rgba(${rgb}, 0.12)` : `color-mix(in srgb, ${this.primaryColor} 12%, #0a0a0b)`};
        ${isLight ? `
          --bg: #ffffff; --bg-raised: #f5f5f7; --bg-hover: #ebebef;
          --border: rgba(0,0,0,0.08); --border-strong: rgba(0,0,0,0.14);
          --text: #111113; --text-muted: #6b6b78; --text-subtle: #b0b0bc;
          --ai-bubble: #f0f0f5;
        ` : ""}
        ${this.position === "bottom-left" ? "right: auto !important; left: 20px !important;" : "left: auto !important; right: 20px !important;"}
      }
      #widget { transform-origin: ${this.position === "bottom-left" ? "bottom left" : "bottom right"}; }
      .chat-item.active { border-color: rgba(${rgb}, 0.2) !important; background: rgba(${rgb}, 0.08) !important; }
      #input-row:focus-within { border-color: rgba(${rgb}, 0.4) !important; box-shadow: 0 0 0 3px rgba(${rgb}, 0.25) !important; }
      .faq-chip:hover { background: rgba(${rgb}, 0.15) !important; border-color: rgba(${rgb}, 0.4) !important; color: var(--accent) !important; }
      #prechat-submit { background: ${this.primaryColor} !important; }
      #send-btn { background: ${this.primaryColor} !important; }
      .online-dot { background: #22c55e; }
      .offline-dot { background: var(--text-muted); }
    `;

    const topbarTitle = this.shadowRoot.getElementById("topbar-title");
    if (topbarTitle) topbarTitle.textContent = this.widgetTitle;

    const emptyTitle = this.shadowRoot.getElementById("empty-title");
    const emptySubtitle = this.shadowRoot.getElementById("empty-subtitle");
    if (emptyTitle) emptyTitle.textContent = this.welcomeMessage || this.widgetTitle;
    if (emptySubtitle) {
      emptySubtitle.textContent = this.isWithinBusinessHours()
        ? "Send a message to get started."
        : `We're currently offline. ${this.formatBusinessHours() ? "Hours: " + this.formatBusinessHours() : "Check back later."}`;
    }

    const logoEl = this.shadowRoot.getElementById("topbar-logo");
    const emptyLogo = this.shadowRoot.getElementById("empty-logo");
    if (logoEl) { logoEl.src = this.logoUrl; logoEl.style.display = this.logoUrl ? "block" : "none"; }
    if (emptyLogo) { emptyLogo.src = this.logoUrl; emptyLogo.style.display = this.logoUrl ? "block" : "none"; }

    const badge = this.shadowRoot.getElementById("status-badge");
    if (badge) {
      const online = this.isWithinBusinessHours();
      badge.innerHTML = `<span class="${online ? "online" : "offline"}-dot status-dot"></span>${online ? "Online" : "Offline"}`;
    }

    this.renderFaqChips();
    this.updateInputState();
  }

  updateInputState() {
    const input = this.shadowRoot.getElementById("input");
    const offlineBanner = this.shadowRoot.getElementById("offline-banner");
    if (!input) return;
    const online = this.isWithinBusinessHours();
    input.disabled = !online;
    input.placeholder = online ? "Send a message…" : "We're currently offline";
    if (offlineBanner) offlineBanner.style.display = online ? "none" : "flex";
  }

  // ─── Prechat ──────────────────────────────────────────────────────────────

  needsPrechat() {
    return (this.prechatCollectName || this.prechatCollectEmail) && !this.prechatSubmitted;
  }

  showPrechatIfNeeded() {
    const prechat = this.shadowRoot.getElementById("prechat");
    const main = this.shadowRoot.getElementById("chat-main-area");
    if (!prechat || !main) return;
    if (this.needsPrechat()) {
      prechat.style.display = "flex";
      main.style.display = "none";
    } else {
      prechat.style.display = "none";
      main.style.display = "flex";
    }
  }

  submitPrechat() {
    const nameInput = this.shadowRoot.getElementById("prechat-name");
    const emailInput = this.shadowRoot.getElementById("prechat-email");
    if (this.prechatCollectName && nameInput && !nameInput.value.trim()) { nameInput.focus(); nameInput.style.borderColor = "var(--accent)"; return; }
    if (this.prechatCollectEmail && emailInput) {
      const email = emailInput.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailInput.focus(); emailInput.style.borderColor = "var(--accent)"; return; }
    }
    if (nameInput) this.prechatData.name = nameInput.value.trim();
    if (emailInput) this.prechatData.email = emailInput.value.trim();
    this.prechatSubmitted = true;
    this.showPrechatIfNeeded();
    setTimeout(() => this.shadowRoot.getElementById("input")?.focus(), 100);
  }

  // ─── FAQ chips ────────────────────────────────────────────────────────────

  renderFaqChips() {
    const container = this.shadowRoot.getElementById("faq-chips");
    if (!container) return;
    const faqs = this.faqSuggestions;
    if (!faqs.length) { container.style.display = "none"; return; }
    container.style.display = "flex";
    container.innerHTML = faqs.map(q => `<button class="faq-chip" data-question="${this.escapeHtml(q)}">${this.escapeHtml(q)}</button>`).join("");
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  render() {
    const isLight = this.theme === "light";
    this.shadowRoot.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :host {
          --bg: ${isLight ? "#ffffff" : "#0a0a0b"};
          --bg-raised: ${isLight ? "#f5f5f7" : "#111113"};
          --bg-hover: ${isLight ? "#ebebef" : "#1a1a1f"};
          --border: ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.07)"};
          --border-strong: ${isLight ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.12)"};
          --text: ${isLight ? "#111113" : "#e8e8ed"};
          --text-muted: #6b6b78;
          --text-subtle: ${isLight ? "#b0b0bc" : "#3d3d47"};
          --accent: #7c6af7;
          --accent-dim: rgba(124,106,247,0.15);
          --accent-glow: rgba(124,106,247,0.25);
          --user-bubble: ${isLight ? "rgba(124,106,247,0.1)" : "#1e1b3a"};
          --ai-bubble: ${isLight ? "#f0f0f5" : "#16161a"};
          --sidebar-w: 160px;
          --header-h: 52px;
          --radius: 16px;
          --radius-sm: 10px;
          --font: 'Geist', system-ui, sans-serif;
          --font-mono: 'Geist Mono', monospace;
          position: fixed; right: 20px; bottom: 20px; z-index: 999999; font-family: var(--font);
        }

        #launcher {
          width: 64px; height: 64px; border: none; border-radius: 999px;
          background: var(--accent); color: white; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
          transition: transform 0.18s ease, opacity 0.18s ease;
        }
        #launcher:hover { transform: translateY(-2px); }
        #launcher:active { transform: scale(0.96); }

        #widget {
          width: 420px; height: min(560px, calc(100vh - 40px));
          background: var(--bg); border-radius: 24px; overflow: hidden;
          display: flex; flex-direction: column;
          box-shadow: 0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
          opacity: 0; pointer-events: none;
          transform: translateY(16px) scale(0.96); transform-origin: bottom right;
          transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          position: absolute; right: 0; bottom: 78px;
        }
        #widget.open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }

        @media (max-width: 640px) {
          :host { right: 0; bottom: 0; }
          #launcher { right: 16px; bottom: 16px; position: fixed; }
          #widget { width: 100vw; height: 100vh; max-height: 100vh; right: 0; bottom: 0; border-radius: 0; }
        }

        #shell { display: flex; width: 100%; height: 100%; background: var(--bg); color: var(--text); overflow: hidden; }

        #sidebar {
          width: var(--sidebar-w); flex-shrink: 0;
          display: flex; flex-direction: column;
          background: var(--bg-raised); border-right: 1px solid var(--border);
        }
        #sidebar-header {
          height: var(--header-h); display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px; border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        #sidebar-header span { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
        #new-chat-btn {
          width: 26px; height: 26px; border-radius: 7px;
          border: 1px solid var(--border-strong); background: transparent;
          color: var(--text-muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s, color 0.15s; font-size: 18px; line-height: 1;
        }
        #new-chat-btn:hover { background: var(--bg-hover); color: var(--text); }
        #chat-list { flex: 1; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
        .chat-item {
          padding: 8px 10px; border-radius: 8px; cursor: pointer;
          font-size: 12.5px; color: var(--text-muted);
          transition: background 0.12s, color 0.12s;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          border: 1px solid transparent;
        }
        .chat-item:hover { background: var(--bg-hover); color: var(--text); }
        .chat-item.active { color: var(--text); }
        .chat-item-time { font-size: 10px; color: var(--text-subtle); margin-top: 2px; font-family: var(--font-mono); }

        #main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }

        #topbar {
          height: var(--header-h); border-bottom: 1px solid var(--border);
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 14px; flex-shrink: 0; gap: 10px;
        }
        #topbar-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
        #topbar-logo { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; display: none; flex-shrink: 0; }
        #topbar-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #status-badge {
          display: flex; align-items: center; gap: 5px;
          font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; flex-shrink: 0;
        }
        .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .online-dot { background: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.25); }
        .offline-dot { background: var(--text-muted); }
        #topbar-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .topbar-btn {
          width: 30px; height: 30px; border-radius: 8px; border: none;
          background: transparent; color: var(--text-muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .topbar-btn:hover { background: var(--bg-hover); color: var(--text); }

        #prechat {
          flex: 1; display: none; flex-direction: column;
          align-items: center; justify-content: center; padding: 28px 24px; gap: 20px;
        }
        #prechat-inner { width: 100%; display: flex; flex-direction: column; gap: 14px; }
        #prechat h3 { font-size: 15px; font-weight: 600; color: var(--text); }
        #prechat p { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
        .prechat-field { display: flex; flex-direction: column; gap: 6px; }
        .prechat-field label { font-size: 11px; font-weight: 500; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }
        .prechat-field input {
          background: var(--bg-raised); border: 1px solid var(--border-strong);
          border-radius: 10px; padding: 10px 12px;
          color: var(--text); font-family: var(--font); font-size: 14px;
          outline: none; transition: border-color 0.15s;
        }
        .prechat-field input:focus { border-color: var(--accent); }
        .prechat-field input::placeholder { color: var(--text-subtle); }
        #prechat-submit {
          width: 100%; padding: 11px; background: var(--accent); color: white;
          border: none; border-radius: 12px; font-family: var(--font); font-size: 14px; font-weight: 500;
          cursor: pointer; transition: opacity 0.15s; margin-top: 4px;
        }
        #prechat-submit:hover { opacity: 0.88; }

        #chat-main-area { flex: 1; display: flex; flex-direction: column; min-height: 0; }

        #empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 12px; text-align: center; color: var(--text-muted); padding: 28px;
        }
        #empty-logo { width: 52px; height: 52px; border-radius: 14px; object-fit: cover; display: none; }
        #empty-icon {
          width: 56px; height: 56px; border-radius: 18px;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-raised); border: 1px solid var(--border); color: var(--text-subtle);
        }
        #empty h2 { font-size: 15px; font-weight: 600; color: var(--text); }
        #empty p { font-size: 13px; line-height: 1.6; max-width: 240px; }
        #faq-chips { display: none; flex-wrap: wrap; gap: 8px; justify-content: center; padding: 0 28px 4px; }
        .faq-chip {
          padding: 7px 12px; border-radius: 999px; border: 1px solid var(--border-strong);
          background: var(--bg-raised); color: var(--text-muted);
          font-family: var(--font); font-size: 12.5px; cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
          white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
        }

        #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; scroll-behavior: smooth; }
        .msg-row { display: flex; animation: fadeUp 0.18s ease both; }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.ai { justify-content: flex-start; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .bubble {
          max-width: 80%; padding: 10px 13px; border-radius: 16px;
          font-size: 14px; line-height: 1.6; word-break: break-word;
        }
        .msg-row.user .bubble { background: var(--user-bubble); border-bottom-right-radius: 4px; border: 1px solid rgba(124,106,247,0.2); }
        .msg-row.ai .bubble { background: var(--ai-bubble); border-bottom-left-radius: 4px; border: 1px solid var(--border); }
        .msg-meta { margin-top: 4px; padding: 0 2px; font-size: 10.5px; color: var(--text-subtle); font-family: var(--font-mono); }
        .msg-row.user .msg-meta { text-align: right; }

        #typing { display: none; padding: 0 16px 14px; }
        #typing.visible { display: flex; }
        .typing-bubble { background: var(--ai-bubble); border: 1px solid var(--border); border-radius: 14px; border-bottom-left-radius: 4px; padding: 12px 16px; display: flex; gap: 5px; }
        .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); animation: bounce 1.2s infinite ease-in-out; }
        .dot:nth-child(2) { animation-delay: 0.18s; }
        .dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }

        #offline-banner {
          display: none; align-items: center; justify-content: center; gap: 8px;
          padding: 10px 16px; background: var(--bg-raised); border-top: 1px solid var(--border);
          font-size: 13px; color: var(--text-muted);
        }

        #input-area { padding: 12px; border-top: 1px solid var(--border); background: var(--bg); flex-shrink: 0; }
        #input-row {
          display: flex; gap: 8px; align-items: flex-end;
          background: var(--bg-raised); border: 1px solid var(--border-strong);
          border-radius: 16px; padding: 8px 8px 8px 14px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        #input {
          flex: 1; background: transparent; border: none; outline: none;
          resize: none; color: var(--text); font-family: var(--font);
          font-size: 14px; line-height: 1.5; min-height: 22px; max-height: 120px; overflow-y: auto;
        }
        #input::placeholder { color: var(--text-subtle); }
        #input:disabled { opacity: 0.5; cursor: not-allowed; }
        #send-btn {
          width: 36px; height: 36px; border-radius: 10px; border: none;
          background: var(--accent); color: white; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: opacity 0.15s, transform 0.1s; flex-shrink: 0;
        }
        #send-btn:hover { opacity: 0.88; }
        #send-btn:active { transform: scale(0.95); }
        #send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

          .error-msg { font-size: 12px; color: var(--text-muted); text-align: center; padding: 8px; }
  #auth-screen {
    flex: 1; display: none; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 28px 24px; gap: 20px;
  }
  #auth-screen.visible { display: flex; }
  #auth-inner { width: 100%; display: flex; flex-direction: column; gap: 14px; }
  #auth-screen h3 { font-size: 15px; font-weight: 600; color: var(--text); }
  #auth-screen p { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
  .auth-field { display: flex; flex-direction: column; gap: 6px; }
  .auth-field label { font-size: 11px; font-weight: 500; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }
  .auth-field input {
    background: var(--bg-raised); border: 1px solid var(--border-strong);
    border-radius: 10px; padding: 10px 12px;
    color: var(--text); font-family: var(--font); font-size: 14px;
    outline: none; transition: border-color 0.15s;
  }
  .auth-field input:focus { border-color: var(--accent); }
  .auth-field input::placeholder { color: var(--text-subtle); }
  #auth-submit {
    width: 100%; padding: 11px; background: var(--accent); color: white;
    border: none; border-radius: 12px; font-family: var(--font);
    font-size: 14px; font-weight: 500; cursor: pointer;
    transition: opacity 0.15s; margin-top: 4px;
  }
  #auth-submit:hover { opacity: 0.88; }
  #auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  #auth-toggle { font-size: 13px; color: var(--text-muted); text-align: center; }
  #auth-toggle span { color: var(--accent); cursor: pointer; }
  #auth-toggle span:hover { text-decoration: underline; }
  #auth-error { font-size: 12px; color: #f87171; text-align: center; min-height: 16px; }
        @media (max-width: 860px) { #sidebar { display: none; } }
      </style>

      <button id="launcher" aria-label="Open chat">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div id="widget">
        <div id="shell">
          <aside id="sidebar">
            <div id="sidebar-header">
              <span>Chats</span>
              <button id="new-chat-btn" title="New chat">+</button>
            </div>
            <div id="chat-list"></div>
          </aside>

          <main id="main">
  <div id="topbar">
    <div id="topbar-left">
      <img id="topbar-logo" alt="Logo" />
      <div id="topbar-title">${this.escapeHtml(this.widgetTitle)}</div>
    </div>
    <div id="status-badge">
      <span class="online-dot status-dot"></span>Online
    </div>
    <div id="topbar-actions">
      <button class="topbar-btn" id="minimize-btn" title="Minimize">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <button class="topbar-btn" id="close-btn" title="Close">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  <!-- ✅ auth screen — separate from prechat, hidden by default -->
  <div id="auth-screen">
    <div id="auth-inner">
      <div>
        <h3 id="auth-title">Welcome back</h3>
        <p id="auth-subtitle">Sign in to continue your conversation.</p>
      </div>
      <div class="auth-field">
        <label>Email</label>
        <input id="auth-email" type="email" placeholder="jane@example.com" autocomplete="email" />
      </div>
      <div class="auth-field" id="auth-name-field" style="display:none">
        <label>Name</label>
        <input id="auth-name" type="text" placeholder="Jane Smith" autocomplete="name" />
      </div>
      <div class="auth-field">
        <label>Password</label>
        <input id="auth-password" type="password" placeholder="••••••••" autocomplete="current-password" />
      </div>
      <div id="auth-error"></div>
      <button id="auth-submit">Sign in →</button>
      <div id="auth-toggle">
        Don't have an account? <span id="auth-switch">Create one</span>
      </div>
    </div>
  </div>

  <!-- ✅ chat area — shown after auth -->
  <div id="chat-main-area">
    <div id="empty">
      <img id="empty-logo" alt="Logo" />
      <div id="empty-icon" ${this.logoUrl ? 'style="display:none"' : ""}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h2 id="empty-title">${this.escapeHtml(this.welcomeMessage || this.widgetTitle)}</h2>
      <p id="empty-subtitle">Send a message to get started.</p>
      <div id="faq-chips"></div>
    </div>

    <div id="messages" style="display:none;"></div>

    <div id="typing">
      <div class="typing-bubble">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
    </div>

    <div id="offline-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
      <span>We're currently offline.</span>
    </div>

    <div id="input-area">
      <div id="input-row">
        <textarea id="input" rows="1" placeholder="Send a message…"></textarea>
        <button id="send-btn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</main>
        </div>
      </div>
    `;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  bindEvents() {
    const sr = this.shadowRoot;

    sr.getElementById("launcher").addEventListener("click", () => this.toggleWidget());
    sr.getElementById("close-btn").addEventListener("click", () => this.closeWidget());
    sr.getElementById("minimize-btn").addEventListener("click", () => this.closeWidget());

    const input = sr.getElementById("input");
    const sendBtn = sr.getElementById("send-btn");

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
      sendBtn.disabled = !input.value.trim() || this.isPending || !this.isWithinBusinessHours();
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });

    sendBtn.addEventListener("click", () => this.sendMessage());

    const prechatSubmit = sr.getElementById("prechat-submit");
    if (prechatSubmit) {
      prechatSubmit.addEventListener("click", () => this.submitPrechat());
      sr.querySelectorAll(".prechat-field input").forEach(el => {
        el.addEventListener("keydown", e => { if (e.key === "Enter") this.submitPrechat(); });
      });
    }

    sr.getElementById("new-chat-btn").addEventListener("click", () => this.startNewChat());

    sr.getElementById("chat-list").addEventListener("click", e => {
      const item = e.target.closest(".chat-item");
      if (!item) return;
      this.switchChat(item.dataset.id);
    });

    sr.getElementById("empty").addEventListener("click", e => {
      const chip = e.target.closest(".faq-chip");
      if (!chip || this.needsPrechat()) return;
      const question = chip.dataset.question;
      if (question) {
        input.value = question;
        input.dispatchEvent(new Event("input"));
        this.sendMessage();
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && this.isWidgetOpen) this.closeWidget();
    });
    // Auth events
    const authSubmit = sr.getElementById("auth-submit");
    const authSwitch = sr.getElementById("auth-switch");
    const authEmail = sr.getElementById("auth-email");
    const authPassword = sr.getElementById("auth-password");
    const authName = sr.getElementById("auth-name");

    authSwitch.addEventListener("click", () => this.toggleAuthMode());

    authSubmit.addEventListener("click", () => this.submitAuth());

    [authEmail, authPassword, authName].forEach(el => {
      el.addEventListener("keydown", e => {
        if (e.key === "Enter") this.submitAuth();
      });
    });
  }

  // ─── Widget open/close ────────────────────────────────────────────────────

  toggleWidget() { this.isWidgetOpen ? this.closeWidget() : this.openWidget(); }

  // openWidget() {
  //   this.shadowRoot.getElementById("widget").classList.add("open");
  //   this.isWidgetOpen = true;
  //   this.showPrechatIfNeeded();
  //   this.updateInputState();
  //
  //   // Init chat on first open
  //   if (!this.chatId && !this.isInitializing) {
  //     this.initChat().then(() => this.fetchChatList());
  //   }
  //
  //   setTimeout(() => {
  //     const target = this.needsPrechat()
  //       ? this.shadowRoot.querySelector(".prechat-field input")
  //       : this.shadowRoot.getElementById("input");
  //     target?.focus();
  //   }, 180);
  // }
  openWidget() {
    this.shadowRoot.getElementById("widget").classList.add("open");
    this.isWidgetOpen = true;

    if (!this._customerToken) {
      this.showAuthScreen("login");
      return;
    }

    if (!this.chatId && !this.isInitializing) {
      this.initChat().then(() => this.fetchChatList());
    }
  }
  closeWidget() {
    this.shadowRoot.getElementById("widget").classList.remove("open");
    this.isWidgetOpen = false;
  }

  // ─── Chat list render ─────────────────────────────────────────────────────

  renderChatList() {
    const list = this.shadowRoot.getElementById("chat-list");
    if (!this.chats.length) {
      list.innerHTML = `<div style="padding: 12px 10px; font-size: 12px; color: var(--text-subtle);">No chats yet</div>`;
      return;
    }
    list.innerHTML = this.chats.map(c => `
      <div class="chat-item${c.id === this.activeChatId ? " active" : ""}" data-id="${c.id}">
        ${this.escapeHtml(c.title || "Chat")}
        <div class="chat-item-time">${this.formatTime(new Date(c.updatedAt))}</div>
      </div>
    `).join("");
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  showEmptyOrMessages() {
    const empty = this.shadowRoot.getElementById("empty");
    const messages = this.shadowRoot.getElementById("messages");
    if (!empty || !messages) return;
    if (this.messages.length === 0) {
      empty.style.display = "flex";
      messages.style.display = "none";
    } else {
      empty.style.display = "none";
      messages.style.display = "flex";
    }
  }

  addMessage(content, role, date = new Date()) {
    const messages = this.shadowRoot.getElementById("messages");
    const empty = this.shadowRoot.getElementById("empty");
    if (!messages) return;
    empty.style.display = "none";
    messages.style.display = "flex";

    const row = document.createElement("div");
    row.className = `msg-row ${role}`;
    row.innerHTML = `
      <div>
        <div class="bubble">${this.escapeHtml(content)}</div>
        <div class="msg-meta">${this.formatTime(date)}</div>
      </div>
    `;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    this.messages.push({ role: role === "user" ? "user" : "assistant", content });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

customElements.define("chat-widget", ChatWidget);
