const { spawn, execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const readline = require("readline");
const { URL } = require("url");

const APP_HOST = "127.0.0.1";
const APP_PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const LOCAL_OLLAMA_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;
const STATIC_ROOT = path.resolve(__dirname);

let selectedModel = null;
let ollamaChild = null;
const modelDetailsCache = new Map();

function log(...args) {
	console.log("[webui]", ...args);
}

function error(...args) {
	console.error("[webui]", ...args);
}

function parseJsonOutput(output) {
	try {
		return JSON.parse(output);
	} catch (err) {
		return null;
	}
}

function execCommand(command, args) {
	return new Promise((resolve, reject) => {
		execFile(command, args, { cwd: STATIC_ROOT }, (err, stdout, stderr) => {
			if (err) {
				return reject(new Error(stderr || err.message || String(err)));
			}
			resolve(stdout.toString().trim());
		});
	});
}

function spawnCommand(command, args, options = {}) {
	return spawn(command, args, { stdio: "inherit", ...options });
}

function isPortOpen(port) {
	return new Promise((resolve) => {
		const socket = new (require("net").Socket)();
		socket.setTimeout(500);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("error", () => {
			socket.destroy();
			resolve(false);
		});
		socket.connect(port, OLLAMA_HOST);
	});
}

async function waitForPort(port, maxMs = 20000) {
	const start = Date.now();
	while (Date.now() - start < maxMs) {
		if (await isPortOpen(port)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return false;
}

async function getInstalledModels() {
	try {
		const output = await execCommand("ollama", ["list"]);
		const lines = output
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(1);

		const models = lines.map((line) => line.split(/\s+/)[0]).filter(Boolean);
		if (models.length === 0) {
			throw new Error("No Ollama models were found.");
		}
		return models;
	} catch (err) {
		throw new Error(`Unable to determine Ollama models: ${err.message}`);
	}
}

async function getModelDetails(modelName) {
	if (!modelName) {
		return { contextWindow: null };
	}

	if (modelDetailsCache.has(modelName)) {
		return modelDetailsCache.get(modelName);
	}

	try {
		const output = await execCommand("ollama", [ "show", modelName, "--verbose" ]);
		const contextMatch = output.match(/context length\s+(\d+)/i);
		const parametersMatch = output.match(/parameters\s+([^\n]+)/i);
		const architectureMatch = output.match(/architecture\s+([^\n]+)/i);
		const details = {
			contextWindow: contextMatch ? Number(contextMatch[1]) : null,
			parameters: parametersMatch ? parametersMatch[1].trim() : null,
			architecture: architectureMatch ? architectureMatch[1].trim() : null,
		};
		modelDetailsCache.set(modelName, details);
		return details;
	} catch (err) {
		throw new Error(`Unable to inspect model details: ${err.message}`);
	}
}

function askQuestion(promptText) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return new Promise((resolve) => {
		rl.question(promptText, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function chooseModel(models) {
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error("No local Ollama models were found.");
	}

	if (models.length === 1) {
		log(`Using the only installed model: ${models[0]}`);
		return models[0];
	}

	log("Installed local Ollama models:");
	models.forEach((modelName, index) => {
		log(`  ${index + 1}. ${modelName}`);
	});

	let choice = null;
	while (!choice) {
		const answer = await askQuestion("Choose a model by number or name: ");
		if (!answer) {
			continue;
		}

		const numeric = Number(answer);
		if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= models.length) {
			choice = models[numeric - 1];
			break;
		}

		if (models.includes(answer)) {
			choice = answer;
			break;
		}

		log("Invalid selection. Please enter a number or a valid model name.");
	}

	log(`Selected model: ${choice}`);
	return choice;
}

async function startOllamaServer() {
	const alreadyRunning = await isPortOpen(OLLAMA_PORT);
	if (alreadyRunning) {
		log(`Detected Ollama already running on ${LOCAL_OLLAMA_URL}`);
		return;
	}

	log("Starting local Ollama server...");
	ollamaChild = spawnCommand("ollama", [
		"serve",
		"--port",
		String(OLLAMA_PORT),
	]);
	ollamaChild.on("error", (err) => {
		error("Failed to launch Ollama:", err.message);
	});
	ollamaChild.on("exit", (code, signal) => {
		if (code !== 0) {
			error(`Ollama exited unexpectedly with code ${code} ${signal || ""}`);
		}
	});

	const opened = await waitForPort(OLLAMA_PORT, 20000);
	if (!opened) {
		throw new Error(
			`Ollama did not start on ${LOCAL_OLLAMA_URL} within 20 seconds.`,
		);
	}

	log(`Ollama is now available at ${LOCAL_OLLAMA_URL}`);
}

function openBrowser(url) {
	const platform = process.platform;
	let opener;
	let args;

	if (platform === "darwin") {
		opener = "open";
		args = [url];
	} else if (platform === "win32") {
		opener = "cmd";
		args = ["/c", "start", "", url];
	} else {
		opener = "xdg-open";
		args = [url];
	}

	try {
		const child = spawn(opener, args, {
			stdio: "ignore",
			detached: true,
		});
		if (child.unref) child.unref();
	} catch (err) {
		log(`Unable to open browser automatically: ${err.message}`);
	}
}

function getMimeType(filename) {
	const ext = path.extname(filename).toLowerCase();
	const map = {
		".html": "text/html; charset=UTF-8",
		".js": "application/javascript; charset=UTF-8",
		".css": "text/css; charset=UTF-8",
		".json": "application/json; charset=UTF-8",
		".svg": "image/svg+xml; charset=UTF-8",
		".ico": "image/x-icon",
		".txt": "text/plain; charset=UTF-8",
	};
	return map[ext] || "application/octet-stream";
}

function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

async function proxyChatRequest(req, res) {
	try {
		const bodyText = await readRequestBody(req);
		const response = await fetch(`${LOCAL_OLLAMA_URL}/v1/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: bodyText,
		});

		const responseBody = await response.text();
		res.writeHead(response.status, {
			"Content-Type":
				response.headers.get("content-type") || "application/json",
		});
		res.end(responseBody);
	} catch (err) {
		error("Chat proxy error:", err.message);
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: err.message }));
	}
}

async function handleApiRequest(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	if (url.pathname === "/api/models" && req.method === "GET") {
		try {
			const models = await getInstalledModels();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ models, selectedModel }));
		} catch (err) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message }));
		}
		return;
	}

		if (url.pathname === "/api/config" && req.method === "GET") {
			const modelDetails = selectedModel
				? await getModelDetails(selectedModel).catch(() => ({ contextWindow: null }))
				: { contextWindow: null };
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					selectedModel,
					ollamaUrl: LOCAL_OLLAMA_URL,
					apiUrl: `/api`,
					contextWindow: modelDetails.contextWindow,
				}),
			);
			return;
		}

		if (url.pathname === "/api/model-details" && req.method === "GET") {
			const model = url.searchParams.get("model");
			if (!model) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Model is required." }));
				return;
			}

			try {
				const details = await getModelDetails(model);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ model, ...details }));
			} catch (err) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: err.message }));
			}
			return;
		}

	if (url.pathname === "/api/chat" && req.method === "POST") {
		await proxyChatRequest(req, res);
		return;
	}

	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Not found" }));
}

function serveStaticFile(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	let pathname = url.pathname;
	if (pathname === "/") {
		pathname = "/index.html";
	}

	const filePath = path.join(STATIC_ROOT, pathname);
	if (!filePath.startsWith(STATIC_ROOT)) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}

	fs.stat(filePath, (err, stats) => {
		if (err || !stats.isFile()) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		fs.readFile(filePath, (readErr, data) => {
			if (readErr) {
				res.writeHead(500);
				res.end("Server error");
				return;
			}
			res.writeHead(200, { "Content-Type": getMimeType(filePath) });
			res.end(data);
		});
	});
}

async function main() {
	try {
		const models = await getInstalledModels();
		selectedModel = await chooseModel(models);
		await startOllamaServer();

		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url, `http://${req.headers.host}`);
			if (url.pathname.startsWith("/api/")) {
				await handleApiRequest(req, res);
			} else {
				serveStaticFile(req, res);
			}
		});

		server.listen(APP_PORT, APP_HOST, () => {
			const appUrl = `http://${APP_HOST}:${APP_PORT}`;
			log(`WebUI available at ${appUrl}`);
			openBrowser(appUrl);
		});

		process.on("SIGINT", () => {
			log("Shutting down...");
			server.close(() => process.exit(0));
		});
	} catch (err) {
		error(err.message);
		process.exit(1);
	}
}

main();
