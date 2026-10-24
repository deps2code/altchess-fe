import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "./AuthProvider";
import { RuleList, type Rule, type RuleState } from "./RuleList";

type Mode = "sign-in" | "sign-up";

// These mirror the server's checks (internal/auth/user.go, password.go) so the
// user sees what a field needs before submitting. The server stays the
// authority; a rule added there without being added here still fails safely,
// as a server error below the form.
const PASSWORD_MAX_BYTES = 72;

function judge(met: boolean): RuleState {
  return met ? "met" : "unmet";
}

function usernameRules(value: string): Rule[] {
  return [
    { id: "len", text: "3–20 characters", state: judge(value.length >= 3 && value.length <= 20) },
    {
      id: "chars",
      text: "Letters, digits, hyphen or underscore only",
      state: judge(/^[a-zA-Z0-9_-]+$/.test(value)),
    },
    {
      id: "edge",
      text: "Starts and ends with a letter or digit",
      state: judge(/^[a-zA-Z0-9](.*[a-zA-Z0-9])?$/.test(value)),
    },
  ];
}

// What Go's mail.ParseAddress accepts for a plain address: atext characters
// joined by single dots, an @, then a dotted domain. The client is a little
// stricter on purpose (the domain must contain a dot), since a sign-up address
// without one never receives mail.
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LOCAL_PART = new RegExp(`^${ATEXT}(\\.${ATEXT})*$`);
const DOMAIN_PART = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function emailRules(value: string): Rule[] {
  const parts = value.split("@");
  const [local = "", domain = ""] = parts;
  const oneAt = parts.length === 2 && local !== "" && domain !== "" && !/\s/.test(value);
  const matches = oneAt && value.length <= 254 && LOCAL_PART.test(local) && DOMAIN_PART.test(domain);
  return [{ id: "match", text: "Should match an email address", state: judge(matches) }];
}

// The server prefixes its validation messages with "validation failed: " and
// names the field they are about. Drop the prefix, and use the named field so
// its input is outlined even when the client's own rules let the value through.
function serverProblem(cause: ApiError): { message: string; field?: string } {
  const message = cause.message.replace(/^validation failed:\s*/i, "");
  const named = /^(username|email|password)\b/i.exec(message)?.[1]?.toLowerCase();
  return { message, field: cause.field ?? named };
}

function passwordRules(value: string): Rule[] {
  const bytes = new TextEncoder().encode(value).length;
  return [
    { id: "min", text: "8 or more characters", state: judge(bytes >= 8) },
    { id: "max", text: `At most ${PASSWORD_MAX_BYTES} bytes`, state: judge(bytes <= PASSWORD_MAX_BYTES) },
  ];
}

const allMet = (rules: Rule[]) => rules.every((rule) => rule.state === "met");

type SignUpField = "username" | "email" | "password";

export function AuthPanel() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  // Fields whose checklist is on screen. Nothing is shown up front: a field
  // gets its list only when a submit found it failing, and keeps it (updating
  // live as the user fixes it) until they switch mode.
  const [flagged, setFlagged] = useState<ReadonlySet<SignUpField>>(new Set());
  const [busy, setBusy] = useState(false);

  const signingUp = mode === "sign-up";

  const usernameChecks = usernameRules(username.trim());
  const emailChecks = emailRules(email.trim());
  const passwordChecks = passwordRules(password);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setFlagged(new Set());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (signingUp) {
      const failing = new Set<SignUpField>();
      if (!allMet(usernameChecks)) failing.add("username");
      if (!allMet(emailChecks)) failing.add("email");
      if (!allMet(passwordChecks)) failing.add("password");
      if (failing.size > 0) {
        setFlagged(failing);
        return;
      }
    }
    setBusy(true);

    try {
      if (signingUp) {
        await signUp({ username, email, password });
      } else {
        await signIn(login, password);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? serverProblem(cause)
          : { message: "Something went wrong. Try again." },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>{signingUp ? "Create your account" : "Welcome back"}</h3>

      <form onSubmit={submit} noValidate>
        {signingUp ? (
          <>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              aria-invalid={(flagged.has("username") && !allMet(usernameChecks)) || error?.field === "username"}
              required
            />
            {flagged.has("username") && <RuleList rules={usernameChecks} />}

            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              aria-invalid={(flagged.has("email") && !allMet(emailChecks)) || error?.field === "email"}
              required
            />
            {flagged.has("email") && <RuleList rules={emailChecks} />}
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
          aria-invalid={(flagged.has("password") && !allMet(passwordChecks)) || error?.field === "password"}
          required
        />
        {signingUp && flagged.has("password") && <RuleList rules={passwordChecks} />}

        {error && (
          <RuleList alert rules={[{ id: "server", text: error.message, state: "unmet" }]} />
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
