import assert from 'assert';
import { RateLimitError, BadRequestError } from 'openai';
import type OpenAI from 'openai';
import { FireworksLLMClient } from './FireworksLLMClient';

type CompletionResponse = OpenAI.Chat.Completions.ChatCompletion;

function makeResponse(content: string, finish_reason: 'stop' | 'length' = 'stop'): CompletionResponse {
  return {
    id: 'test', object: 'chat.completion', created: 0, model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason, logprobs: null }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function makeRateLimitError(): RateLimitError {
  return new RateLimitError(
    429,
    { error: { message: 'rate limited', type: 'rate_limit' } } as unknown as { error: { message: string; type: string } },
    'Rate limited',
    null as unknown as Headers,
  );
}

function makeContextLengthError(): BadRequestError {
  return new BadRequestError(
    400,
    { error: { message: 'too long', type: 'invalid_request_error', code: 'context_length_exceeded' } } as unknown as { error: { message: string; type: string; code: string } },
    'too long',
    null as unknown as Headers,
  );
}

async function run(): Promise<void> {
  // Test 1: valid JSON on first attempt
  {
    const client = new FireworksLLMClient('key', 'model', () => Promise.resolve(makeResponse('{"ok":true}')));
    const result = await client.call([]);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual((result as { ok: true; data: unknown }).data, { ok: true });
  }

  // Test 2: first attempt invalid JSON, second attempt valid JSON (retry succeeds)
  {
    let callCount = 0;
    const client = new FireworksLLMClient('key', 'model', () => {
      callCount++;
      return Promise.resolve(makeResponse(callCount === 1 ? 'not json' : '{"retried":true}'));
    });
    const result = await client.call([]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(callCount, 2);
  }

  // Test 3: both attempts invalid JSON — parse_failure after attempt 2
  {
    const client = new FireworksLLMClient('key', 'model', () => Promise.resolve(makeResponse('not json')));
    const result = await client.call([]);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.kind, 'parse_failure');
      assert.strictEqual(result.attempt, 2);
    }
  }

  // Test 4: RateLimitError — surfaces immediately as rate_limit, no retry
  {
    let callCount = 0;
    const client = new FireworksLLMClient('key', 'model', () => {
      callCount++;
      return Promise.reject(makeRateLimitError());
    });
    const result = await client.call([]);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.kind, 'rate_limit');
      assert.strictEqual(result.attempt, 1);
    }
    assert.strictEqual(callCount, 1); // no retry on rate limit
  }

  // Test 5: BadRequestError with context_length_exceeded code
  {
    const client = new FireworksLLMClient('key', 'model', () =>
      Promise.reject(makeContextLengthError()),
    );
    const result = await client.call([]);
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.kind, 'context_length');
  }

  // Test 6: finish_reason='length' — context_length, no retry
  {
    let callCount = 0;
    const client = new FireworksLLMClient('key', 'model', () => {
      callCount++;
      return Promise.resolve(makeResponse('{"incomplete":', 'length'));
    });
    const result = await client.call([]);
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.kind, 'context_length');
    assert.strictEqual(callCount, 1); // no retry on length truncation
  }

  // Test 7: generic Error — api_error
  {
    const client = new FireworksLLMClient('key', 'model', () =>
      Promise.reject(new Error('network error')),
    );
    const result = await client.call([]);
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.kind, 'api_error');
  }

  console.log('FireworksLLMClient: all tests passed');
}

run().catch((err: unknown) => {
  console.error('Test failed:', err);
  process.exit(1);
});
