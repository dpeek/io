"use client";

import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Link } from "@tanstack/react-router";

import type { WebAuthViewState } from "../lib/auth-client.js";
import {
  AuthSessionEntryCard,
  AuthSessionErrorCard,
  AuthSessionLoadingCard,
  useWebAuthSession,
} from "./auth-shell.js";

export function HomePageStateView({
  auth,
  onRetry,
}: {
  readonly auth: WebAuthViewState;
  readonly onRetry?: () => void;
}) {
  if (auth.status === "booting") {
    return (
      <AuthSessionLoadingCard
        description="The shell resolves the principal-summary bootstrap payload before it decides whether graph-backed routes may mount."
        title="Checking web session"
      />
    );
  }

  if (auth.status === "error") {
    return (
      <AuthSessionErrorCard
        description={auth.errorMessage}
        onRetry={onRetry ?? (() => {})}
        title="Unable to read the principal bootstrap"
      />
    );
  }

  if (auth.status === "expired") {
    return (
      <AuthSessionEntryCard
        description="The worker marked the existing browser session as expired. Sign in again before the shell boots the synced graph runtime."
        title="Session expired"
      />
    );
  }

  if (auth.status === "signed-out") {
    return (
      <AuthSessionEntryCard
        description="Sign in or create a local account before the shell boots the synced graph runtime. Protected routes stay in the signed-out shell until this session is ready."
        title="Sign in to bootstrap graph access"
      />
    );
  }

  return (
    <div className="grid gap-4" data-home-auth-state="ready">
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader>
          <CardTitle>Session ready</CardTitle>
          <CardDescription>
            The worker has returned the principal-summary bootstrap payload. Graph routes now use
            that server-derived identity boundary instead of re-deriving session state in the
            browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {auth.displayName ? <Badge variant="outline">{auth.displayName}</Badge> : null}
            <Badge variant="outline">{auth.sessionId}</Badge>
            <Badge variant="outline">{auth.principalId}</Badge>
            <Badge variant="outline">capability v{auth.capabilityVersion}</Badge>
          </div>

          <p className="text-muted-foreground text-sm">
            Role bindings and authorization remain graph-owned. This shell only consumes the
            request-bound summary that the worker returns.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link to="/workflow" />}>
              Open workflow
            </Button>
            <Button nativeButton={false} render={<Link to="/graph" />}>
              Open graph
            </Button>
            <Button nativeButton={false} render={<Link to="/views" />} variant="outline">
              Review views
            </Button>
            <Button
              nativeButton={false}
              render={<Link search={{ scope: "graph" }} to="/sync" />}
              variant="outline"
            >
              Open sync
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function HomePage() {
  const auth = useWebAuthSession();

  return (
    <HomePageStateView
      auth={auth}
      onRetry={() => {
        void auth.refetch();
      }}
    />
  );
}
