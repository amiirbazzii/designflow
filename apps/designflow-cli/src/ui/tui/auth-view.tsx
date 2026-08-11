import React from "react";
import { Box, Text } from "ink";
import type { TuiNavigationState } from "./navigation";
import { designFlowTheme } from "./theme";

export function AuthView({
  navigation,
  signingIn,
}: {
  readonly navigation: TuiNavigationState;
  readonly signingIn: boolean;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={designFlowTheme.accentStrong}>{signingIn ? "Signing in…" : "Sign in required"}</Text>
      <Text color={designFlowTheme.textSecondary}>
        {signingIn ? "Complete sign-in in your browser." : "Sign in to start Design Engineer."}
      </Text>
      {signingIn && <Text color={designFlowTheme.textSecondary}>Waiting for authentication…</Text>}
      {!signingIn && <Box marginTop={2}><Text color={designFlowTheme.accentStrong}>[ Continue with Google ]</Text></Box>}
      {navigation.authBrowserFallback !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={designFlowTheme.warning}>Your browser could not be opened. Open this sign-in link:</Text>
          <Text color={designFlowTheme.textSecondary} wrap="truncate">{navigation.authBrowserFallback}</Text>
        </Box>
      )}
      {navigation.authError !== undefined && (
        <Box marginTop={1}><Text color={designFlowTheme.danger}>{navigation.authError}</Text></Box>
      )}
      <Box flexDirection="column" marginTop={2}>
        <Text color={designFlowTheme.textSecondary}>DesignFlow uses your account to access its managed AI service.</Text>
        <Text color={designFlowTheme.textSecondary}>Existing sessions are reused automatically.</Text>
      </Box>
    </Box>
  );
}

