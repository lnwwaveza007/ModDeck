import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MD3_WS_PORT ?? 4010);

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

function lanAddresses() {
  const nets = networkInterfaces();
  const found = [];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        found.push(net.address);
      }
    }
  }
  return found;
}

function sendJson(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(payload, except = null) {
  const body = JSON.stringify(payload);
  for (const client of clients) {
    if (client !== except && client.readyState === 1) {
      client.send(body);
    }
  }
}

const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, lan: lanAddresses() }));
    return;
  }

  if (req.method === "POST" && req.url === "/broadcast") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (payload.type !== "slide") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "payload.type must be slide" }));
          return;
        }
        broadcast(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, clients: clients.size }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  clients.add(socket);
  sendJson(socket, { type: "hello", clients: clients.size });
  broadcast({ type: "presence", clients: clients.size });

  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(String(raw));
      if (payload.type === "slide") {
        broadcast(payload, socket);
        sendJson(socket, { type: "ack", clients: clients.size });
      }
    } catch {
      sendJson(socket, { type: "error", message: "invalid json" });
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
    broadcast({ type: "presence", clients: clients.size });
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  const lan = lanAddresses();
  console.log(`MD-3 mock WebSocket listening on 0.0.0.0:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  for (const ip of lan) {
    console.log(`Phone WS URL: ws://${ip}:${PORT}`);
  }
});
