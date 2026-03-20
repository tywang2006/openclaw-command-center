// Stub file for vscode API compatibility
// This is not used in the command-center context but needed for build compatibility

interface VsCodeApi {
  postMessage: (message: { type: string; [key: string]: unknown }) => void
}

export const vscode: VsCodeApi | null = null
