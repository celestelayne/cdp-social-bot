interface Env {
  cdp_social_bot_db: D1Database;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
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
      const cookieHeader = request.headers.get("Cookie") ?? "";
      const sessionId = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("session="))
        ?.slice("session=".length);

      if (!sessionId) {
        return Response.json({ authenticated: false });
      }

      const session = await env.cdp_social_bot_db
        .prepare(
          "SELECT discord_user_id, username, global_name, avatar, expires_at FROM sessions WHERE session_id = ?",
        )
        .bind(sessionId)
        .first<{
          discord_user_id: string;
          username: string;
          global_name: string | null;
          avatar: string | null;
          expires_at: string;
        }>();

      if (!session) {
        return Response.json({ authenticated: false });
      }

      if (new Date(session.expires_at).getTime() < Date.now()) {
        await env.cdp_social_bot_db
          .prepare("DELETE FROM sessions WHERE session_id = ?")
          .bind(sessionId)
          .run();

        const clearedCookieParts = [
          "session=",
          "HttpOnly",
          "SameSite=Lax",
          "Path=/",
          "Max-Age=0",
        ];
        if (url.protocol === "https:") clearedCookieParts.push("Secure");

        return Response.json(
          { authenticated: false },
          { headers: { "Set-Cookie": clearedCookieParts.join("; ") } },
        );
      }

      return Response.json({
        authenticated: true,
        user: {
          id: session.discord_user_id,
          username: session.username,
          globalName: session.global_name,
          avatar: session.avatar,
        },
      });
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
        Date.now() + 30 * 24 * 60 * 60 * 1000,
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

      const cookieParts = [
        `session=${sessionId}`,
        "HttpOnly",
        "SameSite=Lax",
        "Path=/",
        "Max-Age=2592000",
      ];
      if (url.protocol === "https:") cookieParts.push("Secure");

      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": cookieParts.join("; "),
        },
      });
    }
		return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
