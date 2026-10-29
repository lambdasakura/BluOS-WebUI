#!/usr/bin/env node
// BluOS プレーヤーを操作する CLI（使い方は bluos --help）
import { main } from '../lib/cli.js';

const code = await main(process.argv.slice(2));
if (code !== undefined) process.exitCode = code;
