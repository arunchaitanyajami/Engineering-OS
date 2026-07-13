#!/usr/bin/env node

const VERSION = "0.1.0";

const helpText = `
Engineering OS CLI

Usage:
  engineering-os --help
  engineering-os --version

Commands:
  --help, -h       Show help
  --version, -v    Show version
`;

const arg = process.argv[2];

if (arg === "--version" || arg === "-v") {
  console.log(VERSION);
  process.exit(0);
}

console.log(helpText.trim());
