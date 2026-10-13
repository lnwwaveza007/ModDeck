import { io } from "socket.io-client";

async function testCrossInstanceSync() {
  console.log("--- Starting Multi-Instance Cross-Broadcast Test ---");

  const PIN = "654321";
  const urlA = "http://localhost:4000";
  const urlB = "http://localhost:4001";

  console.log(`[Test] Connecting Client 1 to Instance A (${urlA})...`);
  const clientA = io(urlA, { transports: ["websocket"] });

  console.log(`[Test] Connecting Client 2 to Instance B (${urlB})...`);
  const clientB = io(urlB, { transports: ["websocket"] });

  await Promise.all([
    new Promise((resolve) => clientA.on("connect", resolve)),
    new Promise((resolve) => clientB.on("connect", resolve)),
  ]);

  console.log(`[Test] Connected! Client 1 id: ${clientA.id}, Client 2 id: ${clientB.id}`);

  // Join Room
  console.log(`[Test] Both clients joining room ${PIN}...`);
  clientA.emit("join", { pin: PIN, nickname: "Student-Instance-A" });
  clientB.emit("join", { pin: PIN, nickname: "Student-Instance-B" });

  await new Promise((r) => setTimeout(r, 800));

  // Reset votes first
  clientA.emit("reset_votes", { pin: PIN });
  await new Promise((r) => setTimeout(r, 500));

  // Test 1: Client A votes -> Client B must receive it across instances
  const clientBReceivedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for vote_update on Client B")),
      5000,
    );
    clientB.on("vote_update", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  console.log('[Test] Client 1 (Instance A) casting vote for "A"...');
  clientA.emit("vote", { pin: PIN, option: "A" });

  const resultB = await clientBReceivedPromise;
  console.log("[Test] Client 2 (Instance B) received vote_update:", resultB);

  if (resultB.votes && resultB.votes.A === 1) {
    console.log(
      "✅ TEST 1 PASSED: Instance A vote successfully arrived at Instance B via Redis Pub/Sub!",
    );
  } else {
    throw new Error("Test 1 failed: votes payload mismatch: " + JSON.stringify(resultB));
  }

  // Test 2: Client B votes -> Client A must receive it
  const clientAReceivedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for vote_update on Client A")),
      5000,
    );
    clientA.on("vote_update", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  console.log('[Test] Client 2 (Instance B) casting vote for "B"...');
  clientB.emit("vote", { pin: PIN, option: "B" });

  const resultA = await clientAReceivedPromise;
  console.log("[Test] Client 1 (Instance A) received vote_update:", resultA);

  if (resultA.votes && resultA.votes.A === 1 && resultA.votes.B === 1) {
    console.log(
      "✅ TEST 2 PASSED: Instance B vote successfully arrived at Instance A via Redis Pub/Sub!",
    );
  } else {
    throw new Error("Test 2 failed: votes payload mismatch: " + JSON.stringify(resultA));
  }

  console.log("\n========================================");
  console.log("🎉 ALL MULTI-INSTANCE POC TESTS PASSED! 🎉");
  console.log("========================================\n");

  clientA.disconnect();
  clientB.disconnect();
}

testCrossInstanceSync()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test failed with error:", err);
    process.exit(1);
  });
