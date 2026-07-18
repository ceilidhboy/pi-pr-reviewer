import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Installs custom agents from this package's agents/ directory into
 * ~/.pi/agent/agents/ on session start, keeping them in sync with
 * the package after updates.
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    // Resolve the package root from this extension's own path
    // extension path: <package>/extensions/install-agent.ts
    // package root:   <package>/
    const extDir = dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(extDir, "..");
    const agentsDir = join(packageRoot, "agents");
    const destDir = join(
      process.env.HOME || process.env.USERPROFILE || "/root",
      ".pi",
      "agent",
      "agents",
    );

    if (!existsSync(agentsDir)) {
      return;
    }

    mkdirSync(destDir, { recursive: true });

    const agentFiles = readdirSync(agentsDir).filter(
      (f) => f.endsWith(".md"),
    );

    if (agentFiles.length === 0) {
      return;
    }

    for (const file of agentFiles) {
      const source = join(agentsDir, file);
      const target = join(destDir, file);

      // Remove existing file or symlink
      if (existsSync(target)) {
        unlinkSync(target);
      }

      symlinkSync(source, target);
    }

    ctx.ui.notify(
      `Installed ${agentFiles.length} agent(s) from pi-pr-reviewer`,
      "info",
    );
  });
}
