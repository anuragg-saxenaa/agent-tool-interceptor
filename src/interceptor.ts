import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as yaml from 'yaml';

export interface ToolCall {
  ts: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  policy: 'allow' | 'block' | 'log';
  reason?: string;
  durationMs?: number;
  exitCode?: number;
}

export interface Rule {
  match: string;
  action: 'allow' | 'block' | 'log' | 'require_approval';
  reason?: string;
}

export interface Policy {
  rules: Rule[];
  allowlist?: string[];
  strict?: boolean;
}

const HARDCODED_PATTERNS = [
  { pattern: 'rm -rf /', reason: 'Destructive root command' },
  { pattern: 'rm -rf ~', reason: 'Destructive home deletion' },
  { pattern: 'sudo rm', reason: 'Elevated deletion' },
  { pattern: ':(){:|:&};:', reason: 'Fork bomb' },
  { pattern: 'curl.*\|.*sh', reason: 'Pipe to shell execution' },
  { pattern: 'wget.*\|.*sh', reason: 'Pipe to shell execution' },
  { pattern: 'chmod 777', reason: 'World-writable permissions' },
  { pattern: '> /etc/passwd', reason: 'System file modification' },
  { pattern: '> /etc/shadow', reason: 'System file modification' },
  { pattern: 'eval.*\\$', reason: 'Dynamic code execution' },
];

const DEFAULT_POLICY: Policy = {
  rules: [],
  strict: false,
};

export class AgentToolInterceptor {
  private policy: Policy;
  private tracePath: string;
  private traceStream: fs.WriteStream;

  constructor(
    policyPath: string = 'interceptor.yaml',
    tracePath: string = 'interceptor-trace.jsonl'
  ) {
    this.policy = this.loadPolicy(policyPath);
    this.tracePath = tracePath;
    this.traceStream = fs.createWriteStream(tracePath, { flags: 'a' });
  }

  private loadPolicy(policyPath: string): Policy {
    try {
      const content = fs.readFileSync(policyPath, 'utf-8');
      return yaml.parse(content) as Policy;
    } catch {
      return DEFAULT_POLICY;
    }
  }

  private evaluateRule(rule: Rule, tool: string, args: Record<string, unknown>): boolean {
    const match = rule.match;
    
    // Simple CEL-like evaluation
    if (match.includes('tool ==')) {
      const toolMatch = match.match(/tool == "([^"]+)"/);
      if (toolMatch && tool !== toolMatch[1]) return false;
    }
    
    if (match.includes('args.')) {
      for (const [key, value] of Object.entries(args)) {
        if (match.includes(`args.${key}`) && typeof value === 'string') {
          if (match.includes('contains')) {
            const strMatch = match.match(/contains "([^"]+)"/);
            if (strMatch && !value.includes(strMatch[1])) return false;
          }
        }
      }
    }
    
    return true;
  }

  private checkHardNoPatterns(tool: string, args: Record<string, unknown>): { blocked: boolean; reason?: string } {
    if (tool !== 'bash' && tool !== 'shell') return { blocked: false };
    
    const cmd = (args.command as string) || (args._ as string) || '';
    
    for (const hp of HARDCODED_PATTERNS) {
      if (cmd.includes(hp.pattern)) {
        return { blocked: true, reason: hp.reason };
      }
    }
    
    // Check for path-based dangerous writes
    if (tool === 'write' || tool === 'write_file') {
      const filePath = (args.path as string) || (args.file as string) || '';
      const dangerousPaths = ['/etc/', '/usr/', '/var/', '~/.ssh/', '~/.aws/'];
      for (const dp of dangerousPaths) {
        if (filePath.startsWith(dp.replace('~', process.env.HOME || ''))) {
          return { blocked: true, reason: `Writing to protected path: ${dp}` };
        }
      }
    }
    
    return { blocked: false };
  }

  private evaluatePolicy(tool: string, args: Record<string, unknown>): { action: 'allow' | 'block' | 'log'; reason?: string } {
    // First check hard-no patterns
    const hardNo = this.checkHardNoPatterns(tool, args);
    if (hardNo.blocked) {
      return { action: 'block', reason: hardNo.reason };
    }

    // Then check rules
    for (const rule of this.policy.rules) {
      if (this.evaluateRule(rule, tool, args)) {
        return { action: rule.action, reason: rule.reason };
      }
    }

    return { action: 'allow' };
  }

  intercept(tool: string, args: Record<string, unknown>, agent: string = 'unknown'): ToolCall {
    const startTime = Date.now();
    const evaluation = this.evaluatePolicy(tool, args);
    
    const call: ToolCall = {
      ts: new Date().toISOString(),
      agent,
      tool,
      args,
      policy: evaluation.action,
      reason: evaluation.reason,
      durationMs: Date.now() - startTime,
    };

    this.traceStream.write(JSON.stringify(call) + '\n');
    
    return call;
  }

  async runWrappedCommand(cmd: string[], onToolCall: (call: ToolCall) => void): Promise<number> {
    return new Promise((resolve) => {
      const proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          AGENT_TOOL_INTERCEPTOR_ENABLED: '1',
        },
      });

      proc.stdout.on('data', (data) => process.stdout.write(data));
      proc.stderr.on('data', (data) => process.stderr.write(data));

      proc.on('close', (code) => {
        this.traceStream.end();
        resolve(code || 0);
      });
    });
  }

  generateReport(): string {
    const calls: ToolCall[] = [];
    
    try {
      const content = fs.readFileSync(this.tracePath, 'utf-8');
      for (const line of content.trim().split('\n')) {
        if (line) calls.push(JSON.parse(line));
      }
    } catch {
      return '# Interceptor Report\n\nNo tool calls recorded.';
    }

    const total = calls.length;
    const blocked = calls.filter(c => c.policy === 'block').length;
    const logged = calls.filter(c => c.policy === 'log').length;
    const allowed = calls.filter(c => c.policy === 'allow').length;

    let report = '# Interceptor Report\n\n';
    report += `## Summary\n\n';
    report += `- Total tool calls: ${total}\n`;
    report += `- Allowed: ${allowed}\n`;
    report += `- Blocked: ${blocked}\n`;
    report += `- Logged only: ${logged}\n\n`;

    if (blocked > 0) {
      report += '## Blocked Calls\n\n';
      for (const call of calls.filter(c => c.policy === 'block')) {
        report += `- \`${call.tool}\`: ${call.reason}\n`;
        report += `  - Args: \`${JSON.stringify(call.args)}\`\n`;
      }
      report += '\n';
    }

    report += '## All Tool Calls\n\n';
    for (const call of calls) {
      const status = call.policy === 'block' ? '❌ BLOCKED' : call.policy === 'log' ? '📝 LOGGED' : '✅ ALLOWED';
      report += `- ${status} \`${call.tool}\` at ${call.ts}\n`;
    }

    return report;
  }

  close(): void {
    this.traceStream.end();
  }
}

export function createInterceptor(policyPath?: string, tracePath?: string): AgentToolInterceptor {
  return new AgentToolInterceptor(policyPath, tracePath);
}
