import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "./AuthProvider";

type Mode = "sign-in" | "sign-up";

export function AuthPanel() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingUp = mode === "sign-up";

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (signingUp) {
        await signUp({ username, email, password, invite_code: inviteCode });
      } else {
        await signIn(login, password);
      }
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : "Something went wrong. Try again.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>{signingUp ? "Create your account" : "Welcome back"}</h3>

      <form onSubmit={submit}>
        {signingUp ? (
          <>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              minLength={3}
              maxLength={20}
            />

            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />

            <label htmlFor="invite-code">Invite code</label>
            <input
              id="invite-code"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              autoComplete="off"
            />
          </>
        ) : (
          <>
            <label htmlFor="login">Username or email</label>
            <input
              id="login"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
              required
            />
          </>
        )}

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={signingUp ? "new-password" : "current-password"}
          required
          minLength={signingUp ? 8 : undefined}
        />
        {signingUp && <p className="hint">At least 8 characters.</p>}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="pill" disabled={busy}>
          {busy ? "Working…" : signingUp ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="switch">
        {signingUp ? (
          <>
            Already have an account?{" "}
            <button type="button" onClick={() => switchTo("sign-in")}>
              Log in
            </button>
          </>
        ) : (
          <>
            New here?{" "}
            <button type="button" onClick={() => switchTo("sign-up")}>
              Sign up
            </button>
          </>
        )}
      </p>
    </div>
  );
}
