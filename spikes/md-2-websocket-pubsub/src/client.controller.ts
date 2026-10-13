import { Controller, Get, Header } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

@Controller()
export class ClientController {
  @Get("health")
  check() {
    return { status: "ok", uptime: process.uptime() };
  }

  @Get("client")
  @Header("Content-Type", "text/html")
  getClient() {
    const candidatePaths = [
      path.resolve(__dirname, "../test-client.html"),
      path.resolve(process.cwd(), "test-client.html"),
      path.resolve(process.cwd(), "spikes/md-2-websocket-pubsub/test-client.html"),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf8");
      }
    }
    return "<h1>test-client.html not found</h1>";
  }
}
