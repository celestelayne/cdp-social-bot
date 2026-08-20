import { PROFILE_FIELD_LIMITS } from "../shared/profile-limits.ts";

interface Env {
  cdp_social_bot_db: D1Database;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
}

const SESSION_COOKIE_NAME = "session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function readSessionId(request: Request): string | undefined {
  const prefix = `${SESSION_COOKIE_NAME}=`;

  return (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function buildSessionCookie(
  value: string,
  maxAgeSeconds: number,
  url: URL,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (url.protocol === "https:") parts.push("Secure");

  return parts.join("; ");
}

type SessionRow = {
  discord_user_id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  expires_at: string;
};

type SessionLookup =
  | { status: "none" }
  | { status: "expired" }
  | { status: "valid"; session: SessionRow };

async function loadSession(
  request: Request,
  env: Env,
): Promise<SessionLookup> {
  const sessionId = readSessionId(request);

  if (!sessionId) {
    return { status: "none" };
  }

  const session = await env.cdp_social_bot_db
    .prepare(
      "SELECT discord_user_id, username, global_name, avatar, expires_at FROM sessions WHERE session_id = ?",
    )
    .bind(sessionId)
    .first<SessionRow>();

  if (!session) {
    return { status: "none" };
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await env.cdp_social_bot_db
      .prepare("DELETE FROM sessions WHERE session_id = ?")
      .bind(sessionId)
      .run();

    return { status: "expired" };
  }

  return { status: "valid", session };
}

type ProfileInput = {
  displayName: string;
  pronunciation: string | null;
  favoriteDrink: string | null;
  dietaryNotes: string | null;
  interests: string | null;
  published: number;
};

function parseProfileBody(
  body: unknown,
): { ok: true; profile: ProfileInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const raw = body as Record<string, unknown>;
  const values: Record<string, string | null> = {};

  for (const [field, limit] of Object.entries(PROFILE_FIELD_LIMITS)) {
    const value = raw[field];

    if (value === undefined || value === null) {
      values[field] = null;
      continue;
    }

    if (typeof value !== "string") {
      return { ok: false, error: `${field} must be a string.` };
    }

    const trimmed = value.trim();

    if (trimmed.length > limit) {
      return {
        ok: false,
        error: `${field} must be ${limit} characters or fewer.`,
      };
    }

    values[field] = trimmed === "" ? null : trimmed;
  }

  if (values.displayName === null) {
    return { ok: false, error: "displayName is required." };
  }

  const published = raw.published ?? false;

  if (typeof published !== "boolean") {
    return { ok: false, error: "published must be true or false." };
  }

  return {
    ok: true,
    profile: {
      displayName: values.displayName,
      pronunciation: values.pronunciation,
      favoriteDrink: values.favoriteDrink,
      dietaryNotes: values.dietaryNotes,
      interests: values.interests,
      published: published ? 1 : 0,
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        message: "CDP Social Bot is running",
      });
    }

    if (url.pathname === "/api/session" && request.method === "GET") {
      const lookup = await loadSession(request, env);

      if (lookup.status === "expired") {
        return Response.json(
          { authenticated: false },
          { headers: { "Set-Cookie": buildSessionCookie("", 0, url) } },
        );
      }

      if (lookup.status === "none") {
        return Response.json({ authenticated: false });
      }

      return Response.json({
        authenticated: true,
        user: {
          id: lookup.session.discord_user_id,
          username: lookup.session.username,
          globalName: lookup.session.global_name,
          avatar: lookup.session.avatar,
        },
      });
    }

    if (url.pathname === "/api/profile" && request.method === "GET") {
      const lookup = await loadSession(request, env);

      if (lookup.status !== "valid") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const profile = await env.cdp_social_bot_db
        .prepare(
          "SELECT display_name, pronunciation, favorite_drink, dietary_notes, interests, published FROM profiles WHERE discord_user_id = ?",
        )
        .bind(lookup.session.discord_user_id)
        .first<{
          display_name: string;
          pronunciation: string | null;
          favorite_drink: string | null;
          dietary_notes: string | null;
          interests: string | null;
          published: number;
        }>();

      if (!profile) {
        return Response.json({ profile: null });
      }

      return Response.json({
        profile: {
          displayName: profile.display_name,
          pronunciation: profile.pronunciation,
          favoriteDrink: profile.favorite_drink,
          dietaryNotes: profile.dietary_notes,
          interests: profile.interests,
          published: profile.published !== 0,
        },
      });
    }

    if (url.pathname === "/api/profile" && request.method === "POST") {
      const lookup = await loadSession(request, env);

      if (lookup.status !== "valid") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      let body: unknown;

      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: "Request body must be valid JSON." },
          { status: 400 },
        );
      }

      const parsed = parseProfileBody(body);

      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 400 });
      }

      await env.cdp_social_bot_db
        .prepare(
          `INSERT INTO profiles (discord_user_id, display_name, pronunciation, favorite_drink, dietary_notes, interests, published, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(discord_user_id) DO UPDATE SET
             display_name = excluded.display_name,
             pronunciation = excluded.pronunciation,
             favorite_drink = excluded.favorite_drink,
             dietary_notes = excluded.dietary_notes,
             interests = excluded.interests,
             published = excluded.published,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          lookup.session.discord_user_id,
          parsed.profile.displayName,
          parsed.profile.pronunciation,
          parsed.profile.favoriteDrink,
          parsed.profile.dietaryNotes,
          parsed.profile.interests,
          parsed.profile.published,
        )
        .run();

      return Response.json({ ok: true });
    }

    if (url.pathname === "/auth/discord" && request.method === "GET") {
      const stateBytes = new Uint8Array(32);
      crypto.getRandomValues(stateBytes);
      const state = Array.from(stateBytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await env.cdp_social_bot_db
        .prepare(
          "INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)",
        )
        .bind(state, expiresAt)
        .run();

      const redirectUri = `${url.origin}/auth/discord/callback`;
      const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
      authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "identify");
      authorizeUrl.searchParams.set("state", state);

      return Response.redirect(authorizeUrl.toString(), 302);
    }

    if (
      url.pathname === "/auth/discord/callback" &&
      request.method === "GET"
    ) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      const stateRow = await env.cdp_social_bot_db
        .prepare("SELECT expires_at FROM oauth_states WHERE state = ?")
        .bind(state)
        .first<{ expires_at: string }>();

      if (!stateRow) {
        return new Response("Invalid state", { status: 400 });
      }

      if (new Date(stateRow.expires_at).getTime() < Date.now()) {
        return new Response("State expired", { status: 400 });
      }

      await env.cdp_social_bot_db
        .prepare("DELETE FROM oauth_states WHERE state = ?")
        .bind(state)
        .run();

      const redirectUri = `${url.origin}/auth/discord/callback`;

      const tokenParams = new URLSearchParams();
      tokenParams.set("client_id", env.DISCORD_CLIENT_ID);
      tokenParams.set("client_secret", env.DISCORD_CLIENT_SECRET);
      tokenParams.set("grant_type", "authorization_code");
      tokenParams.set("code", code);
      tokenParams.set("redirect_uri", redirectUri);

      const tokenResponse = await fetch(
        "https://discord.com/api/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: tokenParams.toString(),
        },
      );

      if (!tokenResponse.ok) {
        return new Response("Discord token exchange failed", { status: 502 });
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
      };
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return new Response("Discord token exchange returned no access token", {
          status: 502,
        });
      }

      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userResponse.ok) {
        return new Response("Failed to fetch Discord user", { status: 502 });
      }

      const user = (await userResponse.json()) as {
        id: string;
        username: string;
        global_name: string | null;
        avatar: string | null;
      };

      const sessionBytes = new Uint8Array(32);
      crypto.getRandomValues(sessionBytes);
      const sessionId = Array.from(sessionBytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");

      const sessionExpiresAt = new Date(
        Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
      ).toISOString();

      await env.cdp_social_bot_db
        .prepare(
          "INSERT INTO sessions (session_id, discord_user_id, username, global_name, avatar, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          sessionId,
          user.id,
          user.username,
          user.global_name,
          user.avatar,
          sessionExpiresAt,
        )
        .run();

      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": buildSessionCookie(
            sessionId,
            SESSION_MAX_AGE_SECONDS,
            url,
          ),
        },
      });
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const sessionId = readSessionId(request);

      if (sessionId) {
        await env.cdp_social_bot_db
          .prepare("DELETE FROM sessions WHERE session_id = ?")
          .bind(sessionId)
          .run();
      }

      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": buildSessionCookie("", 0, url) } },
      );
    }
		return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
