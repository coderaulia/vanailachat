const modelSelect = document.getElementById("modelSelect");
const selectedModelText = document.getElementById("selectedModelText");
const serverStatusText = document.getElementById("serverStatusText");
const promptInput = document.getElementById("promptInput");
const chatForm = document.getElementById("chatForm");
const chatLog = document.getElementById("chatLog");
const statusText = document.getElementById("statusText");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const newChatBtn = document.getElementById("newChatBtn");
const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("historyCount");
const sidebar = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const contextWindowText = document.getElementById("contextWindowText");
const contextWindowMeter = document.getElementById("contextWindowMeter");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const attachmentTray = document.getElementById("attachmentTray");
const searchToggle = document.getElementById("searchToggle");

const MOBILE_SIDEBAR_BREAKPOINT = window.matchMedia("(max-width: 860px)");
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const HISTORY_STORAGE_KEY = "chatHistories";
const STORAGE_VERSION = 2;
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});
const SEND_BUTTON_HTML = sendBtn.innerHTML;

// ---------------------------------------------------------------------------
// Markdown + Syntax Highlighting (marked + highlight.js loaded via CDN)
// ---------------------------------------------------------------------------
marked.use({ gfm: true, breaks: true });

function encodeAttr(str) {
	return str
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

let conversation = [];
let availableModels = [];
let currentModel = null;
let currentContextWindow = null;
let isSending = false;
let currentChatId = null;
let chatHistories = loadChatHistories();
let attachedFiles = [];

function generateMessageId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMessage(message) {
	return {
		id: typeof message?.id === "string" ? message.id : generateMessageId(),
		role: message?.role === "assistant" ? "assistant" : "user",
		content: typeof message?.content === "string" ? message.content : "",
		timestamp: typeof message?.timestamp === "number" ? message.timestamp : Date.now(),
		state: "done",
	};
}

function normalizeChat(chatId, chat) {
	const updatedAt =
		typeof chat?.updatedAt === "number"
			? chat.updatedAt
			: typeof chat?.timestamp === "number"
				? chat.timestamp
				: Date.now();
	const createdAt =
		typeof chat?.createdAt === "number" ? chat.createdAt : updatedAt;
	const normalizedConversation = Array.isArray(chat?.conversation)
		? chat.conversation.map(normalizeMessage)
		: [];
	const stats = chat?.stats || {};

	return {
		id: chat?.id || chatId,
		title: typeof chat?.title === "string" ? chat.title : "Untitled chat",
		conversation: normalizedConversation,
		createdAt,
		updatedAt,
		timestamp: updatedAt,
		model: typeof chat?.model === "string" ? chat.model : null,
		contextWindow:
			typeof chat?.contextWindow === "number" ? chat.contextWindow : null,
		stats: {
			messageCount:
				typeof stats.messageCount === "number"
					? stats.messageCount
					: normalizedConversation.length,
			estimatedTokens:
				typeof stats.estimatedTokens === "number"
					? stats.estimatedTokens
					: estimateTokensForConversation(normalizedConversation),
		},
	};
}

function loadChatHistories() {
	try {
		const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || {};
		const rawChats =
			parsed && typeof parsed === "object" && parsed.version === STORAGE_VERSION
				? parsed.chats || {}
				: parsed;

		return Object.fromEntries(
			Object.entries(rawChats).map(([chatId, chat]) => [
				chatId,
				normalizeChat(chatId, chat),
			]),
		);
	} catch (error) {
		console.error("Unable to parse saved chat history.", error);
		return {};
	}
}

function persistHistories() {
	try {
		localStorage.setItem(
			HISTORY_STORAGE_KEY,
			JSON.stringify({
				version: STORAGE_VERSION,
				chats: chatHistories,
			}),
		);
	} catch (error) {
		console.warn("localStorage quota exceeded. Pruning oldest chats...");
		const chatIds = Object.keys(chatHistories).sort(
			(a, b) => chatHistories[a].updatedAt - chatHistories[b].updatedAt,
		);
		if (chatIds.length > 0) {
			delete chatHistories[chatIds[0]];
			persistHistories(); // Retry
		}
	}
}

function estimateTokens(text) {
	if (!text) return 0;
	return Math.max(1, Math.ceil(text.trim().length / 4));
}

function estimateTokensForConversation(messages = conversation) {
	return messages.reduce((total, message) => {
		if (!message.content) return total;
		return total + estimateTokens(message.content) + 6;
	}, 0);
}

function getPersistableConversation() {
	return conversation
		.filter((message) => message.state === "done")
		.map(({ id, role, content, timestamp }) => ({
			id,
			role,
			content,
			timestamp,
			state: "done",
		}));
}

function createMessage(role, content, options = {}) {
	return {
		id: options.id || generateMessageId(),
		role,
		content,
		timestamp: options.timestamp || Date.now(),
		state: options.state || "done",
	};
}

function createPendingAssistantMessage() {
	return createMessage("assistant", "", { state: "loading" });
}

function createEmptyState() {
	const state = document.createElement("section");
	state.className = "chat-empty";

	const title = document.createElement("strong");
	title.textContent = "Start a chat with your local model.";

	const body = document.createElement("p");
	body.textContent =
		"Ask for code help, quick drafts, shell commands, or debugging ideas. Responses will render with headings, lists, and code blocks when the model returns them.";

	state.append(title, body);
	return state;
}

function createCopyButton(text) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "copy-code-btn";
	button.setAttribute("aria-label", "Copy code block");
	button.dataset.copy = text;
	button.textContent = "Copy";
	return button;
}

