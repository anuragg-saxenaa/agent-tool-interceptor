import { describe, it, expect, beforeEach } from 'vitest';
import { AgentToolInterceptor } from './interceptor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentToolInterceptor', () => {
  let tmpDir: string;
  let interceptor: AgentToolInterceptor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intercept-test-'));
    const policyPath = path.join(tmpDir, 'interceptor.yaml');
    const tracePath = path.join(tmpDir, 'trace.jsonl');
    
    fs.writeFileSync(policyPath, `
rules:
  - match: tool == "bash" && args.command contains "rm -rf"
    action: block
    reason: "Destructive command"
`);
    
    interceptor = new AgentToolInterceptor(policyPath, tracePath);
  });

  it('should block dangerous bash commands', () => {
    const call = interceptor.intercept('bash', { command: 'rm -rf /' }, 'test-agent');
    expect(call.policy).toBe('block');
    expect(call.reason).toBe('Destructive root command');
  });

  it('should allow safe commands', () => {
    const call = interceptor.intercept('bash', { command: 'ls -la' }, 'test-agent');
    expect(call.policy).toBe('allow');
  });

  it('should log all tool calls', () => {
    interceptor.intercept('bash', { command: 'echo hello' }, 'test-agent');
    
    const content = fs.readFileSync(path.join(tmpDir, 'trace.jsonl'), 'utf-8');
    const loggedCall = JSON.parse(content.trim());
    
    expect(loggedCall.tool).toBe('bash');
    expect(loggedCall.agent).toBe('test-agent');
  });

  it('should check hard-no patterns', () => {
    const call = interceptor.intercept('bash', { command: ':(){:|:&};:' }, 'test-agent');
    expect(call.policy).toBe('block');
    expect(call.reason).toBe('Fork bomb');
  });
});