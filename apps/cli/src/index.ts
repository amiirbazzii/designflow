#!/usr/bin/env bun

import { createCli } from "./cli";

const program = createCli();

await program.parseAsync(process.argv);
