export function shouldUseTui(options: {
  readonly argv: readonly string[];
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
}): boolean {
  return (options.argv.length === 0 || options.argv[0] === "fresh") && options.stdinIsTTY && options.stdoutIsTTY;
}
