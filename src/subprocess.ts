import { Subprocess, SubprocessError } from '@ionic/utils-subprocess';

export interface RunCommandOptions {
  cwd?: string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<string> {
  const p = new Subprocess(command, args, options);

  try {
    return await p.output();
  } catch (e) {
    if (e instanceof SubprocessError) {
      // old behavior of just throwing the stdout/stderr strings
      throw e.output ? e.output : e.code ? e.code : e.error ? e.error.message : 'Unknown error';
    }

    throw e;
  }
}
