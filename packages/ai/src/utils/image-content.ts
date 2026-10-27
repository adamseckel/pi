import type { Base64ImageContent, ImageContent, UrlImageContent } from "../types.ts";

const urlKey = "url" satisfies keyof UrlImageContent;

export function isUrlImage(image: ImageContent): image is UrlImageContent {
	return urlKey in image;
}

/** Return a provider image URL without fetching remote images. */
export function getImageUrl(image: ImageContent): string {
	if (isUrlImage(image)) return image.url;
	return `data:${image.mimeType};base64,${image.data}`;
}

/** Reject remote images at adapters that require inline image bytes. */
export function requireBase64Image(image: ImageContent, api: string): Base64ImageContent {
	if (!isUrlImage(image)) return image;
	throw new Error(`${api} does not support image URLs. Use base64 image data and mimeType instead.`);
}
