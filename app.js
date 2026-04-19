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

const MOBILE_SIDEBAR_BREAKPOINT = window.matchMedia("(max-width: 860px)");
const HISTORY_STORAGE_KEY = "chatHistories";
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

let conversation = [];
let availableModels = [];
let currentModel = null;
let isSending = false;
let currentChatId = null;
let chatHistories = loadChatHistories();

function loadChatHistories() {
	try {
		const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || {};
		return Object.fromEntries(
			Object.entries(parsed).map(([chatId, chat]) => [
				chatId,
				{
					...chat,
					conversation: Array.isArray(chat.conversation)
						? chat.conversation.map(normalizeMessage)
						: [],
				},
			]),
		);
	} catch (error) {
		console.error("Unable to parse saved chat history.", error);
		return {};
	}
}

function normalizeMessage(message) {
	return {
		role: message?.role === "assistant" ? "assistant" : "user",
		content: typeof message?.content === "string" ? message.content : "",
		timestamp: typeof message?.timestamp === "number" ? message.timestamp : Date.now(),
	};
}

function persistHistories() {
	localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(chatHistories));
}

function createMessage(role, content) {
	return {
		role,
		content,
		timestamp: Date.now(),
	};
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

function appendInlineContent(target, text) {
	const tokenPattern =
		/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
	let cursor = 0;
	let match;

	while ((match = tokenPattern.exec(text)) !== null) {
		if (match.index > cursor) {
			target.append(document.createTextNode(text.slice(cursor, match.index)));
		}

		const token = match[0];
		if (token.startsWith("`") && token.endsWith("`")) {
			const code = document.createElement("code");
			code.textContent = token.slice(1, -1);
			target.append(code);
		} else if (token.startsWith("**") && token.endsWith("**")) {
			const strong = document.createElement("strong");
			appendInlineContent(strong, token.slice(2, -2));
			target.append(strong);
		} else if (token.startsWith("*") && token.endsWith("*")) {
			const emphasis = document.createElement("em");
			appendInlineContent(emphasis, token.slice(1, -1));
			target.append(emphasis);
		} else if (token.startsWith("[")) {
			const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
			if (linkMatch) {
				const [, label, href] = linkMatch;
				const link = document.createElement("a");
				link.href = href;
				link.target = "_blank";
				link.rel = "noreferrer";
				link.textContent = label;
				target.append(link);
			} else {
				target.append(document.createTextNode(token));
			}
		}

		cursor = match.index + token.length;
	}

	if (cursor < text.length) {
		target.append(document.createTextNode(text.slice(cursor)));
	}
}

function renderAssistantContent(text) {
	const container = document.createElement("div");
	container.className = "message__prose";

	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];
		const trimmed = line.trim();

		if (!trimmed) {
			index += 1;
			continue;
		}

		const codeFence = trimmed.match(/^```([\w-]+)?$/);
		if (codeFence) {
			const language = codeFence[1] || "Code";
			const codeLines = [];
			index += 1;

			while (index < lines.length && !lines[index].trim().startsWith("```")) {
				codeLines.push(lines[index]);
				index += 1;
			}

			if (index < lines.length) {
				index += 1;
			}

			const codeText = codeLines.join("\n");
			const wrapper = document.createElement("section");
			wrapper.className = "code-block";

			const header = document.createElement("div");
			header.className = "code-block__header";

			const label = document.createElement("span");
			label.className = "code-block__label";
			label.textContent = language;

			header.append(label, createCopyButton(codeText));

			const pre = document.createElement("pre");
			const code = document.createElement("code");
			code.textContent = codeText;
			pre.append(code);

			wrapper.append(header, pre);
			container.append(wrapper);
			continue;
		}

		const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
		if (heading) {
			const level = heading[1].length;
			const element = document.createElement(`h${level}`);
			appendInlineContent(element, heading[2]);
			container.append(element);
			index += 1;
			continue;
		}

		if (trimmed.startsWith(">")) {
			const quoteLines = [];
			while (index < lines.length && lines[index].trim().startsWith(">")) {
				quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
				index += 1;
			}
			const quote = document.createElement("blockquote");
			appendInlineContent(quote, quoteLines.join(" "));
			container.append(quote);
			continue;
		}

		if (/^[-*]\s+/.test(trimmed)) {
			const list = document.createElement("ul");
			while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
				const item = document.createElement("li");
				appendInlineContent(item, lines[index].trim().replace(/^[-*]\s+/, ""));
				list.append(item);
				index += 1;
			}
			container.append(list);
			continue;
		}

		if (/^\d+\.\s+/.test(trimmed)) {
			const list = document.createElement("ol");
			while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
				const item = document.createElement("li");
				appendInlineContent(item, lines[index].trim().replace(/^\d+\.\s+/, ""));
				list.append(item);
				index += 1;
			}
			container.append(list);
			continue;
		}

		const paragraphLines = [];
		while (index < lines.length) {
			const currentLine = lines[index];
			const currentTrimmed = currentLine.trim();
			if (!currentTrimmed) {
				index += 1;
				break;
			}
			if (
				/^```/.test(currentTrimmed) ||
				/^(#{1,3})\s+/.test(currentTrimmed) ||
				/^>\s?/.test(currentTrimmed) ||
				/^[-*]\s+/.test(currentTrimmed) ||
				/^\d+\.\s+/.test(currentTrimmed)
			) {
				break;
			}
			paragraphLines.push(currentTrimmed);
			index += 1;
		}

		if (paragraphLines.length) {
			const paragraph = document.createElement("p");
			appendInlineContent(paragraph, paragraphLines.join(" "));
			container.append(paragraph);
		}
	}

	if (!container.children.length) {
		const fallback = document.createElement("p");
		fallback.textContent = text;
		container.append(fallback);
	}

	return container;
}

function createMessageNode(message) {
	const wrapper = document.createElement("article");
	wrapper.className = `message ${message.role}`;

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

	if (message.role === "assistant") {
		body.append(renderAssistantContent(message.content));
	} else {
		const content = document.createElement("pre");
		content.className = "message__plain";
		content.textContent = message.content;
		body.append(content);
	}

	wrapper.append(meta, body);
	return wrapper;
}

function renderConversation() {
	chatLog.innerHTML = "";

	if (conversation.length === 0) {
		chatLog.append(createEmptyState());
		return;
	}

	const fragment = document.createDocumentFragment();
	conversation.forEach((message) => {
		fragment.append(createMessageNode(message));
	});
	chatLog.append(fragment);
	chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(text, isError = false) {
	statusText.textContent = text;
	statusText.style.color = isError ? "#a13426" : "";
}

function setWorking(value) {
	isSending = value;
	sendBtn.disabled = value;
	promptInput.disabled = value;
	sendBtn.innerHTML = value
		? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>Sending…'
		: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>Send';
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
	if (conversation.length === 0) return;
	if (!currentChatId) {
		currentChatId = generateChatId();
	}

	chatHistories[currentChatId] = {
		id: currentChatId,
		title: getChatTitle(conversation),
		conversation: conversation.map((message) => ({ ...message })),
		timestamp: Date.now(),
		model: currentModel,
	};

	persistHistories();
	renderHistoryList();
}

function closeSidebarIfNeeded() {
	if (MOBILE_SIDEBAR_BREAKPOINT.matches) {
		setSidebarOpen(false);
	}
}

function loadChat(chatId) {
	const chat = chatHistories[chatId];
	if (!chat) return;

	conversation = chat.conversation.map(normalizeMessage);
	currentChatId = chatId;
	currentModel = chat.model || currentModel;

	if (currentModel && availableModels.includes(currentModel)) {
		modelSelect.value = currentModel;
		selectedModelText.textContent = currentModel;
	}

	renderConversation();
	renderHistoryList();
	setStatus("Conversation loaded.");
	closeSidebarIfNeeded();
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
	body.textContent = "Send your first message and this sidebar will start building a reusable conversation history.";

	empty.append(title, body);
	return empty;
}

function renderHistoryList() {
	historyList.innerHTML = "";

	const sortedHistories = Object.values(chatHistories).sort(
		(a, b) => b.timestamp - a.timestamp,
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

		const title = document.createElement("span");
		title.className = "history-item__title";
		title.textContent = chat.title || "Untitled chat";

		const meta = document.createElement("span");
		meta.className = "history-item__meta";
		meta.textContent = DATE_FORMATTER.format(chat.timestamp);

		item.append(title, meta);
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

async function sendPrompt(prompt) {
	if (!currentModel) {
		setStatus("Select a model before sending.", true);
		return;
	}

	const payload = {
		model: currentModel,
		messages: [...conversation],
		temperature: 0.7,
	};

	setWorking(true);
	setStatus("Sending request…");

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Request failed (${response.status}): ${body}`);
		}

		const data = await response.json();
		const assistantMessage =
			data?.choices?.[0]?.message?.content ??
			data?.error ??
			"No response returned.";

		conversation.push(createMessage("assistant", assistantMessage));
		renderConversation();
		setStatus("Response received.");
		saveCurrentChat();
	} catch (error) {
		console.error(error);
		setStatus(`Error: ${error.message}`, true);
	} finally {
		setWorking(false);
	}
}

