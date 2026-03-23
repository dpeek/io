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
        description="The shell resolves Better Auth session state before it decides whether graph-backed routes may mount."
        title="Checking web session"
      />
    );
  }

  if (auth.status === "error") {
    return (
      <AuthSessionErrorCard
        description={auth.errorMessage}
        onRetry={onRetry ?? (() => {})}
        title="Unable to read the Better Auth session"
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
            Better Auth has established a browser session. The graph routes now bootstrap through
            the request-bound auth bridge instead of the old operator shortcut.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{auth.displayName}</Badge>
            <Badge variant="outline">{auth.sessionId}</Badge>
            {auth.userEmail ? <Badge variant="outline">{auth.userEmail}</Badge> : null}
          </div>

          <p className="text-muted-foreground text-sm">
            Role bindings remain graph-owned. This shell only proves that authenticated browser
            sessions can now reach the Worker graph APIs as real principals.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link to="/graph" />}>
              Open graph
            </Button>
            <Button nativeButton={false} render={<Link to="/topics" />} variant="outline">
              Open topics
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
