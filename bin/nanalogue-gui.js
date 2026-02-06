#!/usr/bin/env node
// CLI entry point for @nanalogue/gui

const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');
const mainScript = path.join(__dirname, '..', 'dist', 'main.js');

const child = spawn(electronPath, [mainScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_NO_DCONF: '1' }
});

child.on('close', (code) => {
  process.exit(code);
});