function renderAssistantContent(text) {
	const container = document.createElement("div");
	container.className = "message__prose";
	container.innerHTML = marked.parse(text);

	// Post-process: wrap every <pre><code> in our .code-block shell
	// and attach copy buttons + syntax highlighting.
	container.querySelectorAll("pre > code").forEach((codeEl) => {
		const rawText = codeEl.textContent;
		const langClass = [...codeEl.classList].find((c) =>
			c.startsWith("language-"),
		);
		const lang = langClass ? langClass.replace("language-", "") : "";

		if (lang && hljs.getLanguage(lang)) {
			codeEl.innerHTML = hljs.highlight(rawText, { language: lang }).value;
		} else {
			const result = hljs.highlightAuto(rawText);
			codeEl.innerHTML = result.value;
		}
		codeEl.classList.add("hljs");

		const pre = codeEl.parentElement;
		const wrapper = document.createElement("section");
		wrapper.className = "code-block";

		const header = document.createElement("div");
		header.className = "code-block__header";

		const label = document.createElement("span");
		label.className = "code-block__label";
		label.textContent = lang || "code";

		header.append(label, createCopyButton(rawText));
		pre.replaceWith(wrapper);
		wrapper.append(header, pre);
	});

	if (!container.children.length) {
		const fallback = document.createElement("p");
		fallback.textContent = text;
		container.append(fallback);
	}

	return container;
}


function createLoadingIndicator() {
	const wrapper = document.createElement("div");
	wrapper.className = "message__loading";

	const dots = document.createElement("div");
	dots.className = "message__loading-dots";
	for (let index = 0; index < 3; index += 1) {
		const dot = document.createElement("span");
		dot.className = "message__loading-dot";
		dots.append(dot);
	}

	const lines = document.createElement("div");
	lines.className = "message__loading-lines";
	for (let index = 0; index < 3; index += 1) {
		const line = document.createElement("span");
		line.className = "message__loading-line";
		lines.append(line);
	}

	wrapper.append(dots, lines);
	return wrapper;
}

