"use client";

import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Input } from "@io/web/input";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  authClient,
  completeLocalhostOnboarding,
  notifyWebPrincipalBootstrapChanged,
  readWebAuthState,
  resolveWebPrincipalBootstrap,
  subscribeWebPrincipalBootstrapChanged,
  type WebAuthViewState,
} from "../lib/auth-client.js";
import { isLocalhostOrigin } from "../lib/local-bootstrap.js";
import { resetSharedGraphRuntime } from "./graph-runtime-bootstrap.js";

type AuthSessionFeedback =
  | {
      readonly kind: "error";
      readonly message: string;
    }
  | {
      readonly kind: "success";
      readonly message: string;
    };

type UseWebAuthSessionResult = WebAuthViewState & {
  refetch(): Promise<void>;
};

type GraphAccessActivationState =
  | { status: "idle" }
  | { status: "activating" }
  | { status: "ready" }
  | { status: "error"; message: string };

type LocalhostOnboardingState =
  | {
      readonly available: false;
      readonly feedback: null;
      readonly pending: false;
      start(): Promise<void>;
    }
  | {
      readonly available: true;
      readonly feedback: AuthSessionFeedback | null;
      readonly pending: boolean;
      start(): Promise<void>;
    };

function readDefaultName(email: string): string {
  const localPart = email.split("@", 1)[0]?.trim();
  return localPart && localPart.length > 0 ? localPart : "Operator";
}

function readAuthStatusLabel(auth: WebAuthViewState): string {
  switch (auth.status) {
    case "booting":
      return "Checking session";
    case "signed-out":
      return "Signed out";
    case "expired":
      return "Session expired";
    case "ready":
      return "Signed in";
    case "error":
      return "Bootstrap unavailable";
  }
}

function readCurrentBrowserOrigin(): string | null {
  if (
    typeof window === "object" &&
    window !== null &&
    typeof window.location?.origin === "string" &&
    window.location.origin.length > 0
  ) {
    return window.location.origin;
  }

  if (
    typeof globalThis.location === "object" &&
    globalThis.location !== null &&
    typeof globalThis.location.origin === "string" &&
    globalThis.location.origin.length > 0
  ) {
    return globalThis.location.origin;
  }

  return null;
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function useLocalhostOnboardingState(enabled: boolean): LocalhostOnboardingState {
  const [feedback, setFeedback] = useState<AuthSessionFeedback | null>(null);
  const [pending, setPending] = useState(false);
  const origin = readCurrentBrowserOrigin();
  const available = enabled && origin !== null && isLocalhostOrigin(origin);

  if (!available || origin === null) {
    return {
      available: false,
      feedback: null,
      pending: false,
      start: async () => {},
    };
  }

  return {
    available: true,
    feedback,
    pending,
    start: async () => {
      setPending(true);
      setFeedback(null);

      try {
        await completeLocalhostOnboarding({
          origin,
        });
        setFeedback({
          kind: "success",
          message: "Local session established. Loading graph-backed routes.",
        });
        notifyWebPrincipalBootstrapChanged();
      } catch (error) {
        setFeedback({
          kind: "error",
          message: readErrorMessage(
            error,
            "Unable to complete localhost onboarding for this browser session.",
          ),
        });
      } finally {
        setPending(false);
      }
    },
  };
}

function useResetSharedGraphRuntimeOnSessionChange(sessionId: string | null) {
  const previousSessionIdRef = useRef<string | null>(sessionId);

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return;
    }

    previousSessionIdRef.current = sessionId;
    resetSharedGraphRuntime();
  }, [sessionId]);
}

