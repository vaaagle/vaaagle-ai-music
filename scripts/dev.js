const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.join(__dirname, "..");
const isWin = process.platform === "win32";
const viteCmd = isWin ? "node_modules\\.bin\\vite.cmd" : "node_modules/.bin/vite";
const electronCmd = isWin ? "node_modules\\.bin\\electron.cmd" : "node_modules/.bin/electron";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

async function main() {
  const vite = spawn(viteCmd, ["--port", "5173"], {
    cwd: rootDir,
    stdio: ["inherit", "pipe", "pipe"],
    shell: isWin
  });

  vite.stdout.on("data", (buf) => process.stdout.write(buf));
  vite.stderr.on("data", (buf) => process.stderr.write(buf));

  let electron;
  let port;

  const shutdown = () => {
    if (electron && !electron.killed) {
      electron.kill();
    }
    if (!vite.killed) {
      vite.kill();
    }
  };

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  vite.on("exit", (code) => {
    if (code !== 0) {
      process.exit(code || 1);
    }
  });

  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting Vite local URL"));
    }, 30000);

    const onChunk = (buf) => {
      const clean = stripAnsi(String(buf));
      const match = clean.match(/Local:\s+http:\/\/localhost:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        const p = Number(match[1]);
        console.log(`[dev] Using Vite port ${p}`);
        resolve(p);
      }
    };

    vite.stdout.on("data", onChunk);
    vite.stderr.on("data", onChunk);
  });

  await wait(500);
  const devUrl = `http://localhost:${port}`;

  electron = spawn(electronCmd, ["."], {
    cwd: rootDir,
    stdio: "inherit",
    shell: isWin,
    env: {
      ...process.env,
      DEV_SERVER_URL: devUrl
    }
  });

  electron.on("exit", (code) => {
    shutdown();
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("[dev] Failed:", err.message);
  process.exit(1);
});
