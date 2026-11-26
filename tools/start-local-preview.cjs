const { randomBytes } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { parseEnv } = require("node:util");

const root = resolve(__dirname, "..");
const next = join(root, "node_modules", "next", "dist", "bin", "next");
const envFile = join(root, ".env.local");
const dataDir = join(root, ".local-data");
const url = "http://127.0.0.1:3000";
const noBrowser = process.argv.includes("--no-browser");

function main() {
  if (!existsSync(next)) throw new Error("Dependencies missing. Run npm ci in the project folder.");
  if (!existsSync(envFile)) {
    writeFileSync(envFile, [
      "SELF_HOSTED=true",
      "ADMIN_EMAIL=admin@forgehub.local",
      "ADMIN_DISPLAY_NAME=Local Admin",
      "ADMIN_PASSWORD=" + randomBytes(16).toString("hex"),
      "SESSION_SECRET=" + randomBytes(32).toString("hex"),
      "COOKIE_SECURE=false",
      "",
    ].join("\n"), { flag: "wx" });
  }
  const config = parseEnv(readFileSync(envFile, "utf8"));
  if ((config.ADMIN_PASSWORD || "").length < 10 || (config.SESSION_SECRET || "").length < 32) {
    throw new Error("Check ADMIN_PASSWORD (10+ characters) and SESSION_SECRET (32+ characters) in .env.local.");
  }
  console.log("Local account: " + (config.ADMIN_EMAIL || "admin@forgehub.local"));
  if (!noBrowser) console.log("Local password: " + config.ADMIN_PASSWORD);
  console.log("Starting " + url + "  (Ctrl+C to stop)");

  const child = spawn(process.execPath, [next, "dev", "--webpack", "-H", "127.0.0.1", "-p", "3000"], {
    cwd: root,
    env: {
      ...process.env, ...config, SELF_HOSTED: "true", COOKIE_SECURE: "false",
      DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "forgehub.sqlite"),
      FILE_STORAGE_DIR: join(dataDir, "files"),
    },
    stdio: ["inherit", "pipe", "inherit"],
  });
  let checking = false;
  let stopped = false;
  child.stdout.on("data", (data) => {
    process.stdout.write(data);
    if (checking || !/Ready in/.test(data.toString())) return;
    checking = true;
    void (async () => {
      try {
        const response = await fetch(url + "/login", { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("HTTP " + response.status);
        if (stopped) return;
        console.log("Login page ready: " + url);
        if (!noBrowser && process.platform === "win32") {
          const browser = spawn("cmd.exe", ["/d", "/c", "start", "", url], { windowsHide: true, stdio: "ignore" });
          browser.on("error", () => console.log("Open this address in your browser: " + url));
        }
      } catch (error) {
        if (!stopped) console.error("Login page check failed: " + error.message + ". Check the server output above.");
      }
    })();
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { stopped = true; process.exitCode = code ?? 0; });
  process.on("SIGINT", () => { stopped = true; child.kill(); });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