function renderMessageBody(message, body) {
	body.innerHTML = "";

	if (message.role === "assistant") {
		if (message.state === "loading") {
			body.append(createLoadingIndicator());
			return;
		}
		if (message.state === "streaming") {
			const pre = document.createElement("pre");
			pre.className = "message__plain";
			pre.textContent = message.content;
			body.append(pre);
			return;
		}
		body.append(renderAssistantContent(message.content));
		return;
	}

	const content = document.createElement("pre");
	content.className = "message__plain";
	content.textContent = message.content;
	body.append(content);
}

function createMessageNode(message) {
	const wrapper = document.createElement("article");
	wrapper.className = `message ${message.role}`;
	if (message.state === "loading") {
		wrapper.classList.add("is-loading");
	}
	if (message.state === "typing") {
		wrapper.classList.add("is-typing");
	}
	wrapper.dataset.messageId = message.id;

	const meta = document.createElement("header");
	meta.className = "message__meta";

	const label = document.createElement("span");
	label.className = "message__role";
	label.textContent = message.role === "user" ? "You" : "Assistant";

	const timestamp = document.createElement("span");
	timestamp.className = "message__timestamp";
	timestamp.textContent = DATE_FORMATTER.format(message.timestamp);

	meta.append(label, timestamp);

	const body = document.createElement("div");
	body.className = "message__body";
	renderMessageBody(message, body);

	wrapper.append(meta, body);
	return wrapper;
}

function scrollConversationToBottom() {
	chatLog.scrollTop = chatLog.scrollHeight;
}

function updateContextStatus() {
	const usedTokens = estimateTokensForConversation(conversation);
	const totalTokens = currentContextWindow;
	const percent =
		totalTokens && totalTokens > 0
			? Math.min(100, Math.round((usedTokens / totalTokens) * 100))
			: 0;

	contextWindowText.textContent = totalTokens
		? `${usedTokens.toLocaleString()} / ${totalTokens.toLocaleString()}`
		: `${usedTokens.toLocaleString()} / --`;
	contextWindowMeter.style.width = `${percent}%`;
	contextWindowMeter.classList.toggle("is-warning", percent >= 70 && percent < 90);
	contextWindowMeter.classList.toggle("is-danger", percent >= 90);
}

function renderConversation() {
	chatLog.innerHTML = "";

	if (conversation.length === 0) {
		chatLog.append(createEmptyState());
		updateContextStatus();
		return;
	}

	const fragment = document.createDocumentFragment();
	conversation.forEach((message) => {
		fragment.append(createMessageNode(message));
	});
	chatLog.append(fragment);
	scrollConversationToBottom();
	updateContextStatus();
}

function updateMessageInDom(messageId) {
	const message = conversation.find((item) => item.id === messageId);
	if (!message) {
		renderConversation();
		return;
	}

	const currentNode = chatLog.querySelector(`[data-message-id="${messageId}"]`);
	if (!currentNode) {
		renderConversation();
		return;
	}

	currentNode.replaceWith(createMessageNode(message));
	scrollConversationToBottom();
	updateContextStatus();
}

// Lightweight update during streaming — only patches the <pre> text node,
// avoids replacing the whole <article> on every chunk.
function updateStreamingMessage(messageId, text) {
	const node = chatLog.querySelector(`[data-message-id="${messageId}"]`);
	if (!node) return;
	const body = node.querySelector(".message__body");
	if (!body) return;
	let pre = body.querySelector(".message__plain");
	if (!pre) {
		body.innerHTML = "";
		pre = document.createElement("pre");
		pre.className = "message__plain";
		body.append(pre);
	}
	pre.textContent = text;
	scrollConversationToBottom();
}


function setStatus(text, isError = false) {
	statusText.textContent = text;
	statusText.style.color = isError ? "#a13426" : "";
}

function setWorking(value) {
	isSending = value;
	sendBtn.disabled = value;
	clearBtn.disabled = value;
	modelSelect.disabled = value;
	promptInput.disabled = value;
	sendBtn.classList.toggle("is-loading", value);
	sendBtn.setAttribute("aria-busy", value ? "true" : "false");
	sendBtn.innerHTML = SEND_BUTTON_HTML;
}

