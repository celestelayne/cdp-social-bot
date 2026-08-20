/**
 * Registers the /meet slash command for a single guild.
 *
 * Guild commands appear in Discord immediately, where global commands can take
 * up to an hour to propagate — and a course bot should stay scoped to its own
 * course server anyway.
 *
 * Run with: npm run register-commands
 */

import { readFileSync } from "node:fs";

const REQUIRED_VARS = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

const MEET_COMMAND = {
  name: "meet",
  description: "Show a classmate's published studio profile",
  type: 1,
  options: [
    {
      name: "student",
      description: "The classmate whose profile you want to see",
      type: 6,
      required: true,
    },
  ],
};

function readDevVars(): Record<string, string> {
  try {
    const contents = readFileSync(
      new URL("../.dev.vars", import.meta.url),
      "utf8",
    );
    const vars: Record<string, string> = {};

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();

      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");

      if (separator === -1) {
        continue;
      }

      vars[trimmed.slice(0, separator).trim()] = trimmed
        .slice(separator + 1)
        .trim();
    }

    return vars;
  } catch {
    return {};
  }
}

function resolveConfig(): Record<RequiredVar, string> {
  const devVars = readDevVars();
  const resolved: Partial<Record<RequiredVar, string>> = {};
  const missing: string[] = [];

  for (const name of REQUIRED_VARS) {
    const value = process.env[name] ?? devVars[name];

    if (value) {
      resolved[name] = value;
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required values: ${missing.join(", ")}`);
    console.error(
      "Set them as environment variables, or add them to .dev.vars.",
    );
    process.exit(1);
  }

  return resolved as Record<RequiredVar, string>;
}

const config = resolveConfig();

const endpoint = `https://discord.com/api/v10/applications/${config.DISCORD_APPLICATION_ID}/guilds/${config.DISCORD_GUILD_ID}/commands`;

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(MEET_COMMAND),
});

if (!response.ok) {
  console.error(`Discord returned ${response.status} ${response.statusText}`);
  console.error(await response.text());
  process.exit(1);
}

const registered = (await response.json()) as { id: string; name: string };

console.log(
  `Registered /${registered.name} (id ${registered.id}) for guild ${config.DISCORD_GUILD_ID}`,
);
