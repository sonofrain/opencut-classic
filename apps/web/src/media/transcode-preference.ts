/**
 * 素材转码的用户偏好（存在 localStorage）：
 *   mode   —— 遇到解不了的素材是「每次都问」还是「长期允许，直接转」
 *   height —— 目标分辨率：1080 / 720 / 保持原分辨率
 */

export type TranscodeAskMode = "ask" | "always";
export type TranscodeHeightChoice = "1080" | "720" | "source";

export interface TranscodePrefs {
	mode: TranscodeAskMode;
	height: TranscodeHeightChoice;
}

const STORAGE_KEY = "opencut:transcode-prefs";
const DEFAULT_PREFS: TranscodePrefs = { mode: "ask", height: "1080" };

export function readTranscodePrefs(): TranscodePrefs {
	if (typeof window === "undefined") return DEFAULT_PREFS;

	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_PREFS;

		const parsed = JSON.parse(raw) as Partial<TranscodePrefs>;
		const mode: TranscodeAskMode =
			parsed.mode === "always" ? "always" : "ask";
		const height: TranscodeHeightChoice =
			parsed.height === "720"
				? "720"
				: parsed.height === "source"
					? "source"
					: "1080";

		return { mode, height };
	} catch {
		return DEFAULT_PREFS;
	}
}

export function writeTranscodePrefs(patch: Partial<TranscodePrefs>): TranscodePrefs {
	const next = { ...readTranscodePrefs(), ...patch };

	if (typeof window !== "undefined") {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			// localStorage 被禁用时静默，偏好退化成「每次都问」
		}
	}

	return next;
}

export function heightChoiceToValue(choice: TranscodeHeightChoice): number | null {
	if (choice === "source") return null;
	return choice === "720" ? 720 : 1080;
}

export const HEIGHT_OPTIONS: Array<{
	value: TranscodeHeightChoice;
	label: string;
	hint: string;
}> = [
	{ value: "1080", label: "1080p", hint: "推荐：剪辑流畅，画质基本无损" },
	{ value: "720", label: "720p", hint: "更快更省空间，适合预览和粗剪" },
	{ value: "source", label: "保持原分辨率", hint: "4K 转码很慢，播放和导出也更吃资源" },
];