function generateChatId() {
	return Date.now().toString();
}

function getChatTitle(messages) {
	const firstUserMessage =
		messages.find((message) => message.role === "user")?.content ||
		messages[0]?.content ||
		"Untitled chat";

	return firstUserMessage.length > 58
		? `${firstUserMessage.slice(0, 58)}…`
		: firstUserMessage;
}

function saveCurrentChat() {
	const persistedConversation = getPersistableConversation();
	if (persistedConversation.length === 0) return;

	if (!currentChatId) {
		currentChatId = generateChatId();
	}

	const existing = chatHistories[currentChatId] || {};
	const updatedAt = Date.now();

	chatHistories[currentChatId] = normalizeChat(currentChatId, {
		...existing,
		id: currentChatId,
		title: getChatTitle(persistedConversation),
		conversation: persistedConversation,
		createdAt: existing.createdAt || updatedAt,
		updatedAt,
		timestamp: updatedAt,
		model: currentModel,
		contextWindow: currentContextWindow,
		stats: {
			messageCount: persistedConversation.length,
			estimatedTokens: estimateTokensForConversation(persistedConversation),
		},
	});

	persistHistories();
	renderHistoryList();
}

function closeSidebarIfNeeded() {
	if (MOBILE_SIDEBAR_BREAKPOINT.matches) {
		setSidebarOpen(false);
	}
}

async function refreshContextWindow(modelName = currentModel) {
	if (!modelName) {
		currentContextWindow = null;
		updateContextStatus();
		return;
	}

	try {
		const response = await fetch(
			`/api/model-details?model=${encodeURIComponent(modelName)}`,
		);
		if (!response.ok) {
			throw new Error("Unable to load model details.");
		}

		const details = await response.json();
		currentContextWindow =
			typeof details.contextWindow === "number" ? details.contextWindow : null;
	} catch (error) {
		console.error(error);
		currentContextWindow = null;
	} finally {
		updateContextStatus();
	}
}

function loadChat(chatId) {
	const chat = chatHistories[chatId];
	if (!chat) return;

	conversation = chat.conversation.map(normalizeMessage);
	currentChatId = chatId;
	currentModel = chat.model || currentModel;
	currentContextWindow = chat.contextWindow || currentContextWindow;

	if (currentModel && availableModels.includes(currentModel)) {
		modelSelect.value = currentModel;
		selectedModelText.textContent = currentModel;
	}

	renderConversation();
	renderHistoryList();
	setStatus("Conversation loaded.");
	closeSidebarIfNeeded();

	if (currentModel && !chat.contextWindow) {
		refreshContextWindow(currentModel);
	}
}

function newChat() {
	saveCurrentChat();
	conversation = [];
	currentChatId = null;
	renderConversation();
	renderHistoryList();
	setStatus("Fresh chat ready.");
	closeSidebarIfNeeded();
}

function createHistoryEmptyState() {
	const empty = document.createElement("div");
	empty.className = "history-empty";

	const title = document.createElement("strong");
	title.textContent = "No saved chats yet.";

	const body = document.createElement("p");
	body.textContent =
		"Send your first message and this sidebar will start building a reusable conversation history.";

	empty.append(title, body);
	return empty;
}

