export interface CustomCommandDefinition {
  name: string;
  executable: string;
  args: string[];
  publicUrl: string;
  urlDomain: string;
}

export interface CustomCommand extends CustomCommandDefinition {
  id: number;
  status: 'stopped' | 'running' | 'stopping' | 'exited' | 'error';
  output: string;
  activeUrl: string;
  exitCode: number | null;
}
