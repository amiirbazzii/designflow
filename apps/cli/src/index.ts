#!/usr/bin/env bun
// apps/cli/src/index.ts

import { createCli } from "./cli";

const program = createCli();

await program.parseAsync(process.argv);