function renderHistoryList() {
	historyList.innerHTML = "";

	const sortedHistories = Object.values(chatHistories).sort(
		(a, b) => b.updatedAt - a.updatedAt,
	);

	historyCount.textContent = `${sortedHistories.length} ${
		sortedHistories.length === 1 ? "chat" : "chats"
	}`;

	if (sortedHistories.length === 0) {
		historyList.append(createHistoryEmptyState());
		return;
	}

	const fragment = document.createDocumentFragment();
	sortedHistories.forEach((chat) => {
		const item = document.createElement("button");
		item.type = "button";
		item.className = `history-item ${chat.id === currentChatId ? "active" : ""}`;
		item.addEventListener("click", () => loadChat(chat.id));

		const contentWrap = document.createElement("div");
		contentWrap.className = "history-item__content";

		const title = document.createElement("span");
		title.className = "history-item__title";
		title.textContent = chat.title || "Untitled chat";

		const meta = document.createElement("span");
		meta.className = "history-item__meta";
		meta.textContent = DATE_FORMATTER.format(chat.updatedAt);

		contentWrap.append(title, meta);

		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "history-item__delete";
		deleteBtn.setAttribute("aria-label", "Delete chat");
		deleteBtn.innerHTML = "&times;";
		deleteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			delete chatHistories[chat.id];
			persistHistories();
			if (currentChatId === chat.id) {
				conversation = [];
				currentChatId = null;
				renderConversation();
				setStatus("Conversation deleted.");
			}
			renderHistoryList();
		});

		item.append(contentWrap, deleteBtn);
		fragment.append(item);
	});

	historyList.append(fragment);
}

function clearConversation() {
	conversation = [];
	renderConversation();
	setStatus("Conversation cleared.");

	if (currentChatId) {
		delete chatHistories[currentChatId];
		persistHistories();
		currentChatId = null;
		renderHistoryList();
	}
}

function removeMessage(messageId) {
	const index = conversation.findIndex((message) => message.id === messageId);
	if (index >= 0) {
		conversation.splice(index, 1);
	}
}



async function sendPrompt() {
	const pendingMsg = createPendingAssistantMessage();
	conversation.push(pendingMsg);
	renderConversation();

	const payload = {
		model: currentModel,
		messages: conversation
			.filter((m) => m.id !== pendingMsg.id)
			.map(({ role, content, images }) => {
				const msg = { role, content };
				if (images) msg.images = images;
				return msg;
			}),
		temperature: 0.7,
	};

	if (searchToggle && searchToggle.checked) {
		payload.tools = [{
			type: "function",
			function: {
				name: "search_web",
				description: "Search the web for real-time information, news, or documentation.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "The search query to look up on the web"
						}
					},
					required: ["query"]
				}
			}
		}];
	}
	
	payload.stream = true; 

	setWorking(true);
	setStatus("Sending request…");

	let fullText = "";

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errBody = await response.text();
			throw new Error(`Request failed (${response.status}): ${errBody}`);
		}

		// Switch message to streaming state so the body shows a <pre>
		const streamingMsg = conversation.find((m) => m.id === pendingMsg.id);
		if (streamingMsg) {
			streamingMsg.state = "streaming";
			streamingMsg.content = "";
			updateMessageInDom(pendingMsg.id);
		}

		if (!payload.stream) {
			// Buffered response handling (for tool calls)
			const data = await response.json();
			fullText = data.choices[0].message.content || "";
			const assistantMsg = conversation.find((m) => m.id === pendingMsg.id);
			if (assistantMsg) {
				assistantMsg.content = fullText;
				assistantMsg.state = "done";
				updateMessageInDom(pendingMsg.id);
			}
		} else {
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop(); // Hold the last incomplete line

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const dataStr = line.slice(6).trim();
					if (dataStr === "[DONE]") continue;
					try {
						const parsed = JSON.parse(dataStr);
						// Support both streaming (delta) and final message (message) formats
						const chunk = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content;
						if (chunk) {
							fullText += chunk;
							updateStreamingMessage(pendingMsg.id, fullText);
						}
					} catch (e) {
						console.warn("Error parsing SSE chunk:", e);
					}
				}
			}
		}

		// Re-render the completed message with full Markdown
		if (streamingMsg) {
			streamingMsg.state = "done";
			streamingMsg.content = fullText || "No response returned.";
			updateMessageInDom(pendingMsg.id);
			saveCurrentChat();
		}

		setStatus("Response received.");
	} catch (err) {
		console.error(err);
		removeMessage(pendingMsg.id);
		renderConversation();
		setStatus(`Error: ${err.message}`, true);
	} finally {
		setWorking(false);
	}
}

