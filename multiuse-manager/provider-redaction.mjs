const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Redact decoded string values, never JSON syntax, numbers or protocol keys. */
function redactString(value, secrets) {
  for (const secret of secrets) value = value.split(secret).join("[redacted]");
  return value;
}
export function redactJson(value, secrets) {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value))
    return value.map((entry) => redactJson(entry, secrets));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value))
      value[key] = redactJson(value[key], secrets);
  }
  return value;
}

// Only these fields are fragments of one logical string in the supported APIs.
function streamingFields(payload) {
  const result = [];
  const add = (channel, object, key) => {
    if (typeof object?.[key] === "string")
      result.push({ channel, object, key });
  };
  for (const [index, choice] of (payload.choices || []).entries()) {
    for (const key of ["content", "reasoning_content", "reasoning"])
      add(`chat:${choice.index ?? index}:${key}`, choice.delta, key);
    for (const [slot, call] of (choice.delta?.tool_calls || []).entries())
      add(
        `chat:${choice.index ?? index}:tool:${call.index ?? slot}`,
        call.function,
        "arguments",
      );
  }
  if (payload.type === "content_block_delta") {
    for (const key of ["text", "thinking", "partial_json", "signature"])
      add(`anthropic:${payload.index}:${key}`, payload.delta, key);
  }
  if (
    payload.type?.startsWith("response.") &&
    payload.type.endsWith(".delta")
  ) {
    add(
      `${payload.type}:${payload.item_id ?? payload.output_index ?? 0}:${payload.content_index ?? 0}`,
      payload,
      "delta",
    );
  }
  for (const [index, candidate] of (payload.candidates || []).entries()) {
    for (const [part, entry] of (candidate.content?.parts || []).entries())
      add(`gemini:${candidate.index ?? index}:${part}`, entry, "text");
  }
  return result;
}
function terminates(payload) {
  return (
    [
      "message_stop",
      "content_block_stop",
      "response.completed",
      "response.failed",
      "response.incomplete",
    ].includes(payload.type) ||
    payload.choices?.some((choice) => choice.finish_reason != null) ||
    payload.candidates?.some((candidate) => candidate.finishReason != null)
  );
}

/** SSE redaction keeps original event order while holding only possible secret prefixes. */
function sseRedactor(secrets) {
  const queue = [];
  const channels = new Map();
  let bufferedBytes = 0;
  const starts = [...new Set(secrets.map((secret) => secret[0]))];
  const longest = Math.max(0, ...secrets.map((secret) => secret.length));

  function scan(channel, final = false) {
    const value = channel.parts.map((part) => part.remaining).join("");
    const consume = (count, replacement) => {
      if (replacement !== undefined) {
        const first = channel.parts[0];
        first.object[first.key] += replacement;
      }
      while (count > 0) {
        const part = channel.parts[0];
        const length = Math.min(count, part.remaining.length);
        if (replacement === undefined)
          part.object[part.key] += part.remaining.slice(0, length);
        part.remaining = part.remaining.slice(length);
        count -= length;
        if (!part.remaining) {
          channel.parts.shift();
          part.record.pending--;
        }
      }
    };
    let offset = 0;
    while (offset < value.length) {
      const match = secrets.find((secret) => value.startsWith(secret, offset));
      if (match) {
        consume(match.length, "[redacted]");
        offset += match.length;
        continue;
      }
      if (
        !final &&
        value.length - offset < longest &&
        secrets.some((secret) => secret.startsWith(value.slice(offset)))
      )
        break;
      let next = value.length;
      for (const start of starts) {
        const position = value.indexOf(start, offset + 1);
        if (position !== -1) next = Math.min(next, position);
      }
      consume(next - offset);
      offset = next;
    }
  }
  const flush = () => {
    for (const channel of channels.values()) scan(channel, true);
  };
  function* ready() {
    while (queue.length && queue[0].pending === 0) {
      const record = queue.shift();
      bufferedBytes -= record.bytes;
      const data =
        record.payload === undefined
          ? record.data
          : JSON.stringify(record.payload);
      yield [
        ...record.fields,
        ...(data === undefined
          ? []
          : data.split("\n").map((line) => `data: ${line}`)),
      ].join("\n") + "\n\n";
    }
  }
  function* frame(text) {
    const lines = text.split(/\r?\n/);
    const values = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    const data = values.length ? values.join("\n") : undefined;
    const record = {
      fields: lines
        .filter((line) => !line.startsWith("data:"))
        .map((line) => redactString(line, secrets)),
      data,
      pending: 0,
      bytes: Buffer.byteLength(text),
    };
    bufferedBytes += record.bytes;
    if (bufferedBytes > MAX_FRAME_BYTES)
      throw new Error("Provider event buffer limit");
    queue.push(record);
    if (data === "[DONE]") flush();
    else if (data !== undefined) {
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        record.data = redactString(data, secrets);
      }
      if (payload && typeof payload === "object") {
        const fields = streamingFields(payload);
        // Remove fragment fields before recursively redacting complete values.
        const originals = fields.map((field) => ({
          ...field,
          value: field.object[field.key],
        }));
        for (const field of fields) field.object[field.key] = "";
        record.payload = redactJson(payload, secrets);
        for (const { channel: key, object, key: field, value } of originals) {
          if (!value) continue;
          const channel = channels.get(key) || { parts: [] };
          channels.set(key, channel);
          record.pending++;
          channel.parts.push({ object, key: field, remaining: value, record });
          scan(channel);
          if (!channel.parts.length) channels.delete(key);
        }
        if (terminates(payload)) flush();
      } else if (payload !== undefined)
        record.payload = redactJson(payload, secrets);
    }
    yield* ready();
  }
  return {
    frame,
    *finish() {
      flush();
      yield* ready();
    },
  };
}

/** Provider transport is JSON/SSE; malformed/oversized successful bodies fail closed. */
export async function* redactProviderBody(body, values, sse) {
  if (!body) return;
  const secrets = [
    ...new Set(
      values.filter((value) => typeof value === "string" && value.length),
    ),
  ].sort((a, b) => b.length - a.length);
  const decoder = new TextDecoder();
  let pending = "";
  const redactor = sse ? sseRedactor(secrets) : null;
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(pending) > MAX_FRAME_BYTES)
      throw new Error("Provider response limit");
    if (redactor) {
      let delimiter;
      while ((delimiter = /\r?\n\r?\n/.exec(pending))) {
        yield* redactor.frame(pending.slice(0, delimiter.index));
        pending = pending.slice(delimiter.index + delimiter[0].length);
      }
    }
  }
  pending += decoder.decode();
  if (redactor) {
    if (pending) yield* redactor.frame(pending);
    yield* redactor.finish();
  } else yield JSON.stringify(redactJson(JSON.parse(pending), secrets));
}
