const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
const ROOT_DIR = __dirname;
const DATA_FILE = path.join(ROOT_DIR, "protected", "versions.json");
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "dc8aac550a1dd257547ced9c41fedbaf9f6ab4a55a33632e012d9e751ce9d04b";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

const sessions = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".sh": "text/plain; charset=utf-8"
};

const defaultVersions = [
  {
    id: "linux-stable-1",
    version: "1.0.0",
    system: "Linux (x86_64)",
    format: "skrypt startowy (przykladowy pakiet)",
    href: "../downloads/astro-ai-plus-linux.sh",
    linuxOnly: true,
    notes: "Wydanie startowe"
  }
];

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function safeReadJson(filePath, fallbackValue) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return fallbackValue;
  }
}

function normalizeVersion(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const version = String(entry.version || "").trim();
  const system = String(entry.system || "").trim();
  const format = String(entry.format || "").trim();
  const href = String(entry.href || "").trim();
  const notes = String(entry.notes || "").trim();
  if (!version || !system || !format || !href) {
    return null;
  }

  return {
    id: String(entry.id || `release-${Date.now()}-${crypto.randomUUID()}`),
    version,
    system,
    format,
    href,
    linuxOnly: Boolean(entry.linuxOnly),
    notes
  };
}

function loadVersions() {
  const loaded = safeReadJson(DATA_FILE, defaultVersions);
  if (!Array.isArray(loaded)) {
    return [...defaultVersions];
  }

  const normalized = loaded.map(normalizeVersion).filter(Boolean);
  if (normalized.length === 0) {
    return [...defaultVersions];
  }

  return normalized;
}

function saveVersions(versions) {
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(versions, null, 2)}\n`, "utf8");
}

function ensureDataFile() {
  const parentDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    saveVersions(defaultVersions);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Za duzy payload."));
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Niepoprawny JSON."));
      }
    });

    req.on("error", reject);
  });
}

function parseToken(req) {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

function isAuthorized(req) {
  const token = parseToken(req);
  if (!token) {
    return false;
  }

  const expiresAt = sessions.get(token);
  if (!expiresAt || Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function routeApi(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/versions") {
    const versions = loadVersions();
    sendJson(res, 200, { versions });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/admin/login") {
    readBody(req)
      .then((body) => {
        const password = String(body.password || "");
        const isValid = hashValue(password) === ADMIN_PASSWORD_HASH;
        if (!isValid) {
          sendJson(res, 401, { error: "Bledne haslo admina." });
          return;
        }

        const token = crypto.randomUUID();
        sessions.set(token, Date.now() + TOKEN_TTL_MS);
        sendJson(res, 200, { token });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/admin/logout") {
    const token = parseToken(req);
    if (token) {
      sessions.delete(token);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/versions") {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Brak autoryzacji." });
      return;
    }

    readBody(req)
      .then((body) => {
        const candidate = normalizeVersion(body);
        if (!candidate) {
          sendJson(res, 400, { error: "Niepoprawne dane wersji." });
          return;
        }

        candidate.id = `release-${Date.now()}-${crypto.randomUUID()}`;
        const versions = [candidate, ...loadVersions()];
        saveVersions(versions);
        sendJson(res, 201, { versions });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "PUT" && requestUrl.pathname.startsWith("/api/versions/")) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Brak autoryzacji." });
      return;
    }

    const id = decodeURIComponent(requestUrl.pathname.replace("/api/versions/", ""));
    readBody(req)
      .then((body) => {
        const candidate = normalizeVersion({ ...body, id });
        if (!candidate) {
          sendJson(res, 400, { error: "Niepoprawne dane wersji." });
          return;
        }

        const versions = loadVersions();
        const index = versions.findIndex((item) => item.id === id);
        if (index === -1) {
          sendJson(res, 404, { error: "Wersja nie istnieje." });
          return;
        }

        versions[index] = candidate;
        saveVersions(versions);
        sendJson(res, 200, { versions });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "DELETE" && requestUrl.pathname.startsWith("/api/versions/")) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Brak autoryzacji." });
      return;
    }

    const id = decodeURIComponent(requestUrl.pathname.replace("/api/versions/", ""));
    const versions = loadVersions();
    const nextVersions = versions.filter((item) => item.id !== id);
    if (nextVersions.length === versions.length) {
      sendJson(res, 404, { error: "Wersja nie istnieje." });
      return;
    }

    saveVersions(nextVersions);
    sendJson(res, 200, { versions: nextVersions });
    return;
  }

  sendJson(res, 404, { error: "Nie znaleziono endpointu API." });
}

function serveStatic(req, res, requestUrl) {
  const requestPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const rawPath = path.join(ROOT_DIR, requestPath);
  const normalizedPath = path.normalize(rawPath);
  if (!normalizedPath.startsWith(ROOT_DIR)) {
    sendText(res, 403, "Access denied");
    return;
  }

  fs.stat(normalizedPath, (statError, stats) => {
    if (statError) {
      sendText(res, 404, "Not found");
      return;
    }

    let filePath = normalizedPath;
    if (stats.isDirectory()) {
      filePath = path.join(normalizedPath, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (readError, file) => {
      if (readError) {
        sendText(res, 404, "Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": contentType });
      res.end(file);
    });
  });
}

ensureDataFile();

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (requestUrl.pathname.startsWith("/api/")) {
    routeApi(req, res, requestUrl);
    return;
  }

  serveStatic(req, res, requestUrl);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Server running at http://${HOST}:${PORT}\n`);
});
