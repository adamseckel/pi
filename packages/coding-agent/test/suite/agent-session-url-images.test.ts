import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

const image = { type: "image", url: "https://example.com/image.png" } as const;

describe("AgentSession URL images", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		for (const harness of harnesses) harness.cleanup();
		harnesses.length = 0;
	});

	it("preserves prompt URLs without sending them through inline image processing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);

		await harness.session.prompt("Describe this image", { images: [image] });

		expect(harness.session.messages).toEqual(
			expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.arrayContaining([image]) })]),
		);
	});

	it("preserves URL images returned by tools", async () => {
		const tool: AgentTool = {
			name: "image",
			label: "Image",
			description: "Return an image URL",
			parameters: Type.Object({}),
			execute: async () => ({ content: [image], details: {} }),
		};
		const harness = await createHarness({ tools: [tool] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("image", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("Show an image");

		expect(harness.session.messages).toEqual(
			expect.arrayContaining([expect.objectContaining({ role: "toolResult", content: [image] })]),
		);
	});
});
