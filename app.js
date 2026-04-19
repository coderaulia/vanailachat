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

let conversation = [];
let availableModels = [];
let currentModel = null;
let isSending = false;
let currentChatId = null;
let chatHistories = JSON.parse(localStorage.getItem("chatHistories")) || {};

function createMessageNode(role, text) {
	const wrapper = document.createElement("div");
	wrapper.className = `message ${role}`;

	const label = document.createElement("div");
	label.className = "message__role";
	label.textContent = role === "user" ? "User" : "Assistant";

	const content = document.createElement("pre");
	content.className = "message__content";
	content.textContent = text;

	wrapper.appendChild(label);
	wrapper.appendChild(content);
	return wrapper;
}

function renderConversation() {
	chatLog.innerHTML = "";
	conversation.forEach((message) => {
		chatLog.appendChild(createMessageNode(message.role, message.content));
	});
	chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(text, isError = false) {
	statusText.textContent = text;
	statusText.style.color = isError ? "#b91c1c" : "#374151";
}

function setWorking(value) {
	isSending = value;
	sendBtn.disabled = value;
	promptInput.disabled = value;
}

function generateChatId() {
	return Date.now().toString();
}

function saveCurrentChat() {
	if (conversation.length === 0) return;
	if (!currentChatId) {
		currentChatId = generateChatId();
	}
	const title =
		conversation[0].content.slice(0, 50) +
		(conversation[0].content.length > 50 ? "..." : "");
	chatHistories[currentChatId] = {
		id: currentChatId,
		title,
		conversation: [...conversation],
		timestamp: Date.now(),
		model: currentModel,
	};
	localStorage.setItem("chatHistories", JSON.stringify(chatHistories));
	renderHistoryList();
}

function loadChat(chatId) {
	if (chatHistories[chatId]) {
		conversation = [...chatHistories[chatId].conversation];
		currentChatId = chatId;
		currentModel = chatHistories[chatId].model || currentModel;
		if (availableModels.includes(currentModel)) {
			modelSelect.value = currentModel;
		}
		renderConversation();
		setStatus("Chat loaded.");
		renderHistoryList();
	}
}

function newChat() {
	saveCurrentChat();
	conversation = [];
	currentChatId = null;
	renderConversation();
	setStatus("New chat started.");
	renderHistoryList();
}

function renderHistoryList() {
	historyList.innerHTML = "";
	const sortedHistories = Object.values(chatHistories).sort(
		(a, b) => b.timestamp - a.timestamp,
	);
	sortedHistories.forEach((chat) => {
		const item = document.createElement("div");
		item.className = `history-item ${chat.id === currentChatId ? "active" : ""}`;
		item.onclick = () => loadChat(chat.id);

		const title = document.createElement("div");
		title.className = "history-item__title";
		title.textContent = chat.title;

		const meta = document.createElement("div");
		meta.className = "history-item__meta";
		meta.textContent = new Date(chat.timestamp).toLocaleString();

		item.appendChild(title);
		item.appendChild(meta);
		historyList.appendChild(item);
	});
}

function clearConversation() {
	conversation.length = 0;
	renderConversation();
	setStatus("Conversation cleared.");
	if (currentChatId) {
		delete chatHistories[currentChatId];
		localStorage.setItem("chatHistories", JSON.stringify(chatHistories));
		currentChatId = null;
		renderHistoryList();
	}
}

async function sendPrompt(prompt) {
	const selectedModel = modelSelect.value;
	if (!selectedModel) {
		setStatus("Please select a model before sending.", true);
		return;
	}

	const endpoint = "/api/chat";
	const payload = {
		model: selectedModel,
		messages: [...conversation, { role: "user", content: prompt }],
		temperature: 0.7,
	};

	setWorking(true);
	setStatus("Sending request...");

	try {
		const response = await fetch(endpoint, {
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

		conversation.push({ role: "assistant", content: assistantMessage });
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

chatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) {
		setStatus("Please enter a prompt.", true);
		return;
	}

	conversation.push({ role: "user", content: prompt });
	renderConversation();
	promptInput.value = "";

	await sendPrompt(prompt);
});

promptInput.addEventListener("keydown", (event) => {
	if (event.ctrlKey && event.key === "Enter") {
		event.preventDefault();
		chatForm.dispatchEvent(new Event("submit"));
	}
});

clearBtn.addEventListener("click", () => {
	clearConversation();
});

newChatBtn.addEventListener("click", () => {
	newChat();
});

async function fetchModelConfig() {
	try {
		const response = await fetch("/api/config");
		if (!response.ok) {
			throw new Error("Unable to fetch config.");
		}
		const config = await response.json();
		selectedModelText.textContent = config.selectedModel || "None";
		serverStatusText.textContent = config.ollamaUrl || "Unavailable";
		currentModel = config.selectedModel || null;
		return config;
	} catch (error) {
		console.error(error);
		setStatus(`Config error: ${error.message}`, true);
		selectedModelText.textContent = "Error";
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
			modelSelect.innerHTML =
				'<option value="">No installed models found</option>';
			return;
		}

		availableModels.forEach((model) => {
			const option = document.createElement("option");
			option.value = model;
			option.textContent = model;
			modelSelect.appendChild(option);
		});

		if (currentModel && availableModels.includes(currentModel)) {
			modelSelect.value = currentModel;
		} else {
			modelSelect.value = availableModels[0];
			currentModel = availableModels[0];
		}
		selectedModelText.textContent = currentModel;
	} catch (error) {
		console.error(error);
		modelSelect.innerHTML = '<option value="">Unable to load models</option>';
		selectedModelText.textContent = "Unavailable";
	}
}

async function init() {
	setStatus("Initializing WebUI...");
	const config = await fetchModelConfig();
	await fetchModels();
	renderHistoryList();
	setStatus("Ready");
	renderConversation();
	promptInput.focus();
}

init();