function setSidebarOpen(isOpen) {
	const shouldOpen = Boolean(isOpen && MOBILE_SIDEBAR_BREAKPOINT.matches);
	sidebar.classList.toggle("is-open", shouldOpen);
	sidebarBackdrop.classList.toggle("is-visible", shouldOpen);
	sidebarBackdrop.hidden = !shouldOpen;
	sidebarToggleBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
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
		selectedModelText.textContent = currentModel || "No model selected";
		serverStatusText.textContent = formatOllamaStatus(config.ollamaUrl);
		return config;
	} catch (error) {
		console.error(error);
		setStatus(`Config error: ${error.message}`, true);
		selectedModelText.textContent = "Unavailable";
		serverStatusText.textContent = "Unavailable";
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
	}
}

chatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) {
		setStatus("Enter a message first.", true);
		return;
	}

	const userMessage = createMessage("user", prompt);
	conversation.push(userMessage);
	promptInput.value = "";
	renderConversation();
	saveCurrentChat();
	closeSidebarIfNeeded();

	await sendPrompt(prompt);
});

promptInput.addEventListener("keydown", (event) => {
	if (event.ctrlKey && event.key === "Enter") {
		event.preventDefault();
		chatForm.requestSubmit();
	}
});

modelSelect.addEventListener("change", () => {
	currentModel = modelSelect.value || null;
	selectedModelText.textContent = currentModel || "No model selected";
	setStatus(currentModel ? `Using ${currentModel}.` : "No model selected.");
	if (conversation.length > 0) {
		saveCurrentChat();
	}
});

clearBtn.addEventListener("click", () => {
	clearConversation();
});

newChatBtn.addEventListener("click", () => {
	newChat();
});

sidebarToggleBtn.addEventListener("click", () => {
	setSidebarOpen(!sidebar.classList.contains("is-open"));
});

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

async function init() {
	setStatus("Initializing WebUI…");
	await fetchModelConfig();
	await fetchModels();
	renderHistoryList();
	renderConversation();
	setStatus("Ready");
	promptInput.focus();
}

init();