export function useWebAuthSession(): UseWebAuthSessionResult {
  const [query, setQuery] = useState<{
    readonly data: Awaited<ReturnType<typeof resolveWebPrincipalBootstrap>> | null;
    readonly error: Error | null;
    readonly isPending: boolean;
    readonly isRefetching: boolean;
  }>({
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQuery((current) => ({
      data: null,
      error: null,
      isPending: true,
      isRefetching: current.data !== null || current.error !== null,
    }));

    void resolveWebPrincipalBootstrap({})
      .then((data) => {
        if (cancelled) {
          return;
        }

        setQuery({
          data,
          error: null,
          isPending: false,
          isRefetching: false,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setQuery({
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          isPending: false,
          isRefetching: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    return subscribeWebPrincipalBootstrapChanged(() => {
      setAttempt((current) => current + 1);
    });
  }, []);

  return {
    ...readWebAuthState(query),
    refetch: async () => {
      setAttempt((current) => current + 1);
    },
  };
}

export function AuthSessionLoadingCard({
  description = "Resolving the principal bootstrap contract before graph-backed routes mount.",
  title = "Checking session",
}: {
  readonly description?: string;
  readonly title?: string;
}) {
  return (
    <Card
      className="border-border/70 bg-card/95 border shadow-sm"
      data-auth-session-state="booting"
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        The worker keeps anonymous and authenticated graph requests separate, so the shell waits
        here until the bootstrap payload says whether this browser is signed out, ready, or needs
        reauthentication.
      </CardContent>
    </Card>
  );
}

export function AuthSessionErrorCard({
  description,
  onRetry,
  title = "Unable to load the session",
}: {
  readonly description: string;
  onRetry(): void;
  readonly title?: string;
}) {
  return (
    <Card
      className="border-destructive/20 bg-card/95 border shadow-sm"
      data-auth-session-state="error"
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          The signed-out shell stays mounted, but the app will not bootstrap graph access until the
          principal-summary bootstrap path is healthy again.
        </p>
        <div>
          <Button onClick={onRetry} type="button" variant="outline">
            Retry session check
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AuthSessionEntryCard({
  description,
  showLocalhostOnboarding = false,
  title,
}: {
  readonly description: string;
  readonly showLocalhostOnboarding?: boolean;
  readonly title: string;
}) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<AuthSessionFeedback | null>(null);
  const [pending, setPending] = useState(false);
  const localhostOnboarding = useLocalhostOnboardingState(showLocalhostOnboarding);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (normalizedEmail.length === 0 || password.length === 0) {
      return;
    }

    setPending(true);
    setFeedback(null);

    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({
              email: normalizedEmail,
              password,
            })
          : await authClient.signUp.email({
              email: normalizedEmail,
              password,
              name: name.trim() || readDefaultName(normalizedEmail),
            });

      if (result.error) {
        setFeedback({
          kind: "error",
          message:
            result.error.message ||
            (mode === "sign-in" ? "Unable to sign in." : "Unable to create the account."),
        });
        return;
      }

      setPassword("");
      setFeedback({
        kind: "success",
        message:
          mode === "sign-in"
            ? "Session established. Loading graph-backed routes."
            : "Account created and signed in. Loading graph-backed routes.",
      });
      notifyWebPrincipalBootstrapChanged();
    } finally {
      setPending(false);
    }
  }

  function setEntryMode(nextMode: "sign-in" | "sign-up") {
    setFeedback(null);
    setMode(nextMode);
  }

  return (
    <Card
      className="border-border/70 bg-card/95 border shadow-sm"
      data-auth-entry-card=""
      data-auth-entry-mode={mode}
      data-auth-session-state="signed-out"
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {showLocalhostOnboarding ? (
          <div
            className="border-border/70 bg-muted/30 grid gap-3 rounded-lg border p-4"
            data-auth-localhost-entry=""
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Localhost only</Badge>
              <span className="text-sm font-medium">Instant onboarding</span>
            </div>
            <p className="text-muted-foreground text-sm">
              Start locally to exchange one loopback-only bootstrap credential for a normal browser
              session, then reuse the existing principal bootstrap flow.
            </p>
            {localhostOnboarding.available ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={localhostOnboarding.pending}
                  onClick={() => {
                    void localhostOnboarding.start();
                  }}
                  type="button"
                >
                  {localhostOnboarding.pending ? "Starting locally..." : "Start locally"}
                </Button>
                <p className="text-muted-foreground text-xs">
                  Use email sign-in below when you want the production-like auth path instead.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs" data-auth-localhost-unavailable="">
                Start locally is available only on localhost and loopback origins.
              </p>
            )}

            {localhostOnboarding.available && localhostOnboarding.feedback ? (
              <div
                className={
                  localhostOnboarding.feedback.kind === "error"
                    ? "border-destructive/20 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-xs"
                    : "border-primary/20 bg-primary/5 text-foreground rounded-lg border px-3 py-2 text-xs"
                }
                data-auth-localhost-feedback={localhostOnboarding.feedback.kind}
              >
                {localhostOnboarding.feedback.message}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setEntryMode("sign-in")}
            type="button"
            variant={mode === "sign-in" ? "default" : "outline"}
          >
            Sign in
          </Button>
          <Button
            onClick={() => setEntryMode("sign-up")}
            type="button"
            variant={mode === "sign-up" ? "default" : "outline"}
          >
            Create account
          </Button>
        </div>

        <form className="grid gap-3" onSubmit={handleSubmit}>
          {mode === "sign-up" ? (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Operator"
                value={name}
              />
            </label>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <Input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="operator@example.com"
              type="email"
              value={email}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Password</span>
            <Input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              type="password"
              value={password}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              disabled={pending || email.trim().length === 0 || password.length === 0}
              type="submit"
            >
              {pending ? "Submitting..." : mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
            <p className="text-muted-foreground text-xs">
              {showLocalhostOnboarding
                ? "Email auth stays available below the local shortcut for production-like auth testing."
                : "The create-account path is provisional and exists to make the Better Auth-backed request path demonstrable from the browser."}
            </p>
          </div>
        </form>

        {feedback ? (
          <div
            className={
              feedback.kind === "error"
                ? "border-destructive/20 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-xs"
                : "border-primary/20 bg-primary/5 text-foreground rounded-lg border px-3 py-2 text-xs"
            }
            data-auth-feedback={feedback.kind}
          >
            {feedback.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AppShellAuthStatus() {
  const auth = useWebAuthSession();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutMessage, setSignOutMessage] = useState<string | null>(null);

  useResetSharedGraphRuntimeOnSessionChange(auth.sessionId);

  async function handleSignOut() {
    setSignOutPending(true);
    setSignOutMessage(null);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutMessage(result.error.message || "Unable to sign out.");
        return;
      }

      notifyWebPrincipalBootstrapChanged();
    } finally {
      setSignOutPending(false);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2" data-auth-session-status="">
      <Badge variant="outline">{readAuthStatusLabel(auth)}</Badge>
      {auth.status === "ready" ? (
        <span className="text-muted-foreground hidden text-xs sm:inline">{auth.displayName}</span>
      ) : null}
      {signOutMessage ? (
        <span className="text-destructive hidden text-xs md:inline">{signOutMessage}</span>
      ) : null}
      {auth.status === "ready" ? (
        <Button onClick={handleSignOut} size="sm" type="button" variant="outline">
          {signOutPending ? "Signing out..." : "Sign out"}
        </Button>
      ) : null}
    </div>
  );
}

export function GraphAccessGateView({
  auth,
  children,
  description,
  onRetry,
  title,
}: {
  readonly auth: WebAuthViewState;
  readonly children: ReactNode;
  readonly description: string;
  readonly onRetry?: () => void;
  readonly title: string;
}) {
  if (auth.status === "ready") {
    return <>{children}</>;
  }

  if (auth.status === "booting") {
    return (
      <AuthSessionLoadingCard
        description={description}
        title="Checking bootstrap before graph access"
      />
    );
  }

  if (auth.status === "error") {
    return (
      <AuthSessionErrorCard
        description={auth.errorMessage}
        onRetry={onRetry ?? (() => {})}
        title="Graph bootstrap is waiting on principal bootstrap"
      />
    );
  }

  if (auth.status === "expired") {
    return (
      <AuthSessionEntryCard
        description="The worker rejected a stale browser session. Sign in again before graph-backed routes mount."
        title="Session expired"
      />
    );
  }

  return <AuthSessionEntryCard description={description} showLocalhostOnboarding title={title} />;
}

export function GraphAccessGate({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  const auth = useWebAuthSession();
  const [activationState, setActivationState] = useState<GraphAccessActivationState>({
    status: "idle",
  });
  const [activationAttempt, setActivationAttempt] = useState(0);

  useEffect(() => {
    if (auth.status !== "ready") {
      setActivationState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setActivationState({ status: "activating" });

    void fetch("/api/access/activate", {
      method: "POST",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (cancelled) return;

        if (response.ok) {
          setActivationState({ status: "ready" });
          return;
        }

        const payload = (await response.json().catch(() => undefined)) as
          | { readonly error?: string }
          | undefined;
        setActivationState({
          status: "error",
          message:
            payload?.error ??
            `Unable to activate graph access with ${response.status} ${response.statusText}.`,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setActivationState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activationAttempt, auth.status, auth.sessionId]);

  if (auth.status === "ready" && activationState.status !== "ready") {
    if (activationState.status === "error") {
      return (
        <AuthSessionErrorCard
          description={activationState.message}
          onRetry={() => {
            setActivationAttempt((current) => current + 1);
          }}
          title="Graph access activation failed"
        />
      );
    }

    return (
      <AuthSessionLoadingCard
        description="Activating graph-member access before graph-backed routes mount."
        title="Activating graph access"
      />
    );
  }

  return (
    <GraphAccessGateView
      auth={auth}
      description={description}
      onRetry={() => {
        void auth.refetch();
      }}
      title={title}
    >
      {children}
    </GraphAccessGateView>
  );
}
