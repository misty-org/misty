import { BrandIcon } from "@/shared/ui";
import type { GuideDefinition } from "@opencut/guides/types";
import { TikTokLayout } from "./tiktok-layout";

// Misty: the platform's mark from Misty's own brand artwork (its initial where there is none),
// in place of a logo fetched from an outside logo service.
function PlatformLogo({ domain }: { domain: string; className?: string }) {
	return <BrandIcon brand={domain.split(".")[0]} size={16} />;
}

function PlatformGuidePreview({ domain }: { domain: string }) {
	return <PlatformLogo domain={domain} />;
}

function platformGuide({
	id,
	label,
	domain,
}: {
	id: string;
	label: string;
	domain: string;
}): GuideDefinition {
	return {
		id,
		label,
		renderPreview: () => <PlatformGuidePreview domain={domain} />,
		renderTriggerIcon: () => <PlatformLogo domain={domain} />,
		renderOverlay: () => null,
	};
}

export const tiktokGuide: GuideDefinition = {
	...platformGuide({ id: "tiktok", label: "TikTok", domain: "tiktok.com" }),
	renderOverlay: () => <TikTokLayout />,
};
export const igReelsGuide = platformGuide({
	id: "ig-reels",
	label: "Reels",
	domain: "instagram.com",
});
export const ytShortsGuide = platformGuide({
	id: "yt-shorts",
	label: "Shorts",
	domain: "youtube.com",
});
export const spotlightGuide = platformGuide({
	id: "spotlight",
	label: "Spotlight",
	domain: "snapchat.com",
});
