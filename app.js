const modelSelect = document.getElementById("modelSelect");
const promptInput = document.getElementById("promptInput");
const chatForm = document.getElementById("chatForm");
const chatLog = document.getElementById("chatLog");
const statusText = document.getElementById("statusText");
const clearBtn = document.getElementById("clearBtn");

const conversation = [];
let availableModels = [];

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

function clearConversation() {
	conversation.length = 0;
	renderConversation();
	setStatus("Conversation cleared.");
}

async function fetchModelConfig() {
	try {
		const response = await fetch("/api/config");
		if (!response.ok) {
			throw new Error("Unable to fetch config.");
		}
		return response.json();
	} catch (error) {
		console.error(error);
		setStatus(`Config error: ${error.message}`, true);
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

		if (data.selectedModel && availableModels.includes(data.selectedModel)) {
			modelSelect.value = data.selectedModel;
		}
	} catch (error) {
		console.error(error);
		modelSelect.innerHTML = '<option value="">Unable to load models</option>';
	}
}

async function sendPrompt(prompt) {
	const selectedModel = modelSelect.value;
	const endpoint = "/api/chat";

	const payload = {
		model: selectedModel,
		messages: [...conversation, { role: "user", content: prompt }],
		temperature: 0.7,
	};

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
			data?.choices?.[0]?.message?.content ?? "No response returned.";

		conversation.push({ role: "assistant", content: assistantMessage });
		renderConversation();
		setStatus("Response received.");
	} catch (error) {
		console.error(error);
		setStatus(`Error: ${error.message}`, true);
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

clearBtn.addEventListener("click", () => {
	clearConversation();
});

async function init() {
	setStatus("Loading local Ollama models...");
	await Promise.all([fetchModelConfig(), fetchModels()]);
	setStatus("Ready");
	renderConversation();
}

init();
