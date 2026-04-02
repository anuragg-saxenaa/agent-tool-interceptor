#!/usr/bin/env node

import { createInterceptor } from './interceptor';
import * as fs from 'fs';
import * as path from 'path';

interface CliArgs {
  command: string[];
  policy?: string;
  trace?: string;
  agent?: string;
  report?: boolean;
  help?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = { command: [] };
  
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--') {
      result.command = args.slice(i + 1);
      break;
    } else if (arg === '--policy' || arg === '-p') {
      result.policy = args[++i];
    } else if (arg === '--trace' || arg === '-t') {
      result.trace = args[++i];
    } else if (arg === '--agent' || arg === '-a') {
      result.agent = args[++i];
    } else if (arg === '--report' || arg === '-r') {
      result.report = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    }
    
    i++;
  }
  
  return result;
}

function showHelp(): void {
  console.log(`
agent-tool-interceptor - Runtime tool call interceptor for AI agents

USAGE:
  agent-tool-interceptor run -- <command> [args...]
  agent-tool-interceptor report [trace-file]
  agent-tool-interceptor --help

COMMANDS:
  run <command>     Run a command with interception enabled
  report            Generate a Markdown report from the trace log

OPTIONS:
  --, -             Separator: everything after is the wrapped command
  --policy, -p      Path to interceptor.yaml (default: ./interceptor.yaml)
  --trace, -t       Path to trace log (default: ./interceptor-trace.jsonl)
  --agent, -a       Agent name (default: unknown)
  --report, -r      Generate report from existing trace
  --help, -h        Show this help message

EXAMPLES:
  agent-tool-interceptor run -- npx jest
  agent-tool-interceptor run -- node my-agent.js
  agent-tool-interceptor report
  agent-tool-interceptor report --trace custom-trace.jsonl

POLICY FILE (interceptor.yaml):
  rules:
    - match: tool == "bash" && args.command contains "rm -rf"
      action: block
      reason: "Destructive shell command"
    - match: tool == "bash"
      action: log

  Actions: allow (default) | log | require_approval | block
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Handle report command
  if (args.report || process.argv.includes('report')) {
    const tracePath = args.trace || 'interceptor-trace.jsonl';
    const interceptor = createInterceptor(args.policy, tracePath);
    console.log(interceptor.generateReport());
    interceptor.close();
    process.exit(0);
  }

  // Handle run command
  if (args.command.length === 0) {
    console.error('Error: No command specified. Use -- to separate the command.');
    console.error('Example: agent-tool-interceptor run -- npx jest');
    process.exit(1);
  }

  const interceptor = createInterceptor(args.policy, args.trace);
  
  console.log(`[interceptor] Wrapping: ${args.command.join(' ')}`);
  console.log(`[interceptor] Policy: ${args.policy || 'interceptor.yaml'}`);
  console.log(`[interceptor] Trace: ${args.trace || 'interceptor-trace.jsonl'}`);
  console.log('');

  const exitCode = await interceptor.runWrappedCommand(args.command, (call) => {
    if (call.policy === 'block') {
      console.log(`\n❌ BLOCKED: ${call.tool} - ${call.reason}`);
      console.log(`   Args: ${JSON.stringify(call.args)}`);
      process.exit(1);
    } else if (call.policy === 'log') {
      console.log(`[interceptor] LOG: ${call.tool}`);
    }
  });

  console.log('\n[interceptor] Command completed. Exit code:', exitCode);
  
  // Print summary
  console.log('\n--- Report ---');
  console.log(interceptor.generateReport());
  
  interceptor.close();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});