function setSidebarOpen(isOpen) {
	const shouldOpen = Boolean(isOpen && MOBILE_SIDEBAR_BREAKPOINT.matches);
	sidebar.classList.toggle("is-open", shouldOpen);
	sidebarBackdrop.classList.toggle("is-visible", shouldOpen);
	sidebarBackdrop.hidden = !shouldOpen;
	if (sidebarToggleBtn) {
		sidebarToggleBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
	}
}

function formatOllamaStatus(url) {
	if (!url) {
		return "Unavailable";
	}

	try {
		const parsed = new URL(url);
		return `Local · ${parsed.host}`;
	} catch {
		return url;
	}
}

async function fetchModelConfig() {
	try {
		const response = await fetch("/api/config");
		if (!response.ok) {
			throw new Error("Unable to fetch config.");
		}

		const config = await response.json();
		currentModel = config.selectedModel || currentModel;
		currentContextWindow =
			typeof config.contextWindow === "number" ? config.contextWindow : null;
		selectedModelText.textContent = currentModel || "No model selected";
		serverStatusText.textContent = formatOllamaStatus(config.ollamaUrl);
		updateContextStatus();
		return config;
	} catch (error) {
		console.error(error);
		setStatus(`Config error: ${error.message}`, true);
		selectedModelText.textContent = "Unavailable";
		serverStatusText.textContent = "Unavailable";
		currentContextWindow = null;
		updateContextStatus();
		return null;
	}
}

async function fetchModels() {
	try {
		const response = await fetch("/api/models");
		if (!response.ok) {
			throw new Error("Unable to load models.");
		}

		const data = await response.json();
		availableModels = data.models || [];
		modelSelect.innerHTML = "";

		if (availableModels.length === 0) {
			modelSelect.innerHTML = '<option value="">No installed models found</option>';
			currentModel = null;
			selectedModelText.textContent = "No installed models";
			currentContextWindow = null;
			updateContextStatus();
			return;
		}

		availableModels.forEach((model) => {
			const option = document.createElement("option");
			option.value = model;
			option.textContent = model;
			modelSelect.append(option);
		});

		currentModel = availableModels.includes(currentModel)
			? currentModel
			: availableModels[0];

		modelSelect.value = currentModel;
		selectedModelText.textContent = currentModel;
	} catch (error) {
		console.error(error);
		modelSelect.innerHTML = '<option value="">Unable to load models</option>';
		selectedModelText.textContent = "Unavailable";
		currentContextWindow = null;
		updateContextStatus();
	}
}

chatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	let prompt = promptInput.value.trim();
	
	if (!prompt && attachedFiles.length === 0) {
		setStatus("Enter a message or attach a file.", true);
		return;
	}
	if (!currentModel) {
		setStatus("Select a model before sending.", true);
		return;
	}

	if (attachedFiles.length > 0) {
		const textFiles = attachedFiles.filter(f => f.type === "text");
		const images = attachedFiles.filter(f => f.type === "image").map(f => f.content);
		
		if (textFiles.length > 0) {
			const fileContext = textFiles.map(f => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
			prompt = `${fileContext}\n\n${prompt}`.trim();
		}
		
		const userMessage = createMessage("user", prompt);
		if (images.length > 0) {
			userMessage.images = images;
		}
		
		attachedFiles = [];
		renderAttachmentTray();
		conversation.push(userMessage);
	} else {
		const userMessage = createMessage("user", prompt);
		conversation.push(userMessage);
	}
	promptInput.value = "";
	renderConversation();
	saveCurrentChat();
	closeSidebarIfNeeded();

	await sendPrompt();
});

promptInput.addEventListener("keydown", (event) => {
	if (event.ctrlKey && event.key === "Enter") {
		event.preventDefault();
		chatForm.requestSubmit();
	}
});

