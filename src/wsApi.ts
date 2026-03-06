// Stub that replaces VS Code postMessage API
// The command center doesn't need to send messages back to VS Code
export const vscode = {
  postMessage(_msg: unknown): void {
    // No-op in standalone mode
  }
}
