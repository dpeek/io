export type AskForApproval =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never"
  | { reject: { mcp_elicitations: boolean; rules: boolean; sandbox_approval: boolean } };

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | {
      access:
        | { type: "fullAccess" }
        | { includePlatformDefaults: boolean; readableRoots: string[]; type: "restricted" };
      networkAccess: boolean;
      type: "readOnly";
    }
  | { networkAccess: "restricted" | "enabled" | "disabled"; type: "externalSandbox" }
  | {
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
      readOnlyAccess:
        | { type: "fullAccess" }
        | { includePlatformDefaults: boolean; readableRoots: string[]; type: "restricted" };
      type: "workspaceWrite";
      writableRoots: string[];
    };

export interface InitializeParams {
  capabilities: Record<string, never> | null;
  clientInfo: {
    name: string;
    title: string | null;
    version: string;
  };
}

export interface ThreadStartParams {
  approvalPolicy?: AskForApproval | null;
  cwd?: string | null;
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
  sandbox?: SandboxMode | null;
}

export interface TurnStartParams {
  approvalPolicy?: AskForApproval | null;
  collaborationMode?: null;
  cwd?: string | null;
  input: Array<{ text: string; text_elements: []; type: "text" }>;
  sandboxPolicy?: SandboxPolicy | null;
  threadId: string;
}

export interface ThreadStartResponse {
  thread: {
    id: string;
  };
}

export interface TurnStartResponse {
  turn: {
    id: string;
  };
}

export interface CommandExecutionRequestApprovalResponse {
  decision: "accept" | "acceptForSession" | "decline" | "cancel";
}

export interface FileChangeRequestApprovalResponse {
  decision: "accept" | "acceptForSession" | "decline" | "cancel";
}

export interface DynamicToolCallResponse {
  contentItems: Array<{ text: string; type: "inputText" }>;
  success: boolean;
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}