modelSelect.addEventListener("change", async () => {
	currentModel = modelSelect.value || null;
	selectedModelText.textContent = currentModel || "No model selected";
	setStatus(currentModel ? `Using ${currentModel}.` : "No model selected.");
	await refreshContextWindow(currentModel);
	if (conversation.length > 0) {
		saveCurrentChat();
	}
});

if (attachBtn && fileInput) {
	attachBtn.addEventListener("click", () => {
		fileInput.click();
	});

	fileInput.addEventListener("change", async (event) => {
		const files = event.target.files;
		for (const file of files) {
			if (file.size > 5 * 1024 * 1024) {
				setStatus(`File ${file.name} is too large (max 5MB)`, true);
				continue;
			}
			try {
				const isImage = file.type.startsWith("image/");
				if (isImage) {
					const base64 = await new Promise((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result.split(",")[1]);
						reader.onerror = reject;
						reader.readAsDataURL(file);
					});
					attachedFiles.push({ name: file.name, type: "image", content: base64 });
				} else {
					const text = await file.text();
					attachedFiles.push({ name: file.name, type: "text", content: text });
				}
			} catch (err) {
				setStatus(`Error reading ${file.name}`, true);
			}
		}
		fileInput.value = ""; // Reset
		renderAttachmentTray();
	});
}

function renderAttachmentTray() {
	attachmentTray.innerHTML = "";
	if (attachedFiles.length === 0) {
		attachmentTray.hidden = true;
		return;
	}
	attachmentTray.hidden = false;

	attachedFiles.forEach((file, index) => {
		const pill = document.createElement("div");
		pill.className = "attachment-pill";
		
		const nameSpan = document.createElement("span");
		nameSpan.textContent = file.name;
		
		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "attachment-remove";
		removeBtn.innerHTML = "&times;";
		removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
		removeBtn.addEventListener("click", () => {
			attachedFiles.splice(index, 1);
			renderAttachmentTray();
		});

		pill.append(nameSpan, removeBtn);
		attachmentTray.append(pill);
	});
}

clearBtn.addEventListener("click", () => {
	clearConversation();
});

newChatBtn.addEventListener("click", () => {
	newChat();
});

if (sidebarToggleBtn) {
	sidebarToggleBtn.addEventListener("click", () => {
		setSidebarOpen(!sidebar.classList.contains("is-open"));
	});
}

sidebarBackdrop.addEventListener("click", () => {
	setSidebarOpen(false);
});

MOBILE_SIDEBAR_BREAKPOINT.addEventListener("change", (event) => {
	if (!event.matches) {
		setSidebarOpen(false);
		sidebarBackdrop.hidden = true;
	}
});

chatLog.addEventListener("click", async (event) => {
	const button = event.target.closest(".copy-code-btn");
	if (!button) return;

	try {
		await navigator.clipboard.writeText(button.dataset.copy || "");
		button.textContent = "Copied";
		button.classList.add("is-copied");
		window.setTimeout(() => {
			button.textContent = "Copy";
			button.classList.remove("is-copied");
		}, 1500);
	} catch (error) {
		console.error("Unable to copy code block.", error);
		setStatus("Unable to copy code block.", true);
	}
});

const themeToggleBtn = document.getElementById("themeToggleBtn");
if (themeToggleBtn) {
	themeToggleBtn.addEventListener("click", () => {
		const isDark = document.documentElement.getAttribute("data-theme") === "dark";
		document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
		localStorage.setItem("vanaila-theme", isDark ? "light" : "dark");
	});
}

async function init() {
	const savedTheme = localStorage.getItem("vanaila-theme");
	if (savedTheme) {
		document.documentElement.setAttribute("data-theme", savedTheme);
	} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
		document.documentElement.setAttribute("data-theme", "dark");
	}

	setStatus("Initializing WebUI...");
	await fetchModelConfig();
	await fetchModels();
	if (currentModel) {
		await refreshContextWindow(currentModel);
	}
	renderHistoryList();
	renderConversation();
	setStatus("Ready");
	promptInput.focus();
}

init();
