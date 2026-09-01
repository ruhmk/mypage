"use strict";

// Local-only helper for the organization simulator.
// Create a Slack app with users:read and users:read.email, then provide its bot token at startup.

const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = Number(process.env.SLACK_SYNC_PORT || 43831);
const TOKEN = process.env.SLACK_BOT_TOKEN || "";
const REQUEST_LIMIT = 128 * 1024;
const AVATAR_LIMIT = 320 * 1024;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function normalizeEmail(value) {
  return `${value || ""}`.trim().toLowerCase();
}

function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function slackRequest(path) {
  const response = await fetchWithTimeout(`https://slack.com/api/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Slack request failed (${response.status})`);
  }
  return payload;
}

async function downloadAvatar(url) {
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Error("avatar_download_failed");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > AVATAR_LIMIT) {
    throw new Error("avatar_too_large");
  }
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function listProfilesByEmail(emails) {
  const wantedEmails = new Set(emails);
  const profiles = new Map();
  let cursor = "";
  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const payload = await slackRequest(`users.list?${params.toString()}`);
    (payload.members || []).forEach((user) => {
      const email = normalizeEmail(user.profile?.email);
      if (email && wantedEmails.has(email) && !user.deleted) {
        profiles.set(email, user);
      }
    });
    cursor = `${payload.response_metadata?.next_cursor || ""}`;
  } while (cursor && profiles.size < wantedEmails.size);
  return profiles;
}

async function syncProfile(email, user) {
  const profile = user.profile || {};
  const imageUrl = profile.image_48 || profile.image_72 || profile.image_32 || profile.image_24;
  if (!imageUrl || user.deleted) return null;
  const avatarDataUrl = await downloadAvatar(imageUrl);
  return {
    email,
    slackUserId: `${user.id || ""}`,
    avatarDataUrl
  };
}

async function mapWithConcurrency(values, limit, callback) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > REQUEST_LIMIT) {
        reject(new Error("request_too_large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ready: true, tokenConfigured: Boolean(TOKEN) });
    return;
  }

  if (request.method !== "POST" || request.url !== "/sync") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (!TOKEN) {
    sendJson(response, 401, { error: "missing_token" });
    return;
  }

  try {
    const payload = await readJson(request);
    const emails = [...new Set((Array.isArray(payload.emails) ? payload.emails : [])
      .map(normalizeEmail)
      .filter(Boolean))].slice(0, 100);
    if (!emails.length) {
      sendJson(response, 400, { error: "missing_emails" });
      return;
    }

    const profiles = await listProfilesByEmail(emails);
    const results = await mapWithConcurrency(emails, 3, async (email) => {
      const user = profiles.get(email);
      if (!user) return null;
      try {
        return await syncProfile(email, user);
      } catch (error) {
        return null;
      }
    });
    sendJson(response, 200, { avatars: results.filter(Boolean) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "invalid_request" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Slack profile sync helper is ready at http://${HOST}:${PORT}`);
});
