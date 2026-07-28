'use strict';

const { execFileSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const roots = ['server.js', 'lib', 'public', 'test'];
const files = [];

function collect(target) {
  if (!statSync(target).isDirectory()) {
    if (target.endsWith('.js')) files.push(target);
    return;
  }
  for (const entry of readdirSync(target)) collect(path.join(target, entry));
}

for (const root of roots) {
  try { collect(root); } catch {}
}

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Vérification réussie : ${files.length} fichiers JavaScript.`);
