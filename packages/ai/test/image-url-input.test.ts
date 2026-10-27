import { describe, expect, it, vi } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { convertMessages as convertGoogleMessages } from "../src/api/google-shared.ts";
import { stream as streamMistral } from "../src/api/mistral-conversations.ts";
import { stream as streamCompletions } from "../src/api/openai-completions.ts";
import { stream as streamResponses } from "../src/api/openai-responses.ts";
import { generateImages } from "../src/api/openrouter-images.ts";
import type { Api, AssistantMessage, ImageContent, Model, StreamOptions, TranscriptContext } from "../src/types.ts";
import { requireBase64Image } from "../src/utils/image-content.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const url = "https://example.com/image.png?version=1";
const remote: ImageContent = { type: "image", url };
const inline: ImageContent = { type: "image", data: "ZmFrZQ==", mimeType: "image/png" };

function model<T extends Api>(api: T): Model<T> {
	return {
		api,
		id: "vision-test",
		name: "Vision test",
		provider: "test",
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10000,
		maxTokens: 100,
	};
}

/** A complete tool-call turn ensures tool image relocation preserves the image source. */
function context(image: ImageContent, location: "user" | "tool"): TranscriptContext {
	if (location === "user") {
		return normalizeContext({ messages: [{ role: "user", content: [image], timestamp: 1 }] });
	}
	const assistant: AssistantMessage = {
		role: "assistant",
		api: "openai-completions",
		provider: "test",
		model: "vision-test",
		content: [{ type: "toolCall", id: "call1", name: "image", arguments: {} }],
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	};
	return normalizeContext({
		messages: [
			{ role: "user", content: "Show the image", timestamp: 1 },
			assistant,
			{ role: "toolResult", toolCallId: "call1", toolName: "image", content: [image], isError: false, timestamp: 3 },
		],
	});
}

const adapters = [
	{
		name: "Chat Completions",
		stream: (input: TranscriptContext, options: StreamOptions) =>
			streamCompletions(model("openai-completions"), input, options),
		imagePart: (source: string) => ({ type: "image_url", image_url: { url: source } }),
	},
	{
		name: "Responses",
		stream: (input: TranscriptContext, options: StreamOptions) =>
			streamResponses(model("openai-responses"), input, options),
		imagePart: (source: string) => ({ type: "input_image", detail: "auto", image_url: source }),
	},
	{
		name: "Anthropic",
		stream: (input: TranscriptContext, options: StreamOptions) =>
			streamAnthropic(model("anthropic-messages"), input, options),
		imagePart: (source: string) =>
			source === url
				? { type: "image", source: { type: "url", url: source } }
				: { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" } },
	},
	{
		name: "Mistral",
		stream: (input: TranscriptContext, options: StreamOptions) =>
			streamMistral(model("mistral-conversations"), input, options),
		imagePart: (source: string) => ({ type: "image_url", imageUrl: source }),
	},
];

describe.each(adapters)("$name image input", ({ stream, imagePart }) => {
	it.each(["user", "tool"] as const)("passes a URL through in %s content without fetching it", async (location) => {
		const captured: { payload?: unknown } = {};
		const fetch = vi.fn<typeof globalThis.fetch>();
		await stream(context(remote, location), {
			apiKey: "test-key",
			cacheRetention: "none",
			fetch,
			onPayload(payload) {
				captured.payload = payload;
				throw new Error("payload captured");
			},
		}).result();
		expect(captured.payload).toBeDefined();
		expect(JSON.stringify(captured.payload)).toContain(JSON.stringify(imagePart(url)));
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(["user", "tool"] as const)("preserves base64 input in %s content", async (location) => {
		const captured: { payload?: unknown } = {};
		await stream(context(inline, location), {
			apiKey: "test-key",
			cacheRetention: "none",
			onPayload(payload) {
				captured.payload = payload;
				throw new Error("payload captured");
			},
		}).result();
		expect(captured.payload).toBeDefined();
		expect(JSON.stringify(captured.payload)).toContain(JSON.stringify(imagePart("data:image/png;base64,ZmFrZQ==")));
	});
});

describe("inline-only adapters", () => {
	it.each(["user", "tool"] as const)("rejects URL images in Google %s content", (location) => {
		expect(() => convertGoogleMessages(model("google-generative-ai"), context(remote, location))).toThrow(
			"google-generative-ai does not support image URLs",
		);
	});

	it("reports a clear error rather than treating a URL as base64", () => {
		expect(() => requireBase64Image(remote, "bedrock-converse-stream")).toThrow(
			"bedrock-converse-stream does not support image URLs",
		);
	});
});

it("passes URL reference images through OpenRouter image generation", async () => {
	const captured: { payload?: unknown } = {};
	const fetch = vi.fn<typeof globalThis.fetch>();
	await generateImages(
		{ ...model("openrouter-images"), type: "image", output: ["image"] },
		{ input: [remote] },
		{
			apiKey: "test-key",
			fetch,
			onPayload(payload) {
				captured.payload = payload;
				throw new Error("payload captured");
			},
		},
	);
	expect(captured.payload).toMatchObject({
		messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }],
	});
	expect(fetch).not.toHaveBeenCalled();
});
