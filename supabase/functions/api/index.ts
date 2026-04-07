import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

interface AuthPayload {
  username: string;
  password: string;
}

interface UserUpdatePayload {
  userId: string;
  newUsername?: string;
  avatarId?: number;
}

async function handleRegister(req: Request): Promise<Response> {
  try {
    const { username, password }: AuthPayload = await req.json();

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUser) {
      return new Response(JSON.stringify({ error: "Username already exists" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: user, error } = await supabase.auth.admin.createUser({
      email: `${username}@connect4.local`,
      password: password,
      user_metadata: { username },
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userProfile } = await supabase
      .from("users")
      .insert({
        id: user.user.id,
        username,
        email: user.user.email,
        elo: 1500,
        avatar_id: 0,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: userProfile.id, username: userProfile.username, elo: userProfile.elo, avatar_id: userProfile.avatar_id },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function handleLogin(req: Request): Promise<Response> {
  try {
    const { username, password }: AuthPayload = await req.json();

    const { data: users } = await supabase
      .from("users")
      .select("id, username, elo, avatar_id")
      .eq("username", username);

    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${username}@connect4.local`,
      password,
    });

    if (error) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = users[0];

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: user.id, username: user.username, elo: user.elo, avatar_id: user.avatar_id },
        session: data.session,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function handleLeaderboard(): Promise<Response> {
  try {
    const { data: leaderboard, error } = await supabase
      .from("users")
      .select("id, username, elo, avatar_id")
      .order("elo", { ascending: false });

    if (error) throw error;

    return new Response(JSON.stringify(leaderboard), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function handleUpdateUser(req: Request): Promise<Response> {
  try {
    const { userId, newUsername, avatarId }: UserUpdatePayload = await req.json();

    if (newUsername) {
      const { data: existing } = await supabase
        .from("users")
        .select("id")
        .eq("username", newUsername)
        .neq("id", userId)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ error: "Username already exists" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const updates: any = {};
    if (newUsername) updates.username = newUsername;
    if (avatarId !== undefined) updates.avatar_id = avatarId;

    const { data: user, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, user }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

async function handleHealth(): Promise<Response> {
  try {
    await supabase.from("users").select("id").limit(1);

    return new Response(JSON.stringify({ status: "ok", database: "connected" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: "error", database: "disconnected", error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace("/functions/v1/api", "");

  try {
    if (path === "/auth/register" && req.method === "POST") {
      return await handleRegister(req);
    }
    if (path === "/auth/login" && req.method === "POST") {
      return await handleLogin(req);
    }
    if (path === "/leaderboard" && req.method === "GET") {
      return await handleLeaderboard();
    }
    if (path === "/user/update" && req.method === "POST") {
      return await handleUpdateUser(req);
    }
    if (path === "/health" && req.method === "GET") {
      return await handleHealth();
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